-- ── Bar type on exercise templates ──────────────────────────────────────────
-- Replaces the implicit "barbell = percentage_of_top_set warmup" assumption.
-- Each exercise now declares what bar it uses; plate-math reads bar weight
-- from a lookup in the app rather than assuming 45 lbs everywhere.
ALTER TABLE exercise_templates
  ADD COLUMN IF NOT EXISTS bar_type text NOT NULL DEFAULT 'none'
    CHECK (bar_type IN ('barbell', 'ez_bar', 'hex_bar', 'safety_squat_bar', 'none'));

-- Seed: exercises that already use the percentage warmup system are barbells.
-- EZ-bar / hex-bar / SSB exercises can be updated individually after migration.
UPDATE exercise_templates
  SET bar_type = 'barbell'
  WHERE warmup_rule = 'percentage_of_top_set'
    AND bar_type = 'none';
