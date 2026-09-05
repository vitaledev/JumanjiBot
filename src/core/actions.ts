import { randomUUID } from "node:crypto";
import { z } from "zod";
import { definitions, requireRule, settingsSchema, type Actor, type ModuleKind } from "./contracts.js";
import type { GameService } from "./service.js";
import type { UnitOfWork } from "./store.js";
export type ActionResult = {handled:true;value:unknown}|{handled:false};
export const handled = (value: unknown = {ok:true}): ActionResult => ({handled:true,value});
const identifier = z.string().min(1).max(160);
const reasonSchema = z.string().trim().min(5).max(1000);

export async function coreAction(s: GameService,u: UnitOfWork,a: Actor,action: string,b: Record<string,unknown>): Promise<ActionResult> {
  if (action === "consent") {
    requireRule(b.accept === true,"É necessário aceitar explicitamente a participação");
    const subject=s.subject(u.guildId,a.id);
    await u.db.query(`INSERT INTO guild_members(guild_id,user_id,display_name,avatar_url,participation,consented_at)
      VALUES($1,$2,$3,$4,'active',NOW()) ON CONFLICT(guild_id,user_id) DO UPDATE SET participation='active',
      consented_at=COALESCE(guild_members.consented_at,NOW()),display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url`,[u.guildId,a.id,a.name,a.avatar??""]);
    await u.db.query("UPDATE point_ledger SET user_id=$3 WHERE guild_id=$1 AND user_id=$2",[u.guildId,a.id,subject]);
    await u.db.query("INSERT INTO privacy_markers(guild_id,subject_hash,opted_out) VALUES($1,$2,false) ON CONFLICT(guild_id,subject_hash) DO UPDATE SET opted_out=false",[u.guildId,subject]);
    await s.assign(u,a.id); await s.progress(u,a.id,"onboarding","consent");
    await u.audit(a.id,"participation.consented"); return handled(await s.member(u,a.id));
  }
  if (action === "privacy.preferences") {
    await s.member(u,a.id);
    const preferences=z.object({notifications:z.boolean(),reactivation:z.boolean()}).parse(b);
    await u.db.query("UPDATE guild_members SET preferences=$3 WHERE guild_id=$1 AND user_id=$2",[u.guildId,a.id,preferences]);return handled(preferences);
  }
  if (action === "privacy.export") {
    return handled({member:await s.member(u,a.id,false),ledger:(await u.db.query("SELECT amount,point_type,reason,created_at FROM point_ledger WHERE guild_id=$1 AND user_id=$2",[u.guildId,s.subject(u.guildId,a.id)])).rows,records:(await u.db.query("SELECT kind,status,data,created_at FROM rpg_records WHERE guild_id=$1 AND owner_id=$2 AND kind NOT IN ('moderation','webhook')",[u.guildId,a.id])).rows});
  }
  if (action === "privacy.leave") {
    requireRule(b.confirm === true,"Confirme a exclusão");
    const subject=s.subject(u.guildId,a.id);
    const files=(await u.db.query("SELECT id FROM private_files WHERE guild_id=$1 AND user_id=$2",[u.guildId,a.id])).rows;
    await u.db.query("INSERT INTO privacy_markers(guild_id,subject_hash) VALUES($1,$2) ON CONFLICT(guild_id,subject_hash) DO UPDATE SET opted_out=true",[u.guildId,subject]);
    await u.db.query("UPDATE divisions SET captain_id=CASE WHEN captain_id=$2 THEN NULL ELSE captain_id END,vice_captain_id=CASE WHEN vice_captain_id=$2 THEN NULL ELSE vice_captain_id END WHERE guild_id=$1",[u.guildId,a.id]);
    await u.db.query("UPDATE point_ledger SET user_id=$3 WHERE guild_id=$1 AND user_id=$2",[u.guildId,a.id,subject]);
    await u.db.query("UPDATE point_ledger SET actor_id=$3 WHERE guild_id=$1 AND actor_id=$2",[u.guildId,a.id,subject]);
    await u.db.query("UPDATE audit_logs SET actor_id=CASE WHEN actor_id=$2 THEN $3 ELSE actor_id END,target_id=CASE WHEN target_id=$2 THEN $3 ELSE target_id END,reason=NULL,metadata='{}' WHERE guild_id=$1 AND (actor_id=$2 OR target_id=$2)",[u.guildId,a.id,subject]);
    // Remove user-owned transient content. Preserve only pseudonymous deduplication facts.
    await u.db.query("UPDATE rpg_records SET owner_id=$3,data='{}' WHERE guild_id=$1 AND owner_id=$2 AND kind IN ('mission-event','unlock')",[u.guildId,a.id,subject]);
    await u.db.query("DELETE FROM rpg_records WHERE guild_id=$1 AND owner_id=$2 AND kind NOT IN ('mission','event','campaign','season','item','achievement','chapter','battle','challenge','experiment','webhook','journal','territory','election')",[u.guildId,a.id]);
    await u.db.query("UPDATE rpg_records SET owner_id=$3 WHERE guild_id=$1 AND owner_id=$2",[u.guildId,a.id,subject]);
    await u.db.query("DELETE FROM guild_members WHERE guild_id=$1 AND user_id=$2",[u.guildId,a.id]);
    await u.db.query("DELETE FROM private_files WHERE guild_id=$1 AND user_id=$2",[u.guildId,a.id]);
    await u.db.query("UPDATE jobs SET status='cancelled',payload='{}' WHERE guild_id=$1 AND payload->>'userId'=$2 AND status IN ('pending','running')",[u.guildId,a.id]);
    await u.enqueue("delete-files",`privacy:${subject}:${randomUUID()}`,{fileIds:files.map(f=>f.id)});
    await u.enqueue("roles",`privacy:${subject}:${randomUUID()}`,{userId:a.id});
    await u.audit(subject,"participation.deleted");return handled();
  }
  if (action === "settings.preview" || action === "settings.save") {
    await s.manage(u,a,undefined,true);
    const previous=await s.settings(u); const settings=settingsSchema.parse({...previous,...b});
    const preview={settings,impact:{dailyTextXp:settings.messageCap,weeklyTextXp:settings.messageCap*7,maximumTextAwards:Math.floor(settings.messageCap/Math.max(1,settings.messageXp))}};
    if (action.endsWith("save")) { requireRule(b.confirm===true,"Revise a prévia e confirme as regras");await u.db.query("UPDATE guilds SET settings=$2 WHERE id=$1",[u.guildId,settings]);await u.audit(a.id,"settings.changed",u.guildId); }
    return handled(preview);
  }
  if (action === "emergency") {
    await s.manage(u,a,undefined,true); const reason=reasonSchema.parse(b.reason); const settings=await s.settings(u);
    const flags=z.object({pausePoints:z.boolean(),pauseMissions:z.boolean(),pauseModeration:z.boolean()}).parse(b);
    await u.db.query("UPDATE guilds SET settings=$2 WHERE id=$1",[u.guildId,{...settings,...flags}]);
    await u.audit(a.id,"emergency.changed",u.guildId,reason);return handled();
  }
  if (action === "setup.draft" || action === "setup.confirm") {
    await s.manage(u,a,undefined,true);
    const data=z.object({name:z.string().trim().min(2).max(40),color:z.string().regex(/^#[0-9A-Fa-f]{6}$/),count:z.number().int().min(1).max(12),memberLimit:z.number().int().min(1).max(1000).default(25)}).parse(b);
    const draft=await u.put("setup","current",data,"DRAFT",a.id);
    if (action==="setup.draft") return handled({draft,preview:{roles:["Recruta","Membro","Capitão","Vice-capitão"],channels:["painel-rpg","missoes","ranking","auditoria"],divisions:Array.from({length:data.count},(_,i)=>`${data.name} ${i+1}`)}});
    requireRule(b.confirm===true,"Confirme a criação da estrutura");
    const settings={...await s.settings(u),name:data.name,color:data.color};
    await u.db.query("UPDATE guilds SET name=$2,settings=$3 WHERE id=$1",[u.guildId,data.name,settings]);
    for(let i=1;i<=data.count;i++) await u.db.query("INSERT INTO divisions(id,guild_id,number,name,color,motto,member_limit) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(guild_id,number) DO NOTHING",[`${u.guildId}:division:${i}`,u.guildId,i,`${data.name} ${i}`,data.color,`Divisão ${i}`,data.memberLimit]);
    if (!(await u.list("mission")).length) {
      for (const data of [
        {name:"Primeiro passo",description:"Aceite a participação no RPG",action:"onboarding",target:1,period:"once",reward:{xp:10,credits:5}},
        {name:"Presença na base",description:"Converse respeitando as regras do servidor",action:"text",target:1,period:"daily",reward:{xp:25,division:5}},
        {name:"Voz da divisão",description:"Participe de 30 minutos de chamada elegível",action:"voice",target:1800,period:"daily",reward:{xp:20,credits:5,division:10}}
      ]) {const row=await s.define(u,a,"mission",data);await u.put("mission",row.id,row.data,"ACTIVE",a.id);}
    }
    const jobId=await u.enqueue("provision",`setup:${JSON.stringify(data)}`,{actorId:a.id});
    await u.put("setup","current",{...data,jobId},"PENDING",a.id);await u.audit(a.id,"setup.confirmed",jobId);return handled({jobId,status:"accepted"});
  }
  if (action === "members.sync") {await s.manage(u,a,undefined,true);return handled({jobId:await u.enqueue("sync-members",randomUUID(),{actorId:a.id}),status:"accepted"});}
  if (action === "division.save") {
    await s.manage(u,a);
    const data=z.object({id:identifier.optional(),number:z.number().int().min(1),name:z.string().min(2).max(60),color:z.string().regex(/^#[0-9A-Fa-f]{6}$/),motto:z.string().max(200).default(""),memberLimit:z.number().int().min(1).max(1000)}).parse(b);
    const id=data.id??randomUUID();
    if (data.id) {const count=Number((await u.db.query("SELECT COUNT(*) FROM guild_members WHERE guild_id=$1 AND division_id=$2",[u.guildId,id])).rows[0].count);requireRule(count<=data.memberLimit,"Limite menor que a ocupação atual");requireRule((await u.db.query("UPDATE divisions SET name=$3,color=$4,motto=$5,member_limit=$6,number=$7 WHERE guild_id=$1 AND id=$2 RETURNING id",[u.guildId,id,data.name,data.color,data.motto,data.memberLimit,data.number])).rowCount,"Divisão não encontrada",404);}
    else await u.db.query("INSERT INTO divisions(id,guild_id,number,name,color,motto,member_limit) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,u.guildId,data.number,data.name,data.color,data.motto,data.memberLimit]);
    await u.audit(a.id,"division.saved",id);return handled({id});
  }
  if (action === "division.archive") {
    await s.manage(u,a);const id=identifier.parse(b.id);
    requireRule(!(await u.db.query("SELECT 1 FROM guild_members WHERE guild_id=$1 AND division_id=$2",[u.guildId,id])).rowCount,"Transfira os membros antes de arquivar");
    requireRule((await u.db.query("UPDATE divisions SET status='archived',captain_id=NULL,vice_captain_id=NULL WHERE guild_id=$1 AND id=$2 RETURNING id",[u.guildId,id])).rowCount,"Divisão não encontrada",404);await u.audit(a.id,"division.archived",id);return handled();
  }
  if (action === "division.invite") {
    const divisionId=identifier.parse(b.divisionId),userId=identifier.parse(b.userId);
    await s.manage(u,a,divisionId);await s.member(u,userId);
    const invite=await u.put("invitation",randomUUID(),{divisionId,from:a.id,expiresAt:new Date(s.now().getTime()+7*86400000).toISOString()},"PENDING",userId);
    await u.audit(a.id,"division.invited",userId);return handled(invite);
  }
  if (action === "division.join" || action === "division.transfer" || action === "division.accept") {
    const userId=action==="division.transfer"?identifier.parse(b.userId):a.id;
    const m=(await s.member(u,userId))!; const settings=await s.settings(u);
    let divisionId=b.divisionId ? identifier.parse(b.divisionId) : "";
    if (action==="division.transfer") {await s.manage(u,a);reasonSchema.parse(b.reason);}
    else if (action==="division.accept") {const invite=(await u.get("invitation",identifier.parse(b.id)))!;requireRule(invite.owner_id===a.id && invite.status==="PENDING" && Date.parse(invite.data.expiresAt)>s.now().getTime(),"Convite inválido");divisionId=invite.data.divisionId;await u.put("invitation",invite.id,invite.data,"ACCEPTED",a.id);}
    else {
      requireRule(!m.division_id || m.division_id===divisionId,"Solicite transferência para mudar de divisão");
      requireRule(!["invite","recruitment"].includes(settings.entryMode),"A entrada depende de convite ou liberação da liderança");
      if (settings.entryMode==="balanced") divisionId=(await u.db.query("SELECT d.id FROM divisions d LEFT JOIN guild_members m ON m.guild_id=d.guild_id AND m.division_id=d.id WHERE d.guild_id=$1 AND d.status='active' GROUP BY d.id HAVING COUNT(m.user_id)<d.member_limit ORDER BY COUNT(m.user_id),d.number LIMIT 1",[u.guildId])).rows[0]?.id??"";
    }
    const d=(await u.db.query("SELECT * FROM divisions WHERE guild_id=$1 AND id=$2 AND status='active'",[u.guildId,divisionId])).rows[0];requireRule(d,"Divisão indisponível",404);
    const occupied=Number((await u.db.query("SELECT COUNT(*) FROM guild_members WHERE guild_id=$1 AND division_id=$2 AND user_id<>$3",[u.guildId,divisionId,userId])).rows[0].count);requireRule(occupied<d.member_limit,"Divisão sem vagas");
    await u.db.query("UPDATE divisions SET captain_id=CASE WHEN captain_id=$2 THEN NULL ELSE captain_id END,vice_captain_id=CASE WHEN vice_captain_id=$2 THEN NULL ELSE vice_captain_id END WHERE guild_id=$1 AND id<>$3",[u.guildId,userId,divisionId]);
    await u.db.query("UPDATE guild_members SET division_id=$3,rpg_role=CASE WHEN division_id=$3 THEN rpg_role ELSE 'member' END WHERE guild_id=$1 AND user_id=$2",[u.guildId,userId,divisionId]);
    await u.audit(a.id,action,userId,String(b.reason??"Escolha do membro"));await u.enqueue("roles",randomUUID(),{userId});return handled({divisionId});
  }
  if (action === "leadership.set" || action === "leadership.remove") {
    await s.manage(u,a);const divisionId=identifier.parse(b.divisionId),position=z.enum(["captain","vice-captain"]).parse(b.position);
    const division=(await u.db.query("SELECT * FROM divisions WHERE guild_id=$1 AND id=$2 AND status='active'",[u.guildId,divisionId])).rows[0];requireRule(division,"Divisão inválida",404);
    const userId=action.endsWith("remove")?null:identifier.parse(b.userId);
    if(userId) {const member=(await s.member(u,userId))!;requireRule(member.division_id===divisionId,"Líder deve pertencer à divisão");requireRule(division[position==="captain"?"vice_captain_id":"captain_id"]!==userId,"Capitão e vice devem ser pessoas diferentes");}
    const field=position==="captain"?"captain_id":"vice_captain_id",old=division[field];
    await u.db.query(`UPDATE divisions SET ${field}=$3 WHERE guild_id=$1 AND id=$2`,[u.guildId,divisionId,userId]);
    if(old) {await u.db.query("UPDATE guild_members SET rpg_role='member' WHERE guild_id=$1 AND user_id=$2",[u.guildId,old]);await u.enqueue("roles",randomUUID(),{userId:old});}
    if(userId) {await u.db.query("UPDATE guild_members SET rpg_role=$3 WHERE guild_id=$1 AND user_id=$2",[u.guildId,userId,position]);await u.enqueue("roles",randomUUID(),{userId});}
    await u.audit(a.id,action,userId??old,reasonSchema.parse(b.reason));return handled();
  }
  if(action==="definition.save") {const kind=z.enum(Object.keys(definitions) as [ModuleKind,...ModuleKind[]]).parse(b.kind);return handled(await s.define(u,a,kind,b.data,b.id?identifier.parse(b.id):undefined));}
  if(action==="definition.publish") {
    await s.manage(u,a,undefined,true);const kind=z.enum(Object.keys(definitions) as [ModuleKind,...ModuleKind[]]).parse(b.kind),id=identifier.parse(b.id);const row=(await u.get(kind,id))!;
    requireRule(row.status==="DRAFT","O registro já foi publicado");
    if(row.data.endsAt) requireRule(Date.parse(row.data.endsAt)>s.now().getTime(),"Prazo já encerrado");
    if(kind==="battle") {row.data.roster=[];row.data.strategies={};}
    const scheduled=kind==="season" && row.data.startsAt && Date.parse(row.data.startsAt)>s.now().getTime();
    await u.put(kind,id,row.data,scheduled?"SCHEDULED":kind==="battle"?"RECRUITING":"ACTIVE",row.owner_id);
    if(scheduled) await u.enqueue("season-start",id,{id},new Date(row.data.startsAt));
    if(row.data.endsAt) await u.enqueue("close",`${kind}:${id}`,{kind,id},new Date(row.data.endsAt));
    if(kind==="event") for(const minutes of [1440,30]) {const at=new Date(Date.parse(row.data.startsAt)-minutes*60000);if(at>s.now()) await u.enqueue("reminder",`${id}:${minutes}`,{eventId:id},at);}
    if(["chapter","journal"].includes(kind)) await u.enqueue("publish",`${kind}:${id}`,{kind,id,actorId:a.id});
    await u.audit(a.id,`${kind}.published`,id);return handled({id,status:scheduled?"SCHEDULED":"ACTIVE"});
  }
  if(action==="points.adjust") {
    await s.manage(u,a,undefined,true); const userId=identifier.parse(b.userId),type=z.enum(["xp","honor","influence","credits"]).parse(b.type),amount=z.number().int().min(-1000).max(1000).parse(b.amount),reason=reasonSchema.parse(b.reason),key=identifier.parse(b.eventKey);
    await s.credit(u,userId,type,amount,`manual:${key}`,reason,a.id);await u.audit(a.id,"points.adjusted",userId,reason,{type,amount});return handled();
  }
  if(action==="points.reverse") {
    await s.manage(u,a,undefined,true);const id=identifier.parse(b.id),userId=identifier.parse(b.userId),reason=reasonSchema.parse(b.reason);
    const row=(await u.db.query("SELECT * FROM point_ledger WHERE guild_id=$1 AND id=$2 AND user_id=$3",[u.guildId,id,s.subject(u.guildId,userId)])).rows[0];requireRule(row && !row.reversal_of,"Movimentação inválida");
    await s.credit(u,userId,row.point_type,-row.amount,`reversal:${id}`,reason,a.id,row.season_id??undefined,id);await u.audit(a.id,"points.reversed",id,reason);return handled();
  }
  if(action==="job.retry") {
    await s.manage(u,a,undefined,true);const id=identifier.parse(b.id);
    requireRule((await u.db.query("UPDATE jobs SET status='pending',attempts=0,run_at=NOW(),last_error=NULL WHERE guild_id=$1 AND id=$2 AND status='failed' RETURNING id",[u.guildId,id])).rowCount,"Somente tarefas com falha podem ser retomadas");await u.audit(a.id,"job.retried",id);return handled({jobId:id});
  }
  return {handled:false};
}
