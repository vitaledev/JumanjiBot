import { z } from "zod";
export type Actor = { id: string; name: string; avatar?: string; admin: boolean; owner?: boolean; bot?: boolean };
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function requireRule(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new AppError(status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "INVALID_ACTION", message, status);
}
export const points = z.enum(["xp", "honor", "influence", "division", "credits"]);
export type PointType = z.infer<typeof points>;
const text = z.string().trim().min(1).max(200);
const id = z.string().min(1).max(160);
const date = z.iso.datetime({ offset: true });
export const rewardSchema = z.object({ xp: z.number().int().min(0).max(10000).default(0), honor: z.number().int().min(0).max(1000).default(0), influence: z.number().int().min(0).max(1000).default(0), credits: z.number().int().min(0).max(1000).default(0), division: z.number().int().min(0).max(1000).default(0) });
export const settingsSchema = z.object({
  name: text.default("Jumanji"), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8B1E2D"),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat("pt-BR", { timeZone: value }); return true; } catch { return false; } }).default("America/Sao_Paulo"),
  entryMode: z.enum(["free", "invite", "balanced", "quiz", "recruitment"]).default("free"),
  messageXp: z.number().int().min(0).max(100).default(3), messageCap: z.number().int().min(0).max(1000).default(60),
  cooldownSeconds: z.number().int().min(60).max(86400).default(180),
  excludedChannels: z.array(id).max(100).default([]), protectedRoles: z.array(id).max(100).default([]),
  adminRoles: z.array(id).max(20).default([]), generalLeaderId: id.nullable().default(null),
  advanced: z.boolean().default(false), moderation: z.boolean().default(false),
  pausePoints: z.boolean().default(false), pauseMissions: z.boolean().default(false), pauseModeration: z.boolean().default(false),
  captainTimeoutMinutes: z.number().int().min(0).max(60).default(10), viceTimeoutMinutes: z.number().int().min(0).max(10).default(5),
  moderatorDailyLimit: z.number().int().min(1).max(100).default(10),
  retentionDays: z.number().int().min(30).max(3650).default(180), reactivationDays: z.number().int().min(7).max(365).default(30),
  streakGraceDays: z.number().int().min(1).max(30).default(7),
  announcementChannelId: id.nullable().default(null)
});
export type Settings = z.infer<typeof settingsSchema>;
export const definitions = {
  mission: z.object({ name: text, description: z.string().max(2000), action: z.enum(["onboarding","text","voice","reaction","event","external","welcome"]), target: z.number().int().min(1).max(100000).default(1), period: z.enum(["once","daily","weekly","season"]).default("once"), reward: rewardSchema, messageId: id.optional(), externalUrl: z.url().optional(), divisionId: id.optional(), endsAt: date.optional() }),
  event: z.object({ name: text, description: z.string().max(2000).default(""), startsAt: date, endsAt: date, divisionId: id.optional(), reward: rewardSchema, channelId: id.optional() }).refine(v => Date.parse(v.endsAt) > Date.parse(v.startsAt), "O evento precisa terminar depois do início"),
  campaign: z.object({ name: text, description: z.string().max(2000), template: z.enum(["recruitment","emblems","recruits","operation","chronicle"]), endsAt: date, qualificationDays: z.number().int().min(7).max(90).default(7), activeDays: z.number().int().min(2).max(30).default(2), weeklyCap: z.number().int().min(1).max(100).default(5), reward: rewardSchema }),
  season: z.object({ name: text, theme: z.string().min(1).max(2000), startsAt: date.optional(), endsAt: date.optional(), prizes: z.array(z.object({ place: z.number().int().min(1).max(100), reward: rewardSchema })).max(100).default([]) }),
  item: z.object({ name: text, description: z.string().max(1000), slot: z.enum(["title","frame","emblem","banner","pet"]), price: z.number().int().min(0).max(100000), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#D4A72C") }),
  achievement: z.object({ name: text, description: z.string().max(1000), metric: z.enum(["xp","missions","events","invites"]), target: z.number().int().min(1).max(100000), secret: z.boolean().default(false), reward: rewardSchema }),
  chapter: z.object({ name: text, body: z.string().max(8000), seasonId: id, choices: z.array(text).min(2).max(5), endsAt: date }),
  battle: z.object({ name: text, divisionIds: z.array(id).min(2).max(2), cap: z.number().int().min(1).max(1000).default(100), reward: rewardSchema, durationHours: z.number().int().min(1).max(168).default(24) }),
  challenge: z.object({ name: text, type: z.enum(["boss","quiz","memes","creative"]), description: z.string().max(2000), endsAt: date, targetPerMember: z.number().int().min(1).max(1000).default(50), question: z.string().max(1000).default(""), options: z.array(text).max(5).default([]), answer: z.number().int().min(0).max(4).default(0), reward: rewardSchema }),
  experiment: z.object({ name: text, hypothesis: z.string().min(10).max(2000), variable: z.enum(["event_time","announcement_text","mission_duration"]), control: text, variant: text, startsAt: date, endsAt: date, metric: z.enum(["mission_completion","event_attendance","activation"]) }),
  webhook: z.object({ name: text, url: z.url().refine(v => new URL(v).protocol === "https:", "Use HTTPS"), secret: z.string().min(32).max(200) }),
  journal: z.object({ name: text, body: z.string().max(8000) }),
  territory: z.object({ name: text, description: z.string().max(1000), divisionId: id.optional() }),
  election: z.object({ name: text, divisionId: id, position: z.enum(["captain","vice-captain"]), endsAt: date })
} as const;
export type ModuleKind = keyof typeof definitions;
export type ModuleData<K extends ModuleKind> = z.infer<(typeof definitions)[K]>;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
// Stored documents are validated at their write boundaries by the schemas above.
export interface RecordRow<T = Record<string, any>> { guild_id: string; kind: string; id: string; owner_id: string | null; status: string; data: T; created_at: Date; updated_at: Date }
export interface Member { guild_id: string; user_id: string; display_name: string; avatar_url: string; rpg_role: string; participation: "pending" | "active" | "left"; xp: number; honor: number; influence: number; credits: number; division_id: string | null; joined_at: Date; consented_at: Date | null; preferences: { notifications: boolean; reactivation: boolean } }
export function localDay(date: Date, timezone: string): string { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
export function periodKey(period: string, now: Date, timezone: string, seasonId?: string): string {
  const day = localDay(now, timezone);
  if (period === "daily") return day;
  if (period === "weekly") { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0,10); }
  return period === "season" ? seasonId ?? "no-season" : "once";
}
