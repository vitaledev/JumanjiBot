import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { Database } from "../infrastructure/database.js";
import { requireRule } from "../core/contracts.js";
export class Files {
  constructor(public database:Database,public directory:string){}
  path(id:string):string {requireRule(/^[0-9a-f-]{36}$/.test(id),"Arquivo inválido",404);return resolve(this.directory,id);}
  async upload(guildId:string,userId:string,mime:string,body:Buffer):Promise<{id:string}> {
    requireRule(body.length>0 && body.length<=5*1024*1024,"A imagem deve ter até 5 MB",413);
    const png=body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=body[0]===255 && body[1]===216 && body[2]===255;
    requireRule(mime==="image/png" && png || mime==="image/jpeg" && jpg,"Envie imagem PNG ou JPEG");
    if(png)requireRule(body.length>=24 && body.readUInt32BE(16)<=8192 && body.readUInt32BE(20)<=8192,"Dimensões de imagem excessivas");
    const digest=createHash("sha256").update(body).digest("hex");
    const duplicate=(await this.database.query("SELECT id,user_id FROM private_files WHERE guild_id=$1 AND digest=$2",[guildId,digest])).rows[0];
    if(duplicate){requireRule(duplicate.user_id===userId,"Imagem já enviada por outro participante");return {id:duplicate.id};}
    const id=randomUUID();await mkdir(this.directory,{recursive:true});await writeFile(this.path(id),body,{flag:"wx"});
    try{await this.database.query("INSERT INTO private_files(id,guild_id,user_id,mime,size,digest) VALUES($1,$2,$3,$4,$5,$6)",[id,guildId,userId,mime,body.length,digest]);}catch(error){await unlink(this.path(id));throw error;}
    return {id};
  }
  async read(guildId:string,userId:string,id:string,admin:boolean):Promise<{body:Buffer;mime:string}> {
    const row=(await this.database.query("SELECT * FROM private_files WHERE guild_id=$1 AND id=$2",[guildId,id])).rows[0];requireRule(row && (admin || row.user_id===userId),"Arquivo indisponível",404);return {body:await readFile(this.path(id)),mime:row.mime};
  }
  async remove(ids:string[]):Promise<void> {for(const id of ids)await unlink(this.path(id)).catch(e=>{if(e.code!=="ENOENT")throw e;});}
}
const xml=(v:string)=>v.replace(/[<>&"']/g,c=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[c]!));
export function profileCard(name:string,xp:number,format:"post"|"story",hideIdentity:boolean,title="Participante",color="#D4A72C"):Buffer {
  const height=format==="story"?1920:1080;
  requireRule(/^#[0-9a-f]{6}$/i.test(color),"Cor inválida");
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}"><rect width="1080" height="${height}" fill="#12110f"/><rect x="48" y="48" width="984" height="${height-96}" rx="30" fill="#231c18" stroke="${color}" stroke-width="3"/><text x="100" y="180" fill="${color}" font-family="sans-serif" font-size="42">JUMANJI RPG</text><text x="100" y="${height/2-80}" fill="#fff4dc" font-family="sans-serif" font-size="56">${xml(hideIdentity?"Membro da comunidade":name.slice(0,24))}</text><text x="100" y="${height/2+20}" fill="${color}" font-family="sans-serif" font-size="36">${xml(title.slice(0,40))}</text><text x="100" y="${height/2+110}" fill="#fff4dc" font-family="sans-serif" font-size="44">${hideIdentity?"Uma história construída em comunidade":`${xp} XP · Nível ${Math.floor(xp/100)+1}`}</text><text x="100" y="${height-140}" fill="#aa9c85" font-family="sans-serif" font-size="28">Sua história começa na base.</text></svg>`;
  return Buffer.from(new Resvg(svg).render().asPng());
}
