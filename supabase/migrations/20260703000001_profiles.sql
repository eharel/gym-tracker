-- ── Profiles: multi-user foundation ─────────────────────────────────────────
-- V2 is a trusted-household profile picker (no auth). The schema is shaped so
-- real accounts can land later WITHOUT a data migration:
--   • profiles.id is the future auth.users.id — when Supabase Auth arrives,
--     create auth users, update profiles.id to match (FKs cascade), and add
--     `id uuid references auth.users(id)`.
--   • Every user-owned root table carries profile_id. RLS today is anon-full
--     (single household); the auth upgrade swaps those policies for
--     `profile_id = auth.uid()` without touching app queries.
CREATE TABLE IF NOT EXISTS profiles (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon full access" ON profiles
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Seed the original (single) user; all existing data belongs to them
INSERT INTO profiles (name)
SELECT 'Eli'
WHERE NOT EXISTS (SELECT 1 FROM profiles);

-- ── Ownership columns ────────────────────────────────────────────────────────
-- programs and user_settings are user roots. sessions gets a direct
-- profile_id too (denormalized on purpose): it keeps "my in-progress
-- session" a single-table query and makes the future RLS policy trivial.
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE;

-- One settings row per profile
CREATE UNIQUE INDEX IF NOT EXISTS user_settings_profile_id_key
  ON user_settings (profile_id);

-- Backfill all existing data to the seeded profile
UPDATE programs      SET profile_id = (SELECT id FROM profiles ORDER BY created_at LIMIT 1) WHERE profile_id IS NULL;
UPDATE sessions      SET profile_id = (SELECT id FROM profiles ORDER BY created_at LIMIT 1) WHERE profile_id IS NULL;
UPDATE user_settings SET profile_id = (SELECT id FROM profiles ORDER BY created_at LIMIT 1) WHERE profile_id IS NULL;
