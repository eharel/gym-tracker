-- ── Backfill Eli's unlogged Sept 4 / 6 / 12 sessions ─────────────────────────
-- Trained but never recorded in the app; reconstructed from the calendar
-- export, which carries only the first working set of each exercise. Each
-- exercise gets that one set, placed at the index the app itself would use
-- (after its warmups) so future deltas line up. Exercises listed without
-- numbers are logged as done with no weight or reps. Times are nominal.

CREATE OR REPLACE FUNCTION pg_temp.log_set(
  p_session uuid, p_program uuid, p_name text, p_weight double precision, p_reps int
) RETURNS void AS $$
DECLARE v_count int;
BEGIN
  INSERT INTO set_logs
    (session_id, exercise_template_id, set_index, set_type, target_weight,
     actual_weight, target_reps, actual_reps, is_weight_override, completed)
  SELECT p_session, e.id,
         CASE e.warmup_rule
           WHEN 'percentage_of_top_set' THEN COALESCE(jsonb_array_length(e.warmup_percentages), 0)
           WHEN 'dumbbell_percentage' THEN 1
           WHEN 'fixed_weight' THEN 1
           ELSE 0
         END,
         CASE e.working_set_type
           WHEN 'top_set' THEN 'top'
           WHEN 'amrap' THEN 'amrap'
           ELSE 'working'
         END,
         p_weight, p_weight, e.working_rep_target, p_reps, false, true
  FROM exercise_templates e
  JOIN workout_templates w ON w.id = e.workout_template_id
  WHERE w.program_id = p_program AND e.name = p_name
  LIMIT 1;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'log_set: no exercise % in program', p_name;
  END IF;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_profile uuid; v_ab uuid; t_a uuid; t_b uuid; s uuid;
BEGIN
  SELECT id INTO v_profile FROM profiles WHERE name = 'Eli';
  SELECT id INTO v_ab FROM programs WHERE profile_id = v_profile AND name = 'Full Body A/B';
  SELECT id INTO t_a FROM workout_templates WHERE program_id = v_ab AND name = 'Full Body A';
  SELECT id INTO t_b FROM workout_templates WHERE program_id = v_ab AND name = 'Full Body B';
  IF EXISTS (
    SELECT 1 FROM sessions
    WHERE profile_id = v_profile
      AND started_at >= '2026-09-04' AND started_at < '2026-09-13'
  ) THEN
    RETURN;  -- already backfilled (or logged some other way)
  END IF;

  -- Fri Sept 4 · Full Body B (OHP swapped for DB Shoulder Press)
  INSERT INTO sessions (profile_id, workout_template_id, started_at, completed_at, notes)
  VALUES (v_profile, t_b, '2026-09-04T17:30:00Z', '2026-09-04T19:00:00Z',
          'Backfilled from calendar — first working set only.')
  RETURNING id INTO s;
  PERFORM pg_temp.log_set(s, v_ab, 'Deadlift (Conv.)', 245, 5);
  PERFORM pg_temp.log_set(s, v_ab, 'Incline Bench', 155, 8);
  PERFORM pg_temp.log_set(s, v_ab, 'Bulgarian Split Squat', 40, 10);
  PERFORM pg_temp.log_set(s, v_ab, 'Lat Pulldown (Wide)', 160, 8);
  PERFORM pg_temp.log_set(s, v_ab, 'Incline Crunch', NULL, NULL);
  PERFORM pg_temp.log_set(s, v_ab, 'Face Pulls / Rear Delt Flyes', 50, 12);
  PERFORM pg_temp.log_set(s, v_ab, 'DB Shoulder Press', 40, 9);

  -- Sun Sept 6 · Full Body A
  INSERT INTO sessions (profile_id, workout_template_id, started_at, completed_at, notes)
  VALUES (v_profile, t_a, '2026-09-06T17:30:00Z', '2026-09-06T19:00:00Z',
          'Backfilled from calendar — first working set only.')
  RETURNING id INTO s;
  PERFORM pg_temp.log_set(s, v_ab, 'Squat', 270, 4);
  PERFORM pg_temp.log_set(s, v_ab, 'Bench Press', 235, 5);
  PERFORM pg_temp.log_set(s, v_ab, 'Barbell RDL', 175, 9);
  PERFORM pg_temp.log_set(s, v_ab, 'Pendlay Row', 185, 7);
  PERFORM pg_temp.log_set(s, v_ab, 'Pull-ups', 0, NULL);
  PERFORM pg_temp.log_set(s, v_ab, 'Leg Raises (Hanging/Chair)', 0, NULL);
  PERFORM pg_temp.log_set(s, v_ab, 'EZ Bar Curls', 30, 9);
  PERFORM pg_temp.log_set(s, v_ab, 'Overhead Tricep Extension', 57.5, 12);

  -- Sat Sept 12 · Full Body B (partial)
  INSERT INTO sessions (profile_id, workout_template_id, started_at, completed_at, notes)
  VALUES (v_profile, t_b, '2026-09-12T17:30:00Z', '2026-09-12T19:00:00Z',
          'Backfilled from calendar — first working set only.')
  RETURNING id INTO s;
  PERFORM pg_temp.log_set(s, v_ab, 'Deadlift (Conv.)', 275, 3);
  PERFORM pg_temp.log_set(s, v_ab, 'Incline Bench', 180, 8);
  PERFORM pg_temp.log_set(s, v_ab, 'Bulgarian Split Squat', 50, 8);
END $$;
