-- ── Fri/Sat becomes a full upper-body day (~1 hour) ──────────────────────────
-- Ordered by priority so cutting it short drops the tail, not the point:
--   0 Incline Bench   anchor (top + backoff)
--   1 Pull-ups        vertical pull
--   2 DB Row          2nd horizontal pull — Pendlay (Mon) was the only one
--   3 Dips            chest/triceps; triceps otherwise live on optional Tue
--   4 Face Pulls      shoulder health, otherwise only on optional Tue
-- The DB Row and Face Pull rows share movement_id with their existing copies,
-- so weights, history and progression are the same lift, not a fresh start.
-- DB Row stays at 2 sets: it's in the 2-set experiment via Lat Pulldown.
DO $$
DECLARE
  v_prog uuid; t_fs uuid; src uuid;
BEGIN
  SELECT p.id INTO v_prog FROM programs p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.name = 'Eli' AND p.name = 'Weekly Split';
  SELECT id INTO t_fs FROM workout_templates WHERE program_id = v_prog AND name = 'Gym · Incline';
  IF EXISTS (SELECT 1 FROM exercise_templates WHERE workout_template_id = t_fs AND name = 'Dips') THEN
    RETURN;  -- already built
  END IF;

  -- Copy an existing exercise into Friday, keeping its movement identity
  CREATE TEMP TABLE IF NOT EXISTS _copy (dummy int);
  FOR src IN
    SELECT e.id FROM exercise_templates e
    JOIN workout_templates w ON w.id = e.workout_template_id
    WHERE w.program_id = v_prog AND e.name IN ('DB Chest-Supported Row', 'Face Pulls / Rear Delt Flyes')
      AND e.workout_template_id <> t_fs
  LOOP
    INSERT INTO exercise_templates
      (workout_template_id, name, position, rpe_target, notes, superset_group,
       is_optional, bar_type, alternate_exercise_id, is_alternate_only, movement_id,
       warmup_rule, warmup_percentages, warmup_reps, warmup_db_percentage,
       warmup_db_reps, warmup_fixed_weight, warmup_fixed_reps,
       working_set_count, working_set_type, working_rep_target,
       backoff_set_count, backoff_percentage, backoff_rep_target,
       weight_increment, rounding_increment)
    SELECT t_fs, e.name,
           CASE e.name WHEN 'DB Chest-Supported Row' THEN 2 ELSE 4 END,
           e.rpe_target, e.notes, NULL,
           e.is_optional, e.bar_type, NULL, false, COALESCE(e.movement_id, e.id),
           e.warmup_rule, e.warmup_percentages, e.warmup_reps, e.warmup_db_percentage,
           e.warmup_db_reps, e.warmup_fixed_weight, e.warmup_fixed_reps,
           e.working_set_count, e.working_set_type, e.working_rep_target,
           e.backoff_set_count, e.backoff_percentage, e.backoff_rep_target,
           e.weight_increment, e.rounding_increment
    FROM exercise_templates e WHERE e.id = src;
  END LOOP;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, bar_type, is_alternate_only,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment)
  VALUES
    (t_fs, 'Dips', 3, '8',
     'Bodyweight — log 0 until you add a belt. Lean forward for chest, stay upright for triceps. Assisted machine is fine; log the assistance as 0 and track reps.',
     'none', false, 'none', 'straight_sets', 3, '8-12', 0, 5, 5);
END $$;
