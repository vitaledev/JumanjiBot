import { randomUUID } from "node:crypto";
import { z } from "zod";
import { localDay, periodKey, requireRule, type Actor } from "./contracts.js";
import { handled, type ActionResult } from "./actions.js";
import type { GameService } from "./service.js";
import type { UnitOfWork } from "./store.js";
const id=z.string().min(1).max(200);
const reason=z.string().trim().min(5).max(1000);
export async function communityAction(s: GameService,u: UnitOfWork,a: Actor,action: string,b: Record<string,unknown>): Promise<ActionResult> {
  if(action==="event.rsvp" || action==="event.cancel" || action==="event.checkin") {
    const event=(await u.get("event",id.parse(b.id)))!;
    requireRule(event.status==="ACTIVE" && Date.parse(event.data.endsAt)>s.now().getTime(),"Evento encerrado ou indisponível");
    const userId=action==="event.checkin"?id.parse(b.userId):a.id;
    const member=(await s.member(u,userId))!;
    if(event.data.divisionId) requireRule(member.division_id===event.data.divisionId,"Evento exclusivo de outra divisão",403);
    const key=`${event.id}:${s.subject(u.guildId,userId)}`;
    const existing=await u.get("attendance",key,true);
    if(action==="event.checkin") {
      await s.manage(u,a,event.data.divisionId);
      requireRule(Date.parse(event.data.startsAt)<=s.now().getTime(),"O evento ainda não começou");
      requireRule(existing && existing.status!=="CANCELLED","O membro precisa se inscrever");
      if(existing.status==="APPROVED") return handled(existing);
      await s.reward(u,userId,event.data.reward,`event:${key}`,event.data.name,a.id);
      await s.progress(u,userId,"event",event.id);
      await u.audit(a.id,"event.attended",userId,reason.parse(b.reason));
    } else requireRule(existing?.status!=="APPROVED","Presença já validada");
    const row=await u.put("attendance",key,{eventId:event.id,name:event.data.name},action==="event.checkin"?"APPROVED":action==="event.cancel"?"CANCELLED":"REGISTERED",userId);
    await u.edge("event",event.id,"attendance",key);return handled(row);
  }
  if(action==="proof.submit") {
    await s.member(u,a.id);
    const assignment=(await u.get("assignment",id.parse(b.assignmentId)))!;
    requireRule(assignment.owner_id===a.id && ["ACTIVE","CHANGES_REQUESTED","REJECTED"].includes(assignment.status),"Missão não aceita novas provas",403);
    const mission=(await u.get("mission",assignment.data.missionId))!;
    requireRule(mission.status==="ACTIVE" && mission.data.action==="external","Missão sem revisão externa");
    requireRule(!mission.data.endsAt || Date.parse(mission.data.endsAt)>s.now().getTime(),"Missão expirada");
    let url=b.url ? z.url().parse(b.url):null;
    if(url) {const parsed=new URL(url);requireRule(["https:","http:"].includes(parsed.protocol),"Use uma URL pública HTTP(S)");parsed.hash="";url=parsed.toString();}
    const fileId=b.fileId?id.parse(b.fileId):null;
    requireRule(url || fileId,"Envie URL ou imagem");
    if(fileId) requireRule((await u.db.query("SELECT 1 FROM private_files WHERE guild_id=$1 AND id=$2 AND user_id=$3",[u.guildId,fileId,a.id])).rowCount,"Imagem inválida",403);
    const duplicate=(await u.list("submission")).some(r=>r.data.assignmentId!==assignment.id && (url && r.data.url===url || fileId && r.data.fileId===fileId));
    requireRule(!duplicate,"Prova já enviada em outra atribuição");
    const row=await u.put("submission",randomUUID(),{assignmentId:assignment.id,missionId:mission.id,url,fileId},"PENDING",a.id);
    await u.edge("assignment",assignment.id,"submission",row.id);
    await u.put("assignment",assignment.id,assignment.data,"UNDER_REVIEW",a.id);
    return handled(row);
  }
  if(action==="proof.review") {
    await s.manage(u,a,undefined,true);
    const row=(await u.get("submission",id.parse(b.id)))!;
    requireRule(row.status==="PENDING","A prova já foi revisada");requireRule(row.owner_id!==a.id,"Outra pessoa deve revisar sua prova",403);
    const decision=z.enum(["APPROVED","REJECTED","CHANGES_REQUESTED"]).parse(b.decision),reviewReason=reason.parse(b.reason);
    const assignment=(await u.get("assignment",row.data.assignmentId))!;
    requireRule(assignment.status==="UNDER_REVIEW","Atribuição não está em revisão");
    if(decision==="APPROVED") {await s.reward(u,row.owner_id!,assignment.data.reward,`mission:${assignment.id}`,assignment.data.name,a.id);assignment.data.progress=assignment.data.target;assignment.data.completedAt=s.now().toISOString();}
    await u.put("assignment",assignment.id,assignment.data,decision==="APPROVED"?"COMPLETED":decision,row.owner_id);
    const reviewed=await u.put("submission",row.id,{...row.data,reviewer:a.id,reason:reviewReason,reviewedAt:s.now().toISOString()},decision,row.owner_id);
    await u.audit(a.id,"proof.reviewed",row.id,reviewReason,{decision});return handled(reviewed);
  }
  if(action==="campaign.invite") {
    await s.member(u,a.id);const campaign=(await u.get("campaign",id.parse(b.id)))!;
    requireRule(campaign.status==="ACTIVE" && Date.parse(campaign.data.endsAt)>s.now().getTime(),"Campanha encerrada");
    return handled({jobId:await u.enqueue("invite-create",`${campaign.id}:${a.id}`,{campaignId:campaign.id,userId:a.id}),status:"accepted"});
  }
  if(action==="ambassador.set") {
    await s.manage(u,a,undefined,true);const userId=id.parse(b.userId);await s.member(u,userId);
    const active=z.boolean().parse(b.active);await u.put("ambassador",userId,{reason:reason.parse(b.reason)},active?"ACTIVE":"REMOVED",userId);await u.audit(a.id,"ambassador.changed",userId,String(b.reason));return handled();
  }
  if(action==="welcome.confirm") {
    await s.member(u,a.id);const userId=id.parse(b.userId);const target=(await s.member(u,userId))!;
    requireRule(a.id!==userId && s.now().getTime()-target.joined_at.getTime()<7*86400000,"Escolha um recruta recente");
    const key=`${a.id}:${userId}`;requireRule(!await u.get("welcome",key,true),"Acolhimento já registrado");
    await u.put("welcome",key,{helper:a.id,target:userId},"PENDING",userId);return handled({id:key});
  }
  if(action==="welcome.accept") {
    const row=(await u.get("welcome",id.parse(b.id)))!;requireRule(row.owner_id===a.id && row.status==="PENDING","Acolhimento inválido",403);
    const week=periodKey("weekly",s.now(),(await s.settings(u)).timezone);
    const approved=(await u.list("welcome")).filter(r=>r.status==="APPROVED" && r.data.helper===row.data.helper && r.data.week===week);
    requireRule(approved.length<3,"Limite semanal de acolhimentos alcançado");
    await s.reward(u,row.data.helper,{honor:15},`welcome:${row.id}`,"Acolhimento confirmado",a.id);
    await s.progress(u,row.data.helper,"welcome",row.id);
    return handled(await u.put("welcome",row.id,{...row.data,week},"APPROVED",a.id));
  }
  if(action==="moderation.report") {
    await s.member(u,a.id);
    const data=z.object({userId:id,reason,channelId:id.optional(),messageId:id.optional()}).parse(b);
    return handled(await u.put("moderation",randomUUID(),{...data,reporter:a.id,action:"report"},"OPEN",a.id));
  }
  if(action==="moderation.request") {
    const settings=await s.settings(u);requireRule(settings.moderation && !settings.pauseModeration,"Moderação delegada desativada");
    const data=z.object({userId:id,action:z.enum(["warn","timeout","delete","kick","ban","ticket"]),reason,minutes:z.number().int().min(0).max(40320).default(0),channelId:id.optional(),messageId:id.optional(),divisionId:id.optional()}).parse(b);
    await s.manage(u,a,data.divisionId);
    requireRule(data.userId!==a.id,"Não é possível moderar a si mesmo");
    if(!a.admin) {
      requireRule(!["kick","ban"].includes(data.action),"Expulsão e banimento exigem administrador",403);
      const member=(await s.member(u,a.id))!;
      requireRule(member.division_id && data.divisionId===member.division_id,"Ação fora da divisão",403);
      const limit=member.rpg_role==="captain"?settings.captainTimeoutMinutes:settings.viceTimeoutMinutes;
      requireRule(data.minutes<=limit,"Duração acima do permitido",403);
      const today=(await u.list("moderation")).filter(r=>r.data.requestedBy===a.id && r.data.day===localDay(s.now(),settings.timezone));requireRule(today.length<settings.moderatorDailyLimit,"Limite diário de moderação alcançado");
    }
    if(data.action==="timeout") requireRule(data.minutes>0,"Informe a duração do silenciamento");
    if(data.action==="delete") requireRule(data.channelId && data.messageId,"Informe canal e mensagem");
    const row=await u.put("moderation",randomUUID(),{...data,requestedBy:a.id,day:localDay(s.now(),settings.timezone)},["kick","ban"].includes(data.action)?"AWAITING_APPROVAL":"PENDING",a.id);
    await u.audit(a.id,"moderation.requested",data.userId,data.reason,{caseId:row.id});
    if(row.status==="PENDING") return handled({case:row,jobId:await u.enqueue("moderation",row.id,{caseId:row.id,actorId:a.id}),status:"accepted"});
    return handled(row);
  }
  if(action==="moderation.approve") {
    await s.manage(u,a,undefined,true);const row=(await u.get("moderation",id.parse(b.id)))!;
    requireRule(row.status==="AWAITING_APPROVAL","Caso não aguarda aprovação");requireRule(b.confirm===true,"Confirme a ação administrativa");
    await u.put("moderation",row.id,{...row.data,approvedBy:a.id},"PENDING",row.owner_id);
    await u.audit(a.id,"moderation.approved",row.id,reason.parse(b.reason));return handled({jobId:await u.enqueue("moderation",row.id,{caseId:row.id,actorId:a.id}),status:"accepted"});
  }
  if(action==="moderation.appeal") {
    const row=(await u.get("moderation",id.parse(b.id)))!;requireRule(row.data.userId===a.id && ["ACTIONED","FAILED"].includes(row.status),"Recurso indisponível",403);
    return handled(await u.put("moderation",row.id,{...row.data,appeal:reason.parse(b.reason)},"APPEALED",row.owner_id));
  }
  if(action==="moderation.resolve") {
    await s.manage(u,a,undefined,true);const row=(await u.get("moderation",id.parse(b.id)))!;
    requireRule(["OPEN","APPEALED","FAILED","ACTIONED"].includes(row.status),"Caso não pode ser encerrado");
    const resolution=reason.parse(b.reason);await u.audit(a.id,"moderation.resolved",row.id,resolution);
    return handled(await u.put("moderation",row.id,{...row.data,resolution,resolvedBy:a.id},"CLOSED",row.owner_id));
  }
  if(action==="streak.rest") {
    await s.member(u,a.id);const week=periodKey("weekly",s.now(),(await s.settings(u)).timezone),key=`${a.id}:${week}`;
    requireRule(!await u.get("rest",key,true),"Descanso já utilizado nesta semana");
    await s.credit(u,a.id,"credits",-5,`rest:${key}`,"Dia de descanso",a.id);return handled(await u.put("rest",key,{week,day:localDay(s.now(),(await s.settings(u)).timezone)},"ACTIVE",a.id));
  }
  return {handled:false};
}

export async function qualifyReferral(s: GameService,u: UnitOfWork,referralId: string): Promise<void> {
  const referral=(await u.get("referral",referralId))!;
  if(referral.status!=="PENDING") return;
  const campaign=(await u.get("campaign",referral.data.campaignId))!;
  const target=await s.member(u,referral.data.userId,false);
  const inviter=await s.member(u,referral.owner_id!,false);
  if(!target || target.participation!=="active" || !referral.data.present || inviter?.participation!=="active") {await u.put("referral",referral.id,referral.data,"REJECTED",referral.owner_id);return;}
  const days=new Set((await u.list("activity")).filter(r=>r.owner_id===target.user_id && Date.parse(r.data.at)>=Date.parse(referral.data.joinedAt)).map(r=>r.data.day));
  if(days.size<campaign.data.activeDays) {await u.put("referral",referral.id,referral.data,"REJECTED",referral.owner_id);return;}
  const week=periodKey("weekly",s.now(),(await s.settings(u)).timezone);
  const count=(await u.list("referral")).filter(r=>r.owner_id===inviter.user_id && r.status==="QUALIFIED" && r.data.week===week).length;
  if(count>=campaign.data.weeklyCap) {await u.put("referral",referral.id,referral.data,"REJECTED",referral.owner_id);return;}
  await s.reward(u,inviter.user_id,campaign.data.reward,`referral:${s.subject(u.guildId,target.user_id)}`,"Convite qualificado");
  await u.put("referral",referral.id,{...referral.data,week},"QUALIFIED",referral.owner_id);
}
