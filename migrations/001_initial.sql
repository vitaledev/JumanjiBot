CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  rpg_role TEXT NOT NULL DEFAULT 'recruit',
  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  honor INTEGER NOT NULL DEFAULT 0 CHECK (honor >= 0),
  division_id TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS divisions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0),
  name TEXT NOT NULL,
  color CHAR(7) NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  motto TEXT NOT NULL DEFAULT '',
  member_limit INTEGER NOT NULL CHECK (member_limit > 0),
  status TEXT NOT NULL DEFAULT 'active',
  captain_id TEXT,
  vice_captain_id TEXT,
  UNIQUE (guild_id, number)
);

ALTER TABLE guild_members ADD CONSTRAINT guild_members_division_fk
  FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS point_ledger (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  point_type TEXT NOT NULL CHECK (point_type IN ('xp', 'honor', 'influence', 'division')),
  reason TEXT NOT NULL,
  event_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, user_id, point_type, event_key)
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  xp_reward INTEGER NOT NULL CHECK (xp_reward >= 0),
  validation_type TEXT NOT NULL DEFAULT 'automatic',
  external_url TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS submissions (
  id BIGSERIAL PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  proof_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mission_id, guild_id, user_id, proof_url)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_guild_xp ON guild_members(guild_id, xp DESC);
CREATE INDEX IF NOT EXISTS idx_divisions_guild ON divisions(guild_id, number);
CREATE INDEX IF NOT EXISTS idx_audit_guild_created ON audit_logs(guild_id, created_at DESC);