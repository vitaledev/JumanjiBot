import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Database } from "./database.js";

export async function migrate(database: Database, directory = resolve("migrations")): Promise<string[]> {
  const client = await database.pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(734291008)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const known = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(row => row.name));
    for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      if (known.has(name)) continue;
      await client.query("BEGIN");
      try {
        await client.query(await readFile(resolve(directory, name), "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [name]);
        await client.query("COMMIT");
        applied.push(name);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(734291008)").catch(() => undefined);
    client.release();
  }
  return applied;
}
