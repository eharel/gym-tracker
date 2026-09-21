-- ── Movement identity across programs ────────────────────────────────────────
-- An exercise row is a slot in one program's workout. When a program is
-- derived from another, its exercises are copies — and a copy points back to
-- its original via movement_id, so history ("when did I last squat?"),
-- progression, PRs and comeback detection span every copy of the movement.
-- NULL means the row is itself the root of its movement (key = its own id).
ALTER TABLE exercise_templates
  ADD COLUMN IF NOT EXISTS movement_id uuid;

CREATE INDEX IF NOT EXISTS idx_exercise_templates_movement_id
  ON exercise_templates (movement_id);

-- ── Weekly scheduling ────────────────────────────────────────────────────────
-- scheduled_days: JS weekday numbers (0 = Sun … 6 = Sat) a workout belongs to.
-- A program whose workouts all have NULL days keeps A/B-style rotation; any
-- scheduled days switch the home screen to the weekly view.
-- is_optional: bonus sessions — shown as skipped (not missed) when not done.
ALTER TABLE workout_templates
  ADD COLUMN IF NOT EXISTS scheduled_days smallint[],
  ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false;
