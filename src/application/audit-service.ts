export interface AuditEntry {
  readonly id: string;
  readonly guildId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetId?: string;
  readonly reason?: string;
  readonly createdAt: Date;
}

export class AuditService {
  private readonly entries: AuditEntry[] = [];

  record(entry: Omit<AuditEntry, "id" | "createdAt">): AuditEntry {
    const created: AuditEntry = { ...entry, id: `audit:${Date.now()}:${this.entries.length}`, createdAt: new Date() };
    this.entries.push(created);
    return created;
  }

  listGuild(guildId: string, limit = 20): readonly AuditEntry[] {
    return this.entries.filter((entry) => entry.guildId === guildId).slice(-limit).reverse();
  }
}