-- ── Alternate-only exercises ─────────────────────────────────────────────────
-- An exercise flagged is_alternate_only lives in a workout template (keeping
-- the ownership chain and history queries intact) but is never rendered as a
-- workout exercise — it only appears when swapped in via alternate_exercise_id.
ALTER TABLE exercise_templates
  ADD COLUMN IF NOT EXISTS is_alternate_only boolean NOT NULL DEFAULT false;

-- Seed: DB Curls as the alternate for EZ Bar Curls, copying its set scheme.
DO $$
DECLARE
  v_ez uuid;
  v_db uuid;
BEGIN
  SELECT id INTO v_ez FROM exercise_templates
    WHERE name = 'EZ Bar Curls' AND is_alternate_only = false LIMIT 1;
  IF v_ez IS NULL OR EXISTS (SELECT 1 FROM exercise_templates WHERE name = 'DB Curls') THEN
    RETURN;
  END IF;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment, bar_type,
     is_alternate_only)
  SELECT workout_template_id, 'DB Curls', 999, rpe_target,
         'Weight is per dumbbell.', NULL,
         'none', working_set_type, working_set_count, working_rep_target,
         0, 5, 5, 'none',
         true
  FROM exercise_templates WHERE id = v_ez
  RETURNING id INTO v_db;

  UPDATE exercise_templates SET alternate_exercise_id = v_db WHERE id = v_ez;
END $$;
