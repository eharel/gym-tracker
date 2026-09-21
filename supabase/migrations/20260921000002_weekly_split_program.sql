-- ── Eli: Weekly Split program ────────────────────────────────────────────────
-- A day-by-day program built around the work schedule: barbell at Rifle
-- (Mon/Wed, 30-45 min), optional accessories at Glenwood (Tue/Thu), and the
-- full gym Fri-or-Sat and Sun. Every exercise is a COPY of the Full Body A/B
-- row with movement_id pointing back at it, so history, weights, PRs and
-- comeback state carry over — and the A/B program stays intact and switchable.
-- Created inactive; switched on from the app once verified.

-- Copies one exercise from a program into a workout, returning the new id.
-- Raises instead of skipping, so a renamed source fails this loudly.
CREATE OR REPLACE FUNCTION pg_temp.copy_ex(
  src_program uuid, ex_name text, dst_template uuid,
  pos int, ss text, alt_only boolean
) RETURNS uuid AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     is_optional, bar_type, alternate_exercise_id, is_alternate_only, movement_id,
     warmup_rule, warmup_percentages, warmup_reps, warmup_db_percentage,
     warmup_db_reps, warmup_fixed_weight, warmup_fixed_reps,
     working_set_count, working_set_type, working_rep_target,
     backoff_set_count, backoff_percentage, backoff_rep_target,
     weight_increment, rounding_increment)
  SELECT dst_template, e.name, pos, e.rpe_target, e.notes, ss,
         e.is_optional, e.bar_type, NULL, alt_only, COALESCE(e.movement_id, e.id),
         e.warmup_rule, e.warmup_percentages, e.warmup_reps, e.warmup_db_percentage,
         e.warmup_db_reps, e.warmup_fixed_weight, e.warmup_fixed_reps,
         e.working_set_count, e.working_set_type, e.working_rep_target,
         e.backoff_set_count, e.backoff_percentage, e.backoff_rep_target,
         e.weight_increment, e.rounding_increment
  FROM exercise_templates e
  JOIN workout_templates w ON w.id = e.workout_template_id
  WHERE w.program_id = src_program AND e.name = ex_name
  LIMIT 1
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'copy_ex: no exercise % in source program', ex_name;
  END IF;
  RETURN v_id;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_profile uuid; v_ab uuid; v_prog uuid;
  v_warm text; v_cool text;
  t_mon uuid; t_tue uuid; t_wed uuid; t_thu uuid; t_fs uuid; t_sun uuid;
  e_pulldown uuid; e_dbrow uuid; e_ohp uuid; e_dbpress uuid;
  e_dbcurl uuid; e_ezcurl uuid; e_squat uuid; e_rdl uuid; e_pendlay uuid;
  e_bss uuid; e_pullups uuid;
BEGIN
  SELECT id INTO v_profile FROM profiles WHERE name = 'Eli';
  SELECT id INTO v_ab FROM programs WHERE profile_id = v_profile AND name = 'Full Body A/B';
  IF v_ab IS NULL
     OR EXISTS (SELECT 1 FROM programs WHERE profile_id = v_profile AND name = 'Weekly Split') THEN
    RETURN;
  END IF;
  SELECT warmup_text, cooldown_text INTO v_warm, v_cool
    FROM workout_templates WHERE program_id = v_ab AND name = 'Full Body A';

  INSERT INTO programs (name, description, is_active, profile_id)
  VALUES ('Weekly Split',
          'Barbell at Rifle Mon/Wed, optional accessories at Glenwood Tue/Thu, full gym Fri-or-Sat and Sun.',
          false, v_profile)
  RETURNING id INTO v_prog;

  -- JS weekdays: Sun 0, Mon 1 … Sat 6
  INSERT INTO workout_templates (program_id, name, order_in_program, scheduled_days, is_optional, warmup_text)
    VALUES (v_prog, 'Rifle · Bench & Rows', 0, '{1}', false, v_warm) RETURNING id INTO t_mon;
  INSERT INTO workout_templates (program_id, name, order_in_program, scheduled_days, is_optional)
    VALUES (v_prog, 'Glenwood · Delts, Tris & Core', 1, '{2}', true) RETURNING id INTO t_tue;
  INSERT INTO workout_templates (program_id, name, order_in_program, scheduled_days, is_optional, warmup_text)
    VALUES (v_prog, 'Rifle · Deadlift & Press', 2, '{3}', false, v_warm) RETURNING id INTO t_wed;
  INSERT INTO workout_templates (program_id, name, order_in_program, scheduled_days, is_optional)
    VALUES (v_prog, 'Glenwood · Pulls & Curls', 3, '{4}', true) RETURNING id INTO t_thu;
  INSERT INTO workout_templates (program_id, name, order_in_program, scheduled_days, is_optional, warmup_text)
    VALUES (v_prog, 'Gym · Incline', 4, '{5,6}', false, v_warm) RETURNING id INTO t_fs;
  INSERT INTO workout_templates (program_id, name, order_in_program, scheduled_days, is_optional, warmup_text, cooldown_text)
    VALUES (v_prog, 'Gym · Legs', 5, '{0}', false, v_warm, v_cool) RETURNING id INTO t_sun;

  -- Mon · Rifle
  PERFORM pg_temp.copy_ex(v_ab, 'Bench Press', t_mon, 0, NULL, false);
  e_pendlay  := pg_temp.copy_ex(v_ab, 'Pendlay Row', t_mon, 1, NULL, false);
  e_pulldown := pg_temp.copy_ex(v_ab, 'Lat Pulldown (Wide)', t_mon, 2, NULL, false);
  e_dbrow    := pg_temp.copy_ex(v_ab, 'DB Chest-Supported Row', t_mon, 999, NULL, true);
  UPDATE exercise_templates SET alternate_exercise_id = e_dbrow WHERE id = e_pulldown;

  -- Tue · Glenwood (optional)
  PERFORM pg_temp.copy_ex(v_ab, 'Face Pulls / Rear Delt Flyes', t_tue, 0, NULL, false);
  PERFORM pg_temp.copy_ex(v_ab, 'Overhead Tricep Extension', t_tue, 1, NULL, false);
  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, bar_type, is_alternate_only,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment)
  VALUES
    (t_tue, 'Pallof Press', 2, '8',
     'Reps are per side. Cable at chest height, stand side-on, press straight out and back — resist the twist.',
     'none', false, 'none', 'straight_sets', 3, '10-12', 0, 5, 2.5);

  -- Wed · Rifle
  PERFORM pg_temp.copy_ex(v_ab, 'Deadlift (Conv.)', t_wed, 0, NULL, false);
  e_ohp     := pg_temp.copy_ex(v_ab, 'Standing OHP', t_wed, 1, NULL, false);
  e_dbpress := pg_temp.copy_ex(v_ab, 'DB Shoulder Press', t_wed, 999, NULL, true);
  UPDATE exercise_templates
    SET alternate_exercise_id = e_dbpress,
        notes = 'No rack at Rifle — clean the bar from the floor to the front rack, then press.'
    WHERE id = e_ohp;

  -- Thu · Glenwood (optional): DB Curls becomes the main curl there
  e_pullups := pg_temp.copy_ex(v_ab, 'Pull-ups', t_thu, 0, 'pull_ups_leg_raises', false);
  PERFORM pg_temp.copy_ex(v_ab, 'Leg Raises (Hanging/Chair)', t_thu, 1, 'pull_ups_leg_raises', false);
  e_dbcurl  := pg_temp.copy_ex(v_ab, 'DB Curls', t_thu, 2, NULL, false);
  e_ezcurl  := pg_temp.copy_ex(v_ab, 'EZ Bar Curls', t_thu, 999, NULL, true);
  UPDATE exercise_templates SET alternate_exercise_id = e_ezcurl WHERE id = e_dbcurl;
  UPDATE exercise_templates SET notes = NULL WHERE id = e_pullups;  -- leg raises are tracked now

  -- Fri/Sat · Gym
  PERFORM pg_temp.copy_ex(v_ab, 'Incline Bench', t_fs, 0, NULL, false);

  -- Sun · Gym: squat first, RDL while fresh, BSS last (lowest-risk failure mode)
  e_squat := pg_temp.copy_ex(v_ab, 'Squat', t_sun, 0, NULL, false);
  e_rdl   := pg_temp.copy_ex(v_ab, 'Barbell RDL', t_sun, 1, NULL, false);
  e_bss   := pg_temp.copy_ex(v_ab, 'Bulgarian Split Squat', t_sun, 2, 'bss_abs', false);
  PERFORM pg_temp.copy_ex(v_ab, 'Incline Crunch', t_sun, 3, 'bss_abs', false);
  UPDATE exercise_templates SET notes = 'Weight is per-hand DB.' WHERE id = e_bss;

  -- Hinges stop at technical failure, not true failure (2-set experiment rule)
  UPDATE exercise_templates
    SET notes = 'Stop at technical failure — end the set on the first rep where your back position changes.'
    WHERE id IN (e_rdl, e_pendlay);

  UPDATE programs SET highlight_exercise_id = e_squat WHERE id = v_prog;
END $$;
