import "dotenv/config";
import { Database } from "./database.js";
import { migrate } from "./migrations.js";
if (!process.env.DATABASE_URL) throw new Error("Configure DATABASE_URL para migrar");
const database = new Database(process.env.DATABASE_URL,process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
try { for (const name of await migrate(database)) console.log(`Migração aplicada: ${name}`); }
finally { await database.close(); }
