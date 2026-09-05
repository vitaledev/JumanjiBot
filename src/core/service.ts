import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, UnitOfWork } from "./store.js";
import { AppError, definitions, localDay, periodKey, requireRule, rewardSchema, settingsSchema, type Actor, type Member, type ModuleKind, type PointType, type RecordRow, type Settings } from "./contracts.js";
import { coreAction } from "./actions.js";
import { advancedAction } from "./advanced.js";
import { communityAction } from "./community.js";

export const adminKinds = new Set(["audit","job","webhook","experiment","submission","moderation","setup","invite","notification"]);
export const advancedKinds = new Set(["battle","challenge","item","achievement","chapter","territory","election","journal"]);
export class GameService {
  constructor(public readonly store: Store, private readonly privacySecret: string, public readonly now: () => Date = () => new Date()) {}
  subject(guildId: string, userId: string): string { return createHmac("sha256",this.privacySecret).update(`${guildId}:${userId}`).digest("hex"); }
  async settings(u: UnitOfWork): Promise<Settings> {
    return settingsSchema.parse((await u.db.query("SELECT settings FROM guilds WHERE id=$1",[u.guildId])).rows[0]?.settings ?? {});
  }
  async member(u: UnitOfWork, userId: string, required = true): Promise<Member | undefined> {
    const m = (await u.db.query<Member>("SELECT * FROM guild_members WHERE guild_id=$1 AND user_id=$2",[u.guildId,userId])).rows[0];
    if (required) requireRule(m?.participation === "active","Entre no RPG e aceite a participação antes desta ação",403);
    return m;
  }
  async manage(u: UnitOfWork, actor: Actor, divisionId?: string, adminOnly = false): Promise<void> {
    if (actor.admin || actor.owner) return;
    const settings = await this.settings(u);
    if (!adminOnly && settings.generalLeaderId === actor.id) return;
    const m = await this.member(u,actor.id,false);
    if (!adminOnly && divisionId && m?.participation === "active" && m.division_id === divisionId) {
      const d = (await u.db.query("SELECT * FROM divisions WHERE guild_id=$1 AND id=$2",[u.guildId,divisionId])).rows[0];
      if (d && (d.captain_id === actor.id || d.vice_captain_id === actor.id)) return;
    }
    throw new AppError("FORBIDDEN","Você não tem permissão para esta ação",403);
  }
  async enroll(guildId: string, user: Actor): Promise<void> {
    if (user.bot) return;
    await this.store.run(guildId,async u => {
      const marker = await u.db.query("SELECT opted_out FROM privacy_markers WHERE guild_id=$1 AND subject_hash=$2",[guildId,this.subject(guildId,user.id)]);
      if (marker.rows[0]?.opted_out) return;
      await u.db.query(`INSERT INTO guild_members(guild_id,user_id,display_name,avatar_url) VALUES($1,$2,$3,$4)
        ON CONFLICT(guild_id,user_id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_url=EXCLUDED.avatar_url`,[guildId,user.id,user.name,user.avatar ?? ""]);
    });
  }
  async reward(u: UnitOfWork, userId: string, reward: unknown, eventKey: string, reason: string, actorId = "system", seasonId?: string): Promise<void> {
    const settings = await this.settings(u);
    requireRule(!settings.pausePoints,"Pontuação suspensa temporariamente");
    const values = rewardSchema.parse(reward);
    for (const [type,amount] of Object.entries(values)) if (amount) await this.credit(u,userId,type as PointType,amount,eventKey,reason,actorId,seasonId);
  }
  async credit(u: UnitOfWork, userId: string, type: PointType, amount: number, eventKey: string, reason: string, actorId: string, seasonId?: string, reversalOf?: string): Promise<void> {
    requireRule(Number.isSafeInteger(amount) && Math.abs(amount) <= 1000000,"Valor inválido");
    const member = (await this.member(u,userId))!;
    const subject = this.subject(u.guildId,userId);
    if (type === "division" && !seasonId) seasonId = (await u.list("season")).find(s => s.status === "ACTIVE")?.id;
    if (type === "division" && (!seasonId || !member.division_id)) return;
    const result = await u.db.query(`INSERT INTO point_ledger(guild_id,user_id,amount,point_type,reason,event_key,actor_id,season_id,reversal_of)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,[u.guildId,subject,amount,type,reason,eventKey,actorId,seasonId ?? null,reversalOf ?? null]);
    if (!result.rowCount) return;
    if (type !== "division") {
      const field = { xp:"xp",honor:"honor",influence:"influence",credits:"credits" }[type];
      const updated = await u.db.query(`UPDATE guild_members SET ${field}=${field}+$3 WHERE guild_id=$1 AND user_id=$2 AND ${field}+$3>=0 RETURNING user_id`,[u.guildId,userId,amount]);
      requireRule(updated.rowCount,"Saldo insuficiente");
    } else {
      const key = `${seasonId}:${subject}`;
      const previous = await u.get("season-score",key,true);
      await u.put("season-score",key,{ userId, divisionId: member.division_id, seasonId, score: Math.max(0,(previous?.data.score ?? 0)+amount), reachedAt:this.now().toISOString() },"ACTIVE",userId);
    }
  }
  async assign(u: UnitOfWork, userId: string): Promise<RecordRow[]> {
    await this.member(u,userId);
    const settings = await this.settings(u);
    const season = (await u.list("season")).find(s => s.status === "ACTIVE");
    const member = (await this.member(u,userId))!;
    for (const mission of await u.list("mission")) {
      if (mission.status !== "ACTIVE" || mission.data.endsAt && Date.parse(mission.data.endsAt) <= this.now().getTime()) continue;
      if (mission.data.divisionId && mission.data.divisionId !== member.division_id) continue;
      if (mission.data.period === "season" && !season) continue;
      const period = periodKey(mission.data.period,this.now(),settings.timezone,season?.id);
      const id = `${mission.id}:${this.subject(u.guildId,userId)}:${period}`;
      if (!await u.get("assignment",id,true)) {
        await u.put("assignment",id,{ missionId:mission.id, period, progress:0, target:mission.data.target, reward:mission.data.reward, name:mission.data.name },"ACTIVE",userId);
        await u.edge("mission",mission.id,"assignment",id);
      }
    }
    return (await u.list("assignment")).filter(a => a.owner_id === userId);
  }
  async progress(u: UnitOfWork, userId: string, action: string, eventKey: string, amount = 1, messageId?: string): Promise<void> {
    const settings = await this.settings(u);
    if (settings.pauseMissions) return;
    const assignments = await this.assign(u,userId);
    const season = (await u.list("season")).find(s => s.status === "ACTIVE");
    for (const assignment of assignments) {
      if (assignment.status !== "ACTIVE") continue;
      const mission = (await u.get("mission",assignment.data.missionId))!;
      if (mission.status !== "ACTIVE" || mission.data.action !== action) continue;
      if (mission.data.endsAt && Date.parse(mission.data.endsAt) <= this.now().getTime()) continue;
      if (mission.data.action === "reaction" && mission.data.messageId !== messageId) continue;
      if (assignment.data.period !== periodKey(mission.data.period,this.now(),settings.timezone,season?.id)) continue;
      const seenKey = `${assignment.id}:${eventKey}`;
      if (await u.get("mission-event",seenKey,true)) continue;
      await u.put("mission-event",seenKey,{},"DONE",userId);
      assignment.data.progress = Math.min(assignment.data.target,assignment.data.progress+amount);
      const done = assignment.data.progress >= assignment.data.target;
      if (done) {
        await this.reward(u,userId,assignment.data.reward,`mission:${assignment.id}`,mission.data.name);
        assignment.data.completedAt = this.now().toISOString();
      }
      await u.put("assignment",assignment.id,assignment.data,done ? "COMPLETED" : "ACTIVE",userId);
    }
  }
  async activity(guildId: string, userId: string, action: "text"|"voice"|"reaction", eventKey: string, input: { hash?: string; length?: number; channelId?: string; messageId?: string; seconds?: number } = {}): Promise<boolean> {
    return this.store.run(guildId,async u => {
      const member = await this.member(u,userId,false);
      const settings = await this.settings(u);
      if (member?.participation !== "active" || settings.pausePoints || input.channelId && settings.excludedChannels.includes(input.channelId)) return false;
      if (await u.get("activity",eventKey,true)) return false;
      const day = localDay(this.now(),settings.timezone);
      const activities = (await u.list("activity")).filter(a => a.owner_id === userId);
      if (action === "text") {
        if ((input.length ?? 0)<5) return false;
        const today = activities.filter(a => a.data.day === day && a.data.action === action);
        if (today.some(a => a.data.hash === input.hash) || today.reduce((n,a) => n+a.data.xp,0)+settings.messageXp > settings.messageCap) return false;
        if (activities.some(a => a.data.action === action && this.now().getTime()-Date.parse(a.data.at)<settings.cooldownSeconds*1000)) return false;
        await this.reward(u,userId,{xp:settings.messageXp},`text:${eventKey}`,"Participação textual");
      }
      if (action === "voice") {
        const seconds = Math.min(60,input.seconds ?? 0);
        if (seconds <= 0) return false;
        const total = activities.filter(a => a.data.day === day && a.data.action === "voice").reduce((n,a)=>n+a.data.seconds,0);
        const previous = Math.min(2,Math.floor(total/1800));
        const next = Math.min(2,Math.floor((total+seconds)/1800));
        if (next > previous) await this.reward(u,userId,{xp:20},`voice:${day}:${next}`,"30 minutos de voz elegível");
      }
      await u.put("activity",eventKey,{...input,action,day,at:this.now().toISOString(),xp:action === "text" ? settings.messageXp : 0},"DONE",userId);
      await this.progress(u,userId,action,eventKey,action === "voice" ? Math.min(60,input.seconds ?? 0) : 1,input.messageId);
      await this.achievements(u,userId);
      return true;
    });
  }
  async achievements(u: UnitOfWork, userId: string): Promise<void> {
    if (!(await this.settings(u)).advanced) return;
    const member = (await this.member(u,userId))!;
    for (const achievement of (await u.list("achievement")).filter(a => a.status === "ACTIVE")) {
      const key = `${achievement.id}:${this.subject(u.guildId,userId)}`;
      if (await u.get("unlock",key,true)) continue;
      const metric = achievement.data.metric;
      const value = metric === "xp" ? member.xp : (await u.list(metric === "missions" ? "assignment" : metric === "events" ? "attendance" : "referral")).filter(r => r.owner_id === userId && ["COMPLETED","APPROVED","QUALIFIED"].includes(r.status)).length;
      if (value >= achievement.data.target) {
        await u.put("unlock",key,{achievementId:achievement.id,name:achievement.data.name},"COMPLETED",userId);
        await this.reward(u,userId,achievement.data.reward,`achievement:${key}`,achievement.data.name);
      }
    }
  }
  async act(guildId: string, actor: Actor, action: string, input: unknown): Promise<unknown> {
    requireRule(!actor.bot,"Bots não participam do RPG",403);
    return this.store.run(guildId, async u => {
      const b = z.record(z.string(),z.unknown()).parse(input ?? {});
      const result = await coreAction(this,u,actor,action,b);
      if (result.handled) return result.value;
      const community = await communityAction(this,u,actor,action,b);
      if (community.handled) return community.value;
      const advanced = await advancedAction(this,u,actor,action,b);
      if (advanced.handled) return advanced.value;
      throw new AppError("NOT_FOUND","Ação não encontrada",404);
    });
  }
  async define(u: UnitOfWork, actor: Actor, kind: ModuleKind, input: unknown, id?: string): Promise<RecordRow> {
    await this.manage(u,actor,undefined,true);
    if (advancedKinds.has(kind)) requireRule((await this.settings(u)).advanced,"Ative os recursos avançados nas configurações");
    const data = definitions[kind].parse(input) as Record<string, any>;
    if (data.divisionId) requireRule((await u.db.query("SELECT id FROM divisions WHERE guild_id=$1 AND id=$2 AND status='active'",[u.guildId,data.divisionId])).rowCount,"Divisão inválida");
    if (data.seasonId) await u.get("season",data.seasonId);
    if (kind === "mission" && data.action === "reaction") requireRule(data.messageId,"Informe a mensagem da missão de reação");
    if (kind === "challenge" && data.type === "quiz") requireRule(data.question && data.options.length>=2 && data.answer<data.options.length,"Quiz inválido");
    if (kind === "battle") {
      requireRule(data.divisionIds[0] !== data.divisionIds[1],"Escolha duas divisões diferentes");
      for (const divisionId of data.divisionIds) requireRule((await u.db.query("SELECT id FROM divisions WHERE guild_id=$1 AND id=$2 AND status='active'",[u.guildId,divisionId])).rowCount,"Divisão inválida");
    }
    if (kind === "season") requireRule(!(await u.list("season")).some(s => s.id!==id && !["FINISHED","ARCHIVED"].includes(s.status)),"Já existe uma temporada aberta");
    if (id) requireRule((await u.get(kind,id))!.status === "DRAFT","Somente rascunhos podem ser editados");
    const row = await u.put(kind,id ?? randomUUID(),data,"DRAFT",actor.id);
    if (data.seasonId) await u.edge("season",data.seasonId,kind,row.id);
    await u.audit(actor.id,`${kind}.saved`,row.id);
    return row;
  }
  async view(guildId: string, actor: Actor, kind = "dashboard", page = 1, query = ""): Promise<unknown> {
    return this.store.run(guildId,async u => {
      const settings = await this.settings(u);
      const member = await this.member(u,actor.id,false);
      const leader = actor.admin || actor.owner || settings.generalLeaderId === actor.id;
      if (kind === "dashboard") return { guildId, settings: {name:settings.name,color:settings.color,advanced:settings.advanced}, member, capabilities:{admin:actor.admin,leader}, season:(await u.list("season")).find(s=>s.status==="ACTIVE") ?? null, campaign:(await u.list("campaign")).find(c=>c.status==="ACTIVE") ?? null, stats:{members:Number((await u.db.query("SELECT COUNT(*) FROM guild_members WHERE guild_id=$1 AND participation='active'",[guildId])).rows[0].count),divisions:Number((await u.db.query("SELECT COUNT(*) FROM divisions WHERE guild_id=$1 AND status='active'",[guildId])).rows[0].count)}, jobs: actor.admin ? (await u.db.query("SELECT id,kind,status,attempts,last_error,result FROM jobs WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 5",[guildId])).rows : [] };
      if (kind === "settings") { await this.manage(u,actor,undefined,true); return settings; }
      if (adminKinds.has(kind)) await this.manage(u,actor,undefined,true);
      let rows: any[];
      if (kind === "division") rows = (await u.db.query("SELECT d.*, (SELECT COUNT(*)::int FROM guild_members m WHERE m.guild_id=d.guild_id AND m.division_id=d.id AND m.participation='active') AS member_count FROM divisions d WHERE d.guild_id=$1 ORDER BY number",[guildId])).rows;
      else if (kind === "member" || kind === "ranking") rows = (await u.db.query("SELECT user_id,display_name,avatar_url,rpg_role,xp,honor,influence,division_id FROM guild_members WHERE guild_id=$1 AND participation='active' ORDER BY xp DESC,user_id",[guildId])).rows;
      else if (kind === "audit") rows = (await u.db.query("SELECT * FROM audit_logs WHERE guild_id=$1 ORDER BY created_at DESC,id DESC LIMIT 2000",[guildId])).rows;
      else if (kind === "job") rows = (await u.db.query("SELECT id,kind,status,attempts,last_error,result,created_at FROM jobs WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 1000",[guildId])).rows;
      else if (kind === "assignment") rows = member?.participation === "active" ? await this.assign(u,actor.id) : [];
      else if (kind === "metrics") { await this.manage(u,actor,undefined,true); return this.metrics(u); }
      else {
        const readable = new Set([...Object.keys(definitions),"inventory","unlock","attendance","submission","moderation","invitation","relationship","nomination","notification","setup","referral"]);
        requireRule(readable.has(kind),"Recurso indisponível",404);
        rows = await u.list(kind);
        const personal = new Set(["inventory","unlock","attendance","invitation","notification","referral"]);
        if (personal.has(kind)) rows = rows.filter(r=>r.owner_id===actor.id);
        if (!leader) rows = rows.filter(r=>r.status!=="DRAFT" && (kind!=="achievement" || !r.data.secret));
        rows = rows.map(r=>{ const data={...r.data}; delete data.secret; if (kind==="challenge" && r.status!=="FINISHED") delete data.answer; return {...r,data}; });
      }
      if (query) rows=rows.filter(r=>JSON.stringify(r).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      return {items:rows.slice((page-1)*25,page*25),total:rows.length,page,pageSize:25};
    });
  }
  async metrics(u: UnitOfWork): Promise<unknown> {
    const members = (await u.db.query<Member>("SELECT * FROM guild_members WHERE guild_id=$1",[u.guildId])).rows;
    const activities = await u.list("activity");
    const assignments = await u.list("assignment");
    const referrals = await u.list("referral");
    const createdAt = (await u.db.query("SELECT created_at FROM guilds WHERE id=$1",[u.guildId])).rows[0].created_at;
    const retention = (days:number) => { const cohort=members.filter(m=>m.consented_at && this.now().getTime()-m.consented_at.getTime()>=(days+1)*86400000); return cohort.length ? {eligible:cohort.length,returned:cohort.filter(m=>activities.some(a=>a.owner_id===m.user_id && Date.parse(a.data.at)>=m.consented_at!.getTime()+days*86400000 && Date.parse(a.data.at)<m.consented_at!.getTime()+(days+1)*86400000)).length}:null; };
    return { since:createdAt,beforeInstrumentation:null,members:members.length,active:members.filter(m=>m.participation==="active").length,missions:{assigned:assignments.length,completed:assignments.filter(a=>a.status==="COMPLETED").length},events:{registered:(await u.list("attendance")).length,attended:(await u.list("attendance")).filter(a=>a.status==="APPROVED").length},campaigns:{attributed:referrals.length,qualified:referrals.filter(r=>r.status==="QUALIFIED").length},retention7:retention(7),retention30:retention(30)};
  }
}
