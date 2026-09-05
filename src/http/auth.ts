import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Database } from "../infrastructure/database.js";
import { AppError, requireRule, type Actor } from "../core/contracts.js";
export type Identity={id:string;name:string;avatar?:string;guilds:{id:string;name:string}[]};
export interface IdentityProvider {
  exchange(code:string,redirect:string):Promise<Identity>;
  authorize(guildId:string,user:Identity):Promise<Actor>;
}
export type AuthOptions={origin:string;frontendOrigin?:string;clientId:string;secure:boolean};
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const token=()=>randomBytes(32).toString("base64url");
export function cookie(request:IncomingMessage,name:string):string|undefined {return request.headers.cookie?.split(";").map(p=>p.trim()).find(p=>p.startsWith(`${name}=`))?.slice(name.length+1);}
export function equal(a:string,b:string):boolean {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
export class Auth {
  constructor(public database:Database,public provider:IdentityProvider,public options:AuthOptions){}
  get panelOrigin():string {return this.options.frontendOrigin??this.options.origin;}
  setCookie(response:ServerResponse,name:string,value:string,seconds:number):void {const crossOrigin=this.options.origin!==this.panelOrigin;response.setHeader("Set-Cookie",`${name}=${value}; Path=/; HttpOnly; SameSite=${crossOrigin?"None":"Lax"}; Max-Age=${seconds}${this.options.secure||crossOrigin?"; Secure":""}`);}
  async route(request:IncomingMessage,response:ServerResponse,url:URL):Promise<boolean> {
    if(url.pathname==="/api/auth/login" && request.method==="GET") {
      const state=token();await this.database.query("INSERT INTO oauth_states VALUES($1,NOW()+INTERVAL '10 minutes')",[hash(state)]);
      this.setCookie(response,"jumanji_oauth",state,600);
      const target=new URL("https://discord.com/oauth2/authorize");target.search=new URLSearchParams({client_id:this.options.clientId,redirect_uri:`${this.options.origin}/api/auth/callback`,response_type:"code",scope:"identify guilds",state}).toString();
      response.writeHead(302,{Location:target.toString()});response.end();return true;
    }
    if(url.pathname==="/api/auth/callback" && request.method==="GET") {
      const state=url.searchParams.get("state")??"",code=url.searchParams.get("code")??"";
      requireRule(state && code && equal(state,cookie(request,"jumanji_oauth")??""),"Login inválido; tente novamente",401);
      requireRule((await this.database.query("DELETE FROM oauth_states WHERE state_hash=$1 AND expires_at>NOW() RETURNING state_hash",[hash(state)])).rowCount,"Login expirado ou já utilizado",401);
      const user=await this.provider.exchange(code,`${this.options.origin}/api/auth/callback`);
      const session=await this.create(user);this.setCookie(response,"jumanji_session",session.token,86400);
      response.writeHead(302,{Location:`${this.panelOrigin}/`});response.end();return true;
    }
    return false;
  }
  async create(user:Identity):Promise<{token:string;csrf:string}> {
    const value=token(),csrf=token();await this.database.query("INSERT INTO web_sessions(token_hash,user_data,csrf,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '24 hours')",[hash(value),user,csrf]);return {token:value,csrf};
  }
  async session(request:IncomingMessage):Promise<{user:Identity;csrf:string}> {
    const value=cookie(request,"jumanji_session");if(!value)throw new AppError("UNAUTHENTICATED","Entre com Discord para continuar",401);
    const row=(await this.database.query("SELECT user_data,csrf FROM web_sessions WHERE token_hash=$1 AND expires_at>NOW()",[hash(value)])).rows[0];
    if(!row)throw new AppError("UNAUTHENTICATED","Sessão expirada",401);
    return {user:row.user_data,csrf:row.csrf};
  }
  csrf(request:IncomingMessage,value:string):void {
    requireRule((request.headers.origin===this.options.origin || request.headers.origin===this.panelOrigin) && equal(String(request.headers["x-csrf-token"]??""),value),"Solicitação não autorizada",403);
  }
  async logout(request:IncomingMessage,response:ServerResponse):Promise<void> {await this.database.query("DELETE FROM web_sessions WHERE token_hash=$1",[hash(cookie(request,"jumanji_session")??"")]);this.setCookie(response,"jumanji_session","",0);}
}

