import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRule, type Actor, type RecordRow } from "./contracts.js";
import { handled, type ActionResult } from "./actions.js";
import type { GameService } from "./service.js";
import type { UnitOfWork } from "./store.js";
const id=z.string().min(1).max(200);
export type Strategy="attack"|"defend"|"maneuver";
export function battleScore(left: number[],right: number[],leftStrategy: Strategy,rightStrategy: Strategy,cap: number): {left:number;right:number;winner:"left"|"right"|"tie"} {
  const wins: Record<Strategy,Strategy>={attack:"maneuver",maneuver:"defend",defend:"attack"};
  const average=(values:number[])=>values.length?values.reduce((n,v)=>n+Math.min(cap,Math.max(0,v)),0)/values.length:0;
  const l=Math.round(average(left)*(wins[leftStrategy]===rightStrategy?1.1:1)*1000)/1000;
  const r=Math.round(average(right)*(wins[rightStrategy]===leftStrategy?1.1:1)*1000)/1000;
  return {left:l,right:r,winner:l===r?"tie":l>r?"left":"right"};
}
export function rankScores(rows: RecordRow[]): RecordRow[] {return [...rows].sort((a,b)=>b.data.score-a.data.score || String(a.data.reachedAt).localeCompare(String(b.data.reachedAt)) || String(a.data.userId).localeCompare(String(b.data.userId)));}

export async function advancedAction(s: GameService,u: UnitOfWork,a: Actor,action:string,b:Record<string,unknown>):Promise<ActionResult> {
  if(action==="season.finish" || action==="season.archive") {
    await s.manage(u,a,undefined,true); const season=(await u.get("season",id.parse(b.id)))!;
    if(action.endsWith("archive")) {requireRule(season.status==="FINISHED","Encerre a temporada antes de arquivar");return handled(await u.put("season",season.id,season.data,"ARCHIVED",season.owner_id));}
    await finishSeason(s,u,season.id,a.id);return handled(await u.get("season",season.id));
  }
  if(action==="template.generate") {
    await s.manage(u,a,undefined,true);
    const template=z.enum(["mission","chapter","campaign","journal","summary"]).parse(b.template),name=z.string().min(2).max(100).parse(b.name),objective=z.string().min(5).max(1000).parse(b.objective);
    const metrics=await s.metrics(u) as Record<string,any>;
    const body=`${name}\n\nObjetivo: ${objective}\n\nA comunidade reúne ${metrics.active} participantes ativos. Foram concluídas ${metrics.missions.completed} missões e validadas ${metrics.events.attended} presenças.\n\nParticipe no seu ritmo. Revise os critérios, o prazo e as recompensas antes da publicação.`;
    if(template==="mission") return handled(await s.define(u,a,"mission",{name,description:objective,action:"text",target:1,period:"weekly",reward:{xp:25,credits:5}}));
    if(template==="campaign") return handled(await s.define(u,a,"campaign",{name,description:body,template:z.enum(["recruitment","emblems","recruits","operation","chronicle"]).parse(b.campaignTemplate??"recruitment"),endsAt:new Date(s.now().getTime()+14*86400000).toISOString(),reward:{influence:50,credits:10}}));
    if(template==="chapter") return handled(await s.define(u,a,"chapter",{name,body,seasonId:id.parse(b.seasonId),choices:["Reunir aliados","Explorar o território"],endsAt:new Date(s.now().getTime()+7*86400000).toISOString()}));
    return handled(await s.define(u,a,"journal",{name,body}));
  }
  const prefixes=["battle.","challenge.","inventory.","shop.","chapter.","relationship.","election.","territory.","pet."];
  if(!prefixes.some(p=>action.startsWith(p))) return {handled:false};
  requireRule((await s.settings(u)).advanced,"Recursos avançados desativados neste servidor");
  const member=(await s.member(u,a.id))!;
  if(action==="shop.buy") {
    const item=(await u.get("item",id.parse(b.id)))!;requireRule(item.status==="ACTIVE","Item indisponível");
    const key=`${item.id}:${s.subject(u.guildId,a.id)}`;const owned=await u.get("inventory",key,true);if(owned)return handled(owned);
    await s.credit(u,a.id,"credits",-item.data.price,`purchase:${key}`,`Compra: ${item.data.name}`,a.id);
    const row=await u.put("inventory",key,{itemId:item.id,name:item.data.name,slot:item.data.slot,color:item.data.color,equipped:false},"OWNED",a.id);await u.edge("item",item.id,"inventory",key);return handled(row);
  }
  if(action==="inventory.equip") {
    const row=(await u.get("inventory",id.parse(b.id)))!;requireRule(row.owner_id===a.id,"Item de outro participante",403);
    for(const owned of await u.list("inventory")) if(owned.owner_id===a.id && owned.data.slot===row.data.slot) await u.put("inventory",owned.id,{...owned.data,equipped:owned.id===row.id},"OWNED",a.id);
    return handled();
  }
  if(action==="battle.enroll") {
    const battle=(await u.get("battle",id.parse(b.id)))!;requireRule(battle.status==="RECRUITING","Inscrições encerradas");requireRule(member.division_id && battle.data.divisionIds.includes(member.division_id),"Sua divisão não participa",403);
    const roster=battle.data.roster as {userId:string;divisionId:string}[];
    if(!roster.some(r=>r.userId===a.id))roster.push({userId:a.id,divisionId:member.division_id});return handled(await u.put("battle",battle.id,{...battle.data,roster},battle.status,battle.owner_id));
  }
  if(action==="battle.start") {
    await s.manage(u,a,undefined,true);const battle=(await u.get("battle",id.parse(b.id)))!;requireRule(battle.status==="RECRUITING","Batalha já iniciada");
    const roster=battle.data.roster as {userId:string;divisionId:string}[];
    for(const divisionId of battle.data.divisionIds) requireRule(roster.some(r=>r.divisionId===divisionId),"Cada divisão precisa de pelo menos um inscrito");
    const data={...battle.data,startsAt:s.now().toISOString(),endsAt:new Date(s.now().getTime()+battle.data.durationHours*3600000).toISOString()};
    await u.put("battle",battle.id,data,"ACTIVE",battle.owner_id);await u.enqueue("close",`battle:${battle.id}`,{kind:"battle",id:battle.id},new Date(data.endsAt));return handled(data);
  }
  if(action==="battle.strategy") {
    const battle=(await u.get("battle",id.parse(b.id)))!;requireRule(battle.status==="ACTIVE" && Date.parse(battle.data.endsAt)>s.now().getTime(),"Rodada encerrada");
    requireRule(member.division_id && battle.data.divisionIds.includes(member.division_id),"Divisão fora da batalha",403);await s.manage(u,a,member.division_id);
    const strategy=z.enum(["attack","defend","maneuver"]).parse(b.strategy);battle.data.strategies[member.division_id]=strategy;
    await u.put("battle",battle.id,battle.data,battle.status,battle.owner_id);return handled();
  }
  if(action==="battle.resolve") {await s.manage(u,a,undefined,true);await finishBattle(s,u,id.parse(b.id));return handled(await u.get("battle",String(b.id)));}
  if(action==="chapter.vote" || action==="election.vote") {
    const kind=action.split(".")[0]!,row=(await u.get(kind,id.parse(b.id)))!;
    requireRule(row.status==="ACTIVE" && Date.parse(row.data.endsAt)>s.now().getTime(),"Votação encerrada");
    let choice:unknown;
    if(kind==="chapter") {choice=z.number().int().min(0).max(row.data.choices.length-1).parse(b.choice);}
    else {requireRule(member.division_id===row.data.divisionId,"Eleição de outra divisão",403);choice=id.parse(b.userId);requireRule((await u.list("nomination")).some(n=>n.data.electionId===row.id && n.owner_id===choice),"Candidatura inválida");}
    const key=`${kind}:${row.id}:${s.subject(u.guildId,a.id)}`;requireRule(!await u.get("vote",key,true),"Você já votou");
    return handled(await u.put("vote",key,{kind,parentId:row.id,choice},"DONE",a.id));
  }
  if(action==="election.nominate") {
    const row=(await u.get("election",id.parse(b.id)))!;requireRule(row.status==="ACTIVE" && Date.parse(row.data.endsAt)>s.now().getTime(),"Candidaturas encerradas");requireRule(member.division_id===row.data.divisionId,"Eleição de outra divisão",403);
    return handled(await u.put("nomination",`${row.id}:${a.id}`,{electionId:row.id,statement:z.string().min(10).max(1000).parse(b.statement)},"ACTIVE",a.id));
  }
  if(action==="relationship.propose") {
    const from=id.parse(b.fromDivisionId),to=id.parse(b.toDivisionId);requireRule(from!==to,"Escolha divisões diferentes");await s.manage(u,a,from);
    requireRule((await u.db.query("SELECT id FROM divisions WHERE guild_id=$1 AND id=$2 AND status='active'",[u.guildId,to])).rowCount,"Divisão inválida");
    return handled(await u.put("relationship",randomUUID(),{from,to,type:z.enum(["alliance","rivalry"]).parse(b.type)},"PENDING",a.id));
  }
  if(action==="relationship.accept") {
    const row=(await u.get("relationship",id.parse(b.id)))!;requireRule(row.status==="PENDING","Proposta já respondida");await s.manage(u,a,row.data.to);
    return handled(await u.put("relationship",row.id,{...row.data,acceptedBy:a.id},"ACTIVE",row.owner_id));
  }
  if(action==="territory.assign") {
    await s.manage(u,a,undefined,true);const row=(await u.get("territory",id.parse(b.id)))!,divisionId=id.parse(b.divisionId);
    requireRule((await u.db.query("SELECT 1 FROM divisions WHERE guild_id=$1 AND id=$2",[u.guildId,divisionId])).rowCount,"Divisão inválida");
    await u.audit(a.id,"territory.assigned",row.id,z.string().min(5).max(1000).parse(b.reason));return handled(await u.put("territory",row.id,{...row.data,divisionId},"ACTIVE",row.owner_id));
  }
  if(action==="challenge.enter") {
    const row=(await u.get("challenge",id.parse(b.id)))!;requireRule(row.status==="ACTIVE" && Date.parse(row.data.endsAt)>s.now().getTime(),"Desafio encerrado");
    const key=`${row.id}:${s.subject(u.guildId,a.id)}`;requireRule(!await u.get("challenge-entry",key,true),"Participação já enviada");
    let data:Record<string,unknown>={challengeId:row.id,enteredAt:s.now().toISOString()};
    if(row.data.type==="quiz") {const answer=z.number().int().min(0).max(row.data.options.length-1).parse(b.answer);data={...data,correct:answer===row.data.answer,answer};}
    if(["memes","creative"].includes(row.data.type)) {const url=z.url().parse(b.url);requireRule(new URL(url).protocol==="https:","Use uma URL HTTPS");data={...data,url};}
    return handled(await u.put("challenge-entry",key,data,"PENDING",a.id));
  }
  if(action==="challenge.review") {
    await s.manage(u,a,undefined,true);const entry=(await u.get("challenge-entry",id.parse(b.id)))!,challenge=(await u.get("challenge",entry.data.challengeId))!;
    requireRule(["memes","creative"].includes(challenge.data.type) && entry.status==="PENDING" && challenge.status==="ACTIVE","Envio não disponível para revisão");requireRule(entry.owner_id!==a.id,"Outra pessoa deve revisar seu envio",403);
    return handled(await u.put("challenge-entry",entry.id,{...entry.data,reason:z.string().min(5).max(1000).parse(b.reason)},z.boolean().parse(b.approve)?"APPROVED":"REJECTED",entry.owner_id));
  }
  if(action==="challenge.vote") {
    const entry=(await u.get("challenge-entry",id.parse(b.id)))!,challenge=(await u.get("challenge",entry.data.challengeId))!;
    requireRule(entry.status==="APPROVED" && challenge.data.type==="memes" && challenge.status==="ACTIVE" && Date.parse(challenge.data.endsAt)>s.now().getTime(),"Votação indisponível");
    const key=`challenge:${challenge.id}:${s.subject(u.guildId,a.id)}`;requireRule(!await u.get("vote",key,true),"Você já votou");
    return handled(await u.put("vote",key,{kind:"challenge",parentId:challenge.id,choice:entry.id},"DONE",a.id));
  }
  if(action==="pet.contribute") {
    const day=s.now().toISOString().slice(0,10),key=`${a.id}:${day}`;requireRule(!await u.get("pet-contribution",key,true),"Você já contribuiu hoje");
    await s.credit(u,a.id,"credits",-1,`pet:${key}`,"Cuidado com o mascote",a.id);await u.put("pet-contribution",key,{},"DONE",a.id);
    const pet=await u.get("pet","collective",true);return handled(await u.put("pet","collective",{name:"Guardião da base",care:(pet?.data.care??0)+1},"ACTIVE"));
  }
  return {handled:false};
}

export async function finishSeason(s:GameService,u:UnitOfWork,id:string,actorId="system"):Promise<void> {
  const season=(await u.get("season",id))!;if(["FINISHED","ARCHIVED"].includes(season.status))return;
  requireRule(["ACTIVE","CALCULATING"].includes(season.status),"Temporada não está ativa");
  const scores=rankScores((await u.list("season-score")).filter(r=>r.data.seasonId===id));
  const divisions:Record<string,number>={};for(const row of scores)divisions[row.data.divisionId]=(divisions[row.data.divisionId]??0)+row.data.score;
  const ranking=scores.map((row,i)=>({place:i+1,...row.data}));
  for(const prize of season.data.prizes) {
    const winner=scores[prize.place-1];if(winner && (await s.member(u,winner.data.userId,false))?.participation==="active") await s.reward(u,winner.data.userId,{...prize.reward,division:0},`season:${id}:prize:${prize.place}`,`Premiação ${season.data.name}`,actorId);
  }
  await u.put("season",id,{...season.data,ranking,divisionRanking:Object.entries(divisions).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([divisionId,score],i)=>({place:i+1,divisionId,score})),finishedAt:s.now().toISOString(),summary:`${season.data.name}: ${scores.length} participantes pontuaram. Revise o resumo antes de publicar.`},"FINISHED",season.owner_id);
  await u.audit(actorId,"season.finished",id);
}

export async function finishBattle(s:GameService,u:UnitOfWork,id:string):Promise<void> {
  const battle=(await u.get("battle",id))!;if(battle.status==="FINISHED")return;
  requireRule(battle.status==="ACTIVE" && Date.parse(battle.data.endsAt)<=s.now().getTime(),"A rodada ainda não terminou");
  const roster=battle.data.roster as {userId:string;divisionId:string}[];
  const rows=(await u.db.query("SELECT user_id,SUM(amount)::int AS total FROM point_ledger WHERE guild_id=$1 AND point_type='xp' AND amount>0 AND created_at >= $2 AND created_at < $3 GROUP BY user_id",[u.guildId,battle.data.startsAt,battle.data.endsAt])).rows;
  const contribution=(divisionId:string)=>roster.filter(r=>r.divisionId===divisionId).map(r=>rows.find(v=>v.user_id===s.subject(u.guildId,r.userId))?.total??0);
  const [left,right]=battle.data.divisionIds as [string,string];
  const result=battleScore(contribution(left),contribution(right),battle.data.strategies[left]??"defend",battle.data.strategies[right]??"defend",battle.data.cap);
  const winner=result.winner==="tie"?null:result.winner==="left"?left:right;
  for(const row of roster.filter(r=>winner===r.divisionId))if((await s.member(u,row.userId,false))?.participation==="active")await s.reward(u,row.userId,battle.data.reward,`battle:${id}`,battle.data.name);
  await u.put("battle",id,{...battle.data,result:{...result,winnerDivisionId:winner,leftContributions:contribution(left),rightContributions:contribution(right)}},"FINISHED",battle.owner_id);
}

export async function closeModule(s:GameService,u:UnitOfWork,kind:string,id:string):Promise<void> {
  if(kind==="season")return finishSeason(s,u,id);
  if(kind==="battle")return finishBattle(s,u,id);
  const row=(await u.get(kind,id))!;if(!["ACTIVE","SCHEDULED"].includes(row.status))return;
  requireRule(!row.data.endsAt || Date.parse(row.data.endsAt)<=s.now().getTime(),"Prazo não encerrado");
  if(["chapter","election","challenge"].includes(kind)) {
    const votes=(await u.list("vote")).filter(v=>v.data.parentId===id);const counts:Record<string,number>={};for(const vote of votes) counts[String(vote.data.choice)]=(counts[String(vote.data.choice)]??0)+1;
    row.data.results=counts;
    if(kind==="challenge") {
      const entries=(await u.list("challenge-entry")).filter(e=>e.data.challengeId===id);
      let winners=entries.filter(e=>row.data.type==="quiz"?e.data.correct:e.status==="APPROVED");
      if(row.data.type==="memes") {const maximum=Math.max(0,...Object.values(counts));winners=winners.filter(e=>maximum>0 && counts[e.id]===maximum);}
      if(row.data.type==="boss") {
        const activities=await u.list("activity");const contribution=entries.reduce((sum,e)=>sum+Math.min(row.data.targetPerMember,activities.filter(v=>v.owner_id===e.owner_id && Date.parse(v.data.at)>=Date.parse(e.data.enteredAt) && Date.parse(v.data.at)<Date.parse(row.data.endsAt)).reduce((n,v)=>n+v.data.xp,0)),0);
        row.data.boss={target:entries.length*row.data.targetPerMember,contribution};winners=entries.length && contribution>=row.data.boss.target?entries:[];
      }
      for(const winner of winners)if((await s.member(u,winner.owner_id!,false))?.participation==="active")await s.reward(u,winner.owner_id!,row.data.reward,`challenge:${id}`,row.data.name);
      row.data.winners=winners.map(w=>w.owner_id);
    }
  }
  await u.put(kind,id,row.data,kind==="mission"?"EXPIRED":"FINISHED",row.owner_id);
}
