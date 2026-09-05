import { MemberService } from "./member-service.js";
import { MissionService } from "./mission-service.js";

export interface ActivityResult {
  readonly accepted: boolean;
  readonly reason: "awarded" | "not-enrolled" | "too-short" | "cooldown" | "daily-cap" | "duplicate";
  readonly xp: number;
}

const MESSAGE_XP = 3;
const COOLDOWN_MS = 3 * 60 * 1000;
const DAILY_CAP = 60;

export class ActivityService {
  private readonly lastAwardAt = new Map<string, number>();
  private readonly dailyXp = new Map<string, { day: string; xp: number }>();
  private readonly events = new Set<string>();

  constructor(private readonly memberService: MemberService, private readonly missionService: MissionService) {}

  recordMessage(guildId: string, userId: string, messageId: string, content: string, now = new Date()): ActivityResult {
    const member = this.memberService.get(guildId, userId);
    if (!member) return { accepted: false, reason: "not-enrolled", xp: 0 };
    if (this.events.has(messageId)) return { accepted: false, reason: "duplicate", xp: 0 };
    this.events.add(messageId);
    if (content.trim().length < 5) return { accepted: false, reason: "too-short", xp: 0 };

    const key = `${guildId}:${userId}`;
    const lastAward = this.lastAwardAt.get(key) ?? 0;
    if (now.getTime() - lastAward < COOLDOWN_MS) return { accepted: false, reason: "cooldown", xp: 0 };

    const day = now.toISOString().slice(0, 10);
    const current = this.dailyXp.get(key);
    const earnedToday = current?.day === day ? current.xp : 0;
    if (earnedToday + MESSAGE_XP > DAILY_CAP) return { accepted: false, reason: "daily-cap", xp: 0 };

    this.lastAwardAt.set(key, now.getTime());
    this.dailyXp.set(key, { day, xp: earnedToday + MESSAGE_XP });
    this.memberService.addXp(guildId, userId, MESSAGE_XP, `message:${messageId}`);
    this.missionService.recordTextAction(guildId, userId, now);
    return { accepted: true, reason: "awarded", xp: MESSAGE_XP };
  }
}