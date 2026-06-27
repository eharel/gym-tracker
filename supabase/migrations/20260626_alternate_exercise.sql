-- ── Alternate exercise per exercise template ────────────────────────────────
-- One-to-one: each exercise can optionally point to a single alternate.
-- E.g. "EZ Bar Curls" → "DB Curls" for when a bar isn't available.
-- Relationship is one-directional; the app handles bidirectional swap UI.
ALTER TABLE exercise_templates
  ADD COLUMN IF NOT EXISTS alternate_exercise_id uuid
    REFERENCES exercise_templates(id) ON DELETE SET NULL;
