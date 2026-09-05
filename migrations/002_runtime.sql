-- Incremental: preserve all existing tables and data.
ALTER TABLE guild_members ALTER COLUMN consented_at DROP NOT NULL;
ALTER TABLE guild_members ALTER COLUMN consented_at DROP DEFAULT;
ALTER TABLE guild_members ADD COLUMN participation TEXT NOT NULL DEFAULT 'pending' CHECK (participation IN ('pending','active','left'));
-- Legacy auto-enrollment did not distinguish explicit consent. Request consent again.
UPDATE guild_members SET consented_at = NULL;
ALTER TABLE guild_members ADD COLUMN influence INTEGER NOT NULL DEFAULT 0 CHECK(influence >= 0);
ALTER TABLE guild_members ADD COLUMN credits INTEGER NOT NULL DEFAULT 0 CHECK(credits >= 0);
ALTER TABLE guild_members ADD COLUMN joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE guild_members ADD COLUMN preferences JSONB NOT NULL DEFAULT '{"notifications":true,"reactivation":false}'::jsonb;
ALTER TABLE divisions ADD CONSTRAINT divisions_guild_id_id_key UNIQUE(guild_id,id);
ALTER TABLE guild_members DROP CONSTRAINT guild_members_division_fk;
ALTER TABLE guild_members ADD CONSTRAINT guild_members_division_scope_fk FOREIGN KEY(guild_id,division_id) REFERENCES divisions(guild_id,id);
ALTER TABLE point_ledger DROP CONSTRAINT point_ledger_point_type_check;
ALTER TABLE point_ledger ADD CHECK(point_type IN ('xp','honor','influence','division','credits'));
ALTER TABLE point_ledger ADD COLUMN season_id TEXT;
ALTER TABLE point_ledger ADD COLUMN actor_id TEXT;
ALTER TABLE point_ledger ADD COLUMN reversal_of BIGINT REFERENCES point_ledger(id);
CREATE UNIQUE INDEX ledger_reversal_once ON point_ledger(reversal_of) WHERE reversal_of IS NOT NULL;
INSERT INTO point_ledger(guild_id,user_id,amount,point_type,reason,event_key)
SELECT guild_id,user_id,xp,'xp','Saldo anterior à migração','migration:opening:xp' FROM guild_members m WHERE xp <> 0 AND NOT EXISTS(SELECT 1 FROM point_ledger l WHERE l.guild_id=m.guild_id AND l.user_id=m.user_id AND l.point_type='xp');
INSERT INTO point_ledger(guild_id,user_id,amount,point_type,reason,event_key)
SELECT guild_id,user_id,honor,'honor','Saldo anterior à migração','migration:opening:honor' FROM guild_members m WHERE honor <> 0 AND NOT EXISTS(SELECT 1 FROM point_ledger l WHERE l.guild_id=m.guild_id AND l.user_id=m.user_id AND l.point_type='honor');

-- Namespaced documents hold evolving module state; edges enforce scoped relationships.
CREATE TABLE rpg_records (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT', data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(guild_id,kind,id)
);
CREATE INDEX rpg_records_list ON rpg_records(guild_id,kind,status,created_at DESC);
CREATE INDEX rpg_records_owner ON rpg_records(guild_id,owner_id);
CREATE TABLE rpg_edges (
  guild_id TEXT NOT NULL, parent_kind TEXT NOT NULL, parent_id TEXT NOT NULL, child_kind TEXT NOT NULL, child_id TEXT NOT NULL,
  PRIMARY KEY(guild_id,parent_kind,parent_id,child_kind,child_id),
  FOREIGN KEY(guild_id,parent_kind,parent_id) REFERENCES rpg_records(guild_id,kind,id) ON DELETE CASCADE,
  FOREIGN KEY(guild_id,child_kind,child_id) REFERENCES rpg_records(guild_id,kind,id) ON DELETE CASCADE
);
CREATE TABLE privacy_markers (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  subject_hash TEXT NOT NULL, opted_out BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(guild_id,subject_hash)
);
CREATE TABLE web_sessions (token_hash TEXT PRIMARY KEY, user_data JSONB NOT NULL, csrf TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, event_key TEXT NOT NULL, payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed','cancelled')),
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ, lease_token TEXT, last_error TEXT, result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(guild_id,kind,event_key)
);
CREATE INDEX jobs_due ON jobs(status,run_at,lease_until);
CREATE TABLE private_files (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE, user_id TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpg_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpg_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
