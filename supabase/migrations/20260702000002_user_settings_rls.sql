-- ── RLS for user_settings ────────────────────────────────────────────────────
-- Matches the anon-full-access policy every other table got in
-- 20260430000002 — user_settings was created later and missed it.
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon full access" ON user_settings
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Re-run the guarded seed in case the original insert was lost
INSERT INTO user_settings (unit_system)
SELECT 'imperial'
WHERE NOT EXISTS (SELECT 1 FROM user_settings);
