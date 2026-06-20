-- ── User settings ──────────────────────────────────────────────────────────
-- Single-row table. Add future preference columns here — they'll be read
-- by the app via useSettingsStore without touching any screen.
CREATE TABLE IF NOT EXISTS user_settings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_system text        NOT NULL DEFAULT 'imperial'
                          CHECK (unit_system IN ('imperial', 'metric')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed one row if the table is empty (idempotent)
INSERT INTO user_settings DEFAULT VALUES
  ON CONFLICT DO NOTHING;

-- ── Program: configurable highlight exercise ────────────────────────────────
-- Replaces the hard-coded Squat UUID in getHomeStats. Each program can
-- point to whichever exercise is its "PR lift" — defaults to null (no stat).
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS highlight_exercise_id uuid
    REFERENCES exercise_templates(id) ON DELETE SET NULL;

-- Seed existing program(s) with the Squat exercise that was hard-coded before
UPDATE programs
  SET highlight_exercise_id = 'c0000000-0000-0000-0000-000000000001'
  WHERE highlight_exercise_id IS NULL;
