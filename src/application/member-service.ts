import type { GuildMemberProfile, RpgRole } from "../domain/rpg.js";

export interface MemberProgress extends GuildMemberProfile {
  readonly displayName: string;
  readonly avatarUrl: string;
  readonly xp: number;
  readonly honor: number;
  readonly joinedAt: Date;
}

export class MemberService {
  private readonly members = new Map<string, MemberProgress>();

  get(guildId: string, userId: string): MemberProgress | undefined {
    return this.members.get(this.key(guildId, userId));
  }

  listGuild(guildId: string): readonly MemberProgress[] {
    return [...this.members.values()].filter((member) => member.guildId === guildId);
  }

  consent(guildId: string, userId: string, displayName: string, avatarUrl = ""): MemberProgress {
    const existing = this.get(guildId, userId);
    if (existing) return existing;
    const member: MemberProgress = {
      guildId,
      userId,
      displayName: displayName.trim() || "Membro",
      avatarUrl,
      role: "recruit",
      consented: true,
      xp: 0,
      honor: 0,
      joinedAt: new Date(),
    };
    this.members.set(this.key(guildId, userId), member);
    return member;
  }

  enrollAutomatically(guildId: string, userId: string, displayName: string, avatarUrl = ""): MemberProgress {
    return this.consent(guildId, userId, displayName, avatarUrl);
  }

  addXp(guildId: string, userId: string, amount: number, eventKey: string): MemberProgress {
    const member = this.require(guildId, userId);
    if (!Number.isInteger(amount) || amount < 0) throw new Error("a quantidade de XP é inválida");
    const rewardKey = `${this.key(guildId, userId)}:${eventKey}`;
    if (this.rewarded.has(rewardKey)) return member;
    this.rewarded.add(rewardKey);
    const updated = { ...member, xp: member.xp + amount };
    this.members.set(this.key(guildId, userId), updated);
    return updated;
  }

  setDivision(guildId: string, userId: string, divisionId: string): MemberProgress {
    const member = this.require(guildId, userId);
    const updated = { ...member, divisionId };
    this.members.set(this.key(guildId, userId), updated);
    return updated;
  }

  leave(guildId: string, userId: string): void {
    this.members.delete(this.key(guildId, userId));
  }

  private readonly rewarded = new Set<string>();

  private require(guildId: string, userId: string): MemberProgress {
    const member = this.get(guildId, userId);
    if (!member) throw new Error("membro ainda não entrou no RPG");
    return member;
  }

  private key(guildId: string, userId: string): string {
    return `${guildId}:${userId}`;
  }
}

export function levelFromXp(xp: number): number {
  return Math.floor(xp / 100) + 1;
}

export function roleLabel(role: RpgRole): string {
  return {
    owner: "Dono",
    administrator: "Administrador",
    "general-leader": "Líder geral",
    captain: "Capitão",
    "vice-captain": "Vice-capitão",
    officer: "Oficial",
    member: "Membro",
    recruit: "Recruta",
  }[role];
}