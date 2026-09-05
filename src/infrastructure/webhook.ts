import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { requireRule } from "../core/contracts.js";
export function publicAddress(ip:string):boolean {
  if(isIP(ip)===4){const [a,b]=ip.split(".").map(Number);return a!==0 && a!==10 && a!==127 && a!==169 && !(a===172 && b!>=16 && b!<=31) && !(a===192 && b===168) && !(a===100 && b!>=64 && b!<=127) && a!<224;}
  if(isIP(ip)===6)return /^[23][0-9a-f]{3}:/i.test(ip) && !ip.toLowerCase().startsWith("2001:db8:");
  return false;
}
export async function sendWebhook(target:string,secret:string,payload:unknown,id:string):Promise<void> {
  const url=new URL(target);requireRule(url.protocol==="https:" && !url.username && !url.password,"Webhook inválido");
  const addresses=await lookup(url.hostname,{all:true});requireRule(addresses.length && addresses.every(a=>publicAddress(a.address)),"Webhook precisa apontar para endereço público");
  const address=addresses[0]!,body=JSON.stringify(payload),signature=createHmac("sha256",secret).update(`${id}.${body}`).digest("hex");
  await new Promise<void>((resolve,reject)=>{
    const req=request(url,{method:"POST",timeout:10000,lookup:(_host,_options,callback)=>callback(null,address.address,address.family),headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body),"X-Jumanji-Event":id,"X-Jumanji-Signature":signature}},res=>{res.resume();if(res.statusCode && res.statusCode>=200 && res.statusCode<300)resolve();else reject(new Error("Webhook refused"));});
    req.on("timeout",()=>req.destroy(new Error("Webhook timeout")));req.on("error",reject);req.end(body);
  });
}
