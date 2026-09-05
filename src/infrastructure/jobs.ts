import { randomUUID } from "node:crypto";
import { closeModule } from "../core/advanced.js";
import { qualifyReferral } from "../core/community.js";
import { AppError, localDay, requireRule } from "../core/contracts.js";
import type { GameService } from "../core/service.js";
import type { Files } from "../http/files.js";
export interface Effects {
  provision(guildId:string,actorId:string):Promise<unknown>;
  sync(guildId:string,actorId:string):Promise<unknown>;
  roles(guildId:string,userId:string):Promise<unknown>;
  moderation(guildId:string,caseId:string,actorId:string):Promise<unknown>;
  invite(guildId:string,campaignId:string,userId:string):Promise<unknown>;
  notify(guildId:string,userId:string,text:string,key:string):Promise<unknown>;
  publish(guildId:string,kind:string,id:string,actorId:string):Promise<unknown>;
  webhook(guildId:string,id:string,payload:unknown,key:string):Promise<unknown>;
}
type Job={id:string;guild_id:string;kind:string;payload:Record<string,any>;attempts:number;lease_token:string};
export class JobRunner {
  private timer:ReturnType<typeof setTimeout>|undefined;
  private stopping=false;
  private active:Promise<unknown>|undefined;
  constructor(public service:GameService,public effects:Effects,public files:Files){}
  async once():Promise<boolean> {
    const db=this.service.store.database,lease=randomUUID();
    const job=(await db.query<Job>(`WITH candidate AS (SELECT id FROM jobs WHERE attempts<5 AND
      ((status='pending' AND run_at<=NOW()) OR (status='running' AND lease_until<NOW())) ORDER BY run_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_until=NOW()+INTERVAL '2 minutes'
      FROM candidate WHERE jobs.id=candidate.id RETURNING jobs.*`,[lease])).rows[0];
    if(!job)return false;
    const heartbeat=setInterval(()=>{void db.query("UPDATE jobs SET lease_until=NOW()+INTERVAL '2 minutes' WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,lease]).catch(()=>undefined);},30000);
    try {
      const result=await this.execute(job);
      await db.query("UPDATE jobs SET status='done',result=$3,lease_until=NULL,last_error=NULL WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,lease,JSON.stringify(result??{ok:true})]);
    } catch(error) {
      const code=error instanceof AppError?`${error.code}: ${error.message}`:"Falha no processamento; verifique conectividade e permissões";
      await db.query("UPDATE jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,run_at=NOW()+($3*INTERVAL '1 second'),lease_until=NULL,last_error=$4 WHERE id=$1 AND lease_token=$2 AND status='running'",[job.id,lease,Math.min(3600,2**job.attempts*5),code]);
    }finally{clearInterval(heartbeat);}
    return true;
  }
  private async execute(job:Job):Promise<unknown> {
    const p=job.payload,g=job.guild_id;
    if(job.kind==="provision")return this.effects.provision(g,p.actorId);
    if(job.kind==="sync-members")return this.effects.sync(g,p.actorId);
    if(job.kind==="roles")return this.effects.roles(g,p.userId);
    if(job.kind==="moderation")return this.effects.moderation(g,p.caseId,p.actorId);
    if(job.kind==="invite-create")return this.effects.invite(g,p.campaignId,p.userId);
    if(job.kind==="publish")return this.effects.publish(g,p.kind,p.id,p.actorId);
    if(job.kind==="webhook")return this.effects.webhook(g,p.id,p.body,job.id);
    if(job.kind==="delete-files")return this.files.remove(p.fileIds);
    if(job.kind==="notify") {
      const eligible=await this.service.store.run(g,async u=>{const m=await this.service.member(u,p.userId,false);return m?.participation==="active" && m.preferences.notifications && (!p.reactivation || m.preferences.reactivation);});
      if(!eligible)return {skipped:true};
      const result=await this.effects.notify(g,p.userId,p.text,job.id);
      await this.service.store.run(g,u=>u.put("notification",job.id,{text:p.text,reactivation:Boolean(p.reactivation)},"SENT",p.userId));return result;
    }
    return this.service.store.run(g,async u=>{
      if(job.kind==="close")return closeModule(this.service,u,p.kind,p.id);
      if(job.kind==="season-start") {const row=(await u.get("season",p.id))!;if(row.status!=="SCHEDULED")return;requireRule(!(await u.list("season")).some(s=>s.status==="ACTIVE"),"Outra temporada está ativa");await u.put("season",row.id,row.data,"ACTIVE",row.owner_id);return;}
      if(job.kind==="qualify")return qualifyReferral(this.service,u,p.id);
      if(job.kind==="reminder") {
        const event=(await u.get("event",p.eventId))!;if(event.status!=="ACTIVE" || Date.parse(event.data.startsAt)<Date.now())return;
        for(const attendance of (await u.list("attendance")).filter(a=>a.data.eventId===event.id && a.status==="REGISTERED"))await u.enqueue("notify",`${job.id}:${attendance.owner_id}`,{userId:attendance.owner_id,text:`Lembrete: ${event.data.name} começa em ${event.data.startsAt}.`});return;
      }
      if(job.kind==="maintenance") {
        const settings=await this.service.settings(u),now=this.service.now();
        const members=(await u.db.query("SELECT * FROM guild_members WHERE guild_id=$1 AND participation='active'",[g])).rows;
        const activities=await u.list("activity");
        for(const member of members) {
          const last=activities.filter(r=>r.owner_id===member.user_id).map(r=>Date.parse(r.data.at)).sort((a,b)=>b-a)[0]??member.consented_at?.getTime()??now.getTime();
          if(member.preferences.reactivation && now.getTime()-last>=settings.reactivationDays*86400000)await u.enqueue("notify",`reactivate:${member.user_id}:${last}`,{userId:member.user_id,reactivation:true,text:"Sua divisão continua construindo a história da base. Se quiser voltar, suas missões estão no painel."});
        }
        const cutoff=new Date(now.getTime()-settings.retentionDays*86400000);
        await u.db.query("DELETE FROM rpg_records WHERE guild_id=$1 AND kind='activity' AND created_at<$2",[g,cutoff]);
        await u.db.query("DELETE FROM oauth_states WHERE expires_at<NOW()");await u.db.query("DELETE FROM web_sessions WHERE expires_at<NOW()");await u.db.query("DELETE FROM rate_limits WHERE expires_at<NOW()");
        await u.db.query("UPDATE jobs SET status='failed',last_error='Limite de tentativas após interrupção' WHERE status='running' AND lease_until<NOW() AND attempts>=5");
        return {day:localDay(now,settings.timezone)};
      }
      throw new AppError("UNKNOWN_JOB","Tipo de tarefa não reconhecido");
    });
  }
  start():void {
    const tick=async()=>{
      if(this.stopping)return;
      try{
        const guilds=(await this.service.store.database.query("SELECT id FROM guilds")).rows;
        for(const guild of guilds)await this.service.store.run(guild.id,u=>u.enqueue("maintenance",new Date().toISOString().slice(0,13),{}));
        let count=0;while(!this.stopping && count++<20 && await this.once()){}
      }catch{console.error(JSON.stringify({level:"error",event:"worker.poll_failed"}));}
      if(!this.stopping)this.timer=setTimeout(()=>{this.active=tick();},2000);
    };
    this.active=tick();
  }
  async stop():Promise<void>{this.stopping=true;if(this.timer)clearTimeout(this.timer);await this.active;}
}
