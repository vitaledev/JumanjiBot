import "dotenv/config";
import { z } from "zod";
const optional = z.preprocess(v=>v===""?undefined:v,z.string().optional());
const boolean = z.enum(["true","false"]).default("false").transform(v=>v==="true");
const schema=z.object({
  DISCORD_TOKEN:z.string().min(1), DISCORD_CLIENT_ID:z.string().min(1),
  DISCORD_CLIENT_SECRET:optional,
  DATABASE_URL:z.string().min(1).refine(v=>/^postgres(?:ql)?:\/\//.test(v),"Use uma conexão PostgreSQL"),
  SESSION_SECRET:z.string().min(32), PRIVACY_SECRET:optional,
  WEB_ORIGIN:z.url().default("http://localhost:4173"), PANEL_ORIGIN:optional, WEB_HOST:z.string().default("127.0.0.1"),
  WEB_PORT:z.coerce.number().int().min(1).max(65535).default(4173),
  FILES_DIR:z.string().default("./data/files"),
  TEST_GUILD_ID:optional, SUPABASE_URL:optional, SUPABASE_PUBLISHABLE_KEY:optional, SUPABASE_SERVICE_ROLE_KEY:optional, INSTAGRAM_POST_URL:z.url().default("https://www.instagram.com/"),PANEL_GIF_URL:optional,
  ENABLE_MESSAGE_ACTIVITY:boolean,ENABLE_MEMBER_EVENTS:boolean,ENABLE_VOICE_ACTIVITY:boolean,ENABLE_REACTION_ACTIVITY:boolean,
  RUN_WORKER:z.enum(["true","false"]).default("true").transform(v=>v==="true"),
  NODE_ENV:z.enum(["development","test","production"]).default("development")
});
export type Config=z.infer<typeof schema>;
export function loadConfig():Config {
  const parsed=schema.safeParse(process.env);
  if(!parsed.success) throw new Error(`Configuração inválida: ${parsed.error.issues.map(i=>i.path.join(".")).join(", ")}. Consulte .env.example; valores não foram exibidos.`);
  const config=parsed.data;
  config.PANEL_ORIGIN ??= config.WEB_ORIGIN;
  if(config.NODE_ENV==="production" && new URL(config.WEB_ORIGIN).protocol!=="https:") throw new Error("WEB_ORIGIN deve usar HTTPS em produção");
  return config;
}

