import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve,extname,relative,isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Auth } from "./http/auth.js";
import { Files,profileCard } from "./http/files.js";
import { AppError,requireRule } from "./core/contracts.js";
import type { GameService } from "./core/service.js";
const root=resolve(fileURLToPath(new URL("../web",import.meta.url)));
const types:Record<string,string>={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml"};
export function json(response:ServerResponse,status:number,body:unknown):void {response.writeHead(status,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify(body));}
export async function readBody(request:IncomingMessage,limit=64*1024):Promise<Buffer> {
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of request){size+=chunk.length;if(size>limit)throw new AppError("TOO_LARGE","Corpo da solicitação excessivo",413);chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
}
async function readJson(request:IncomingMessage):Promise<unknown> {
  requireRule(request.headers["content-type"]?.split(";")[0]==="application/json","Use application/json",415);
  try{return JSON.parse((await readBody(request)).toString("utf8")||"{}");}catch(e){if(e instanceof AppError)throw e;throw new AppError("INVALID_JSON","JSON inválido");}
}
export function createWebServer(service:GameService,auth:Auth,files:Files) {
  return createServer(async(request,response)=>{
    const requestOrigin=String(request.headers.origin??"");
    if(requestOrigin===auth.options.origin || requestOrigin===auth.panelOrigin){response.setHeader("Access-Control-Allow-Origin",requestOrigin);response.setHeader("Access-Control-Allow-Credentials","true");response.setHeader("Access-Control-Allow-Headers","Content-Type, X-CSRF-Token");response.setHeader("Access-Control-Allow-Methods","GET,HEAD,POST,OPTIONS");response.setHeader("Vary","Origin");}
    if(request.method==="OPTIONS") {response.writeHead(204);response.end();return;}
    response.setHeader("X-Content-Type-Options","nosniff");response.setHeader("Referrer-Policy","same-origin");
    response.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader("Cache-Control","no-store");
    try {
      const url=new URL(request.url??"/",auth.options.origin);
      if(url.pathname==="/health/live")return json(response,200,{status:"alive"});
      if(url.pathname==="/health/ready"){await service.store.database.query("SELECT 1");return json(response,200,{status:"ready"});}
      if(url.pathname.startsWith("/api/")) {
        const key=createHash("sha256").update(`${request.socket.remoteAddress}:${Math.floor(Date.now()/60000)}`).digest("hex");
        const hits=(await service.store.database.query("INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,NOW()+INTERVAL '1 minute') ON CONFLICT(key) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits",[key])).rows[0]!.hits;
        requireRule(hits<=120,"Muitas solicitações; aguarde um minuto",429);
        if(await auth.route(request,response,url))return;
        const session=await auth.session(request);
        if(!["GET","HEAD"].includes(request.method??""))auth.csrf(request,session.csrf);
        if(url.pathname==="/api/auth/logout" && request.method==="POST"){await auth.logout(request,response);return json(response,200,{ok:true});}
        if(url.pathname==="/api/me" && request.method==="GET")return json(response,200,{user:session.user,csrf:session.csrf});
        if(url.pathname==="/api/guilds" && request.method==="GET"){
          const available=(await service.store.database.query("SELECT id,name FROM guilds")).rows;
          return json(response,200,{items:available.filter(g=>session.user.guilds.some(v=>v.id===g.id))});
        }
        const match=/^\/api\/guilds\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);requireRule(match,"Rota não encontrada",404);
        const guildId=decodeURIComponent(match[1]!),path=match[2]??"dashboard";
        requireRule(session.user.guilds.some(g=>g.id===guildId),"Servidor não autorizado",403);
        const actor=await auth.provider.authorize(guildId,session.user);
        if(path.startsWith("files/") && request.method==="GET") {const file=await files.read(guildId,actor.id,path.slice(6),actor.admin);response.writeHead(200,{"Content-Type":file.mime,"Content-Disposition":"inline"});response.end(file.body);return;}
        if(path==="files" && request.method==="POST") {await service.store.run(guildId,u=>service.member(u,actor.id));return json(response,201,await files.upload(guildId,actor.id,String(request.headers["content-type"]??""),await readBody(request,5*1024*1024)));}
        if(path==="card" && request.method==="POST") {
          const data=z.object({format:z.enum(["post","story"]),hideIdentity:z.boolean()}).parse(await readJson(request));
          const m=await service.store.run(guildId,u=>service.member(u,actor.id));
          const body=profileCard(m!.display_name,m!.xp,data.format,data.hideIdentity);response.writeHead(200,{"Content-Type":"image/png","Content-Disposition":`attachment; filename="jumanji-${data.format}.png"`});response.end(body);return;
        }
        if(path.startsWith("actions/") && request.method==="POST") {
          const result=await service.act(guildId,actor,path.slice(8),await readJson(request));
          return json(response,result && typeof result==="object" && "jobId" in result?202:200,result);
        }
        if(request.method==="GET") {
          const page=z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get("page")??1);
          const result=await service.view(guildId,actor,path,page,(url.searchParams.get("q")??"").slice(0,100));
          if(url.searchParams.get("format")==="csv") {
            requireRule(actor.admin,"Exportação administrativa",403);
            const rows=(result as {items?:Record<string,unknown>[]}).items??[result as Record<string,unknown>];const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];
            const cell=(v:unknown)=>{let text=typeof v==="object"?JSON.stringify(v):String(v??"");if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replace(/"/g,'""')}"`;};
            response.writeHead(200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=jumanji.csv"});response.end([keys.map(cell).join(","),...rows.map(row=>keys.map(k=>cell(row[k])).join(","))].join("\r\n"));return;
          }
          return json(response,200,result);
        }
        throw new AppError("METHOD_NOT_ALLOWED","Método não permitido",405);
      }
      requireRule(request.method==="GET" || request.method==="HEAD","Método não permitido",405);
      const requested=decodeURIComponent(url.pathname),file=resolve(root,requested==="/"?"index.html":requested.slice(1));const rel=relative(root,file);
      requireRule(rel && !rel.startsWith("..") && !isAbsolute(rel) && !rel.split(/[\\/]/).some(v=>v.startsWith(".")),"Arquivo não encontrado",404);
      requireRule(types[extname(file)],"Arquivo não encontrado",404);
      const body=await readFile(file);response.writeHead(200,{"Content-Type":types[extname(file)]!});response.end(request.method==="HEAD"?undefined:body);
    } catch(error) {
      if(response.headersSent){response.end();return;}
      if(error instanceof AppError)return json(response,error.status,{error:{code:error.code,message:error.message}});
      if(error instanceof z.ZodError)return json(response,400,{error:{code:"VALIDATION",message:error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}});
      const code=(error as {code?:string}).code;
      if(code==="ENOENT")return json(response,404,{error:{code:"NOT_FOUND",message:"Arquivo não encontrado"}});
      if(code==="23505")return json(response,409,{error:{code:"CONFLICT",message:"Registro já existente"}});
      console.error(JSON.stringify({level:"error",event:"http.failure",code:code??"unknown"}));
      json(response,500,{error:{code:"INTERNAL",message:"Não foi possível concluir. Tente novamente."}});
    }
  });
}

