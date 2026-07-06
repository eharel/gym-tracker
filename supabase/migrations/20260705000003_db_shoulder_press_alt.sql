-- ── DB Shoulder Press as the alternate for Standing OHP ─────────────────────
-- 1 dumbbell warmup set (percentage of working weight), then 3×10-12.
DO $$
DECLARE
  v_ohp uuid;
  v_db uuid;
BEGIN
  SELECT id INTO v_ohp FROM exercise_templates
    WHERE name = 'Standing OHP' AND is_alternate_only = false LIMIT 1;
  IF v_ohp IS NULL OR EXISTS (SELECT 1 FROM exercise_templates WHERE name = 'DB Shoulder Press') THEN
    RETURN;
  END IF;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     warmup_rule, warmup_db_percentage, warmup_db_reps,
     working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment, bar_type,
     is_alternate_only)
  SELECT workout_template_id, 'DB Shoulder Press', 999, rpe_target,
         'Weight is per dumbbell.', NULL,
         'dumbbell_percentage', 0.325, 10,
         'straight_sets', 3, '10-12',
         0, 5, 5, 'none',
         true
  FROM exercise_templates WHERE id = v_ohp
  RETURNING id INTO v_db;

  UPDATE exercise_templates SET alternate_exercise_id = v_db WHERE id = v_ohp;
END $$;
