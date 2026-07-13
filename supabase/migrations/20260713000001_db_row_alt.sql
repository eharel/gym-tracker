-- ── DB Chest-Supported Row as the alternate for Lat Pulldown (Wide) ─────────
-- Horizontal-pull stand-in for the vertical pull: 1 dumbbell warmup set
-- (percentage of working weight) + 3×8-10 matching the pulldown's scheme.
DO $$
DECLARE
  v_lat uuid;
  v_row uuid;
BEGIN
  SELECT id INTO v_lat FROM exercise_templates
    WHERE name = 'Lat Pulldown (Wide)' AND is_alternate_only = false LIMIT 1;
  IF v_lat IS NULL OR EXISTS (SELECT 1 FROM exercise_templates WHERE name = 'DB Chest-Supported Row') THEN
    RETURN;
  END IF;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     warmup_rule, warmup_db_percentage, warmup_db_reps,
     working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment, bar_type,
     is_alternate_only)
  SELECT workout_template_id, 'DB Chest-Supported Row', 999, rpe_target,
         'Weight is per dumbbell. Chest on an incline bench, row to your hips.', NULL,
         'dumbbell_percentage', 0.325, 10,
         'straight_sets', working_set_count, working_rep_target,
         0, 5, 5, 'none',
         true
  FROM exercise_templates WHERE id = v_lat
  RETURNING id INTO v_row;

  UPDATE exercise_templates SET alternate_exercise_id = v_row WHERE id = v_lat;
END $$;
