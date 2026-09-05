import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Database } from "../infrastructure/database.js";
import { AppError, type RecordRow } from "./contracts.js";
export class UnitOfWork {
  constructor(public readonly db: PoolClient, public readonly guildId: string) {}
  async get<T = Record<string, any>>(kind: string, id: string, optional = false): Promise<RecordRow<T> | undefined> {
    const row = (await this.db.query<RecordRow<T>>("SELECT * FROM rpg_records WHERE guild_id=$1 AND kind=$2 AND id=$3", [this.guildId, kind, id])).rows[0];
    if (!row && !optional) throw new AppError("NOT_FOUND", "Registro não encontrado neste servidor", 404);
    return row;
  }
  async list<T = Record<string, any>>(kind: string): Promise<RecordRow<T>[]> {
    return (await this.db.query<RecordRow<T>>("SELECT * FROM rpg_records WHERE guild_id=$1 AND kind=$2 ORDER BY created_at DESC,id", [this.guildId,kind])).rows;
  }
  async put(kind: string, id: string, data: unknown, status = "ACTIVE", ownerId: string | null = null): Promise<RecordRow> {
    return (await this.db.query<RecordRow>(`INSERT INTO rpg_records(guild_id,kind,id,data,status,owner_id) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(guild_id,kind,id) DO UPDATE SET data=EXCLUDED.data,status=EXCLUDED.status,owner_id=EXCLUDED.owner_id,updated_at=NOW() RETURNING *`, [this.guildId,kind,id,JSON.stringify(data),status,ownerId])).rows[0]!;
  }
  async edge(parentKind: string, parentId: string, childKind: string, childId: string): Promise<void> {
    await this.db.query("INSERT INTO rpg_edges VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[this.guildId,parentKind,parentId,childKind,childId]);
  }
  async audit(actorId: string, action: string, targetId?: string, reason?: string, metadata: unknown = {}): Promise<void> {
    await this.db.query("INSERT INTO audit_logs(guild_id,actor_id,action,target_id,reason,metadata) VALUES($1,$2,$3,$4,$5,$6)",[this.guildId,actorId,action,targetId ?? null,reason ?? null,JSON.stringify(metadata)]);
  }
  async enqueue(kind: string, key: string, payload: unknown, runAt = new Date()): Promise<string> {
    return (await this.db.query<{ id: string }>(`INSERT INTO jobs(id,guild_id,kind,event_key,payload,run_at) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(guild_id,kind,event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING id`,[randomUUID(),this.guildId,kind,key,JSON.stringify(payload),runAt])).rows[0]!.id;
  }
}
export class Store {
  constructor(public readonly database: Database) {}
  async run<T>(guildId: string, work: (unit: UnitOfWork) => Promise<T>): Promise<T> {
    return this.database.withTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`guild:${guildId}`]);
      const exists = await client.query("SELECT id FROM guilds WHERE id=$1",[guildId]);
      if (!exists.rowCount) throw new AppError("NOT_FOUND","Servidor ainda não registrado",404);
      return work(new UnitOfWork(client,guildId));
    });
  }
  async ensureGuild(id: string, name: string): Promise<void> {
    await this.database.query("INSERT INTO guilds(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name",[id,name]);
  }
}
