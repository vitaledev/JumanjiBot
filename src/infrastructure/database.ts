import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class Database {
  readonly pool: Pool;
  readonly supabase: SupabaseClient | undefined;

  constructor(connectionString: string, supabaseUrl?: string, serviceRoleKey?: string) {
    this.pool = new Pool({ connectionString, max: 10, application_name: "jumanji-rpg-bot" });
    this.supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : undefined;
  }

  query<Row extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values);
  }

  async withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
