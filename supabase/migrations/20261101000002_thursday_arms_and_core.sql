-- ── Thursday becomes Arms & Core ─────────────────────────────────────────────
-- Pull-ups moved to Friday and curls now have a reliable home on Wednesday,
-- so the old "Pulls & Curls" name no longer fits. Thursday keeps the role of
-- a bonus day: supplementary, low-sweat, no setup — nothing load-bearing, so
-- a week without it costs nothing essential.
--
-- Lateral Raises fill the only muscle with no direct work anywhere in the
-- program (side delts). Rep range is deliberately wide at 12-20: dumbbells
-- step in 5 lb jumps, which at lateral-raise loads is a 25-50% increase —
-- by far the coarsest increment in the program — so reps have to carry most
-- of the progression between jumps.
DO $$
DECLARE v_prog uuid; t_thu uuid;
BEGIN
  SELECT p.id INTO v_prog FROM programs p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.name = 'Eli' AND p.name = 'Weekly Split';
  SELECT id INTO t_thu FROM workout_templates
    WHERE program_id = v_prog AND name = 'Glenwood · Pulls & Curls';
  IF t_thu IS NULL THEN RETURN; END IF;

  UPDATE workout_templates SET name = 'Glenwood · Arms & Core' WHERE id = t_thu;

  IF EXISTS (SELECT 1 FROM exercise_templates WHERE workout_template_id = t_thu AND name = 'Lateral Raises')
  THEN RETURN; END IF;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, bar_type, is_alternate_only,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment)
  VALUES
    (t_thu, 'Lateral Raises', 2, '8',
     'Weight is per dumbbell. Lead with the elbows, stop at shoulder height, no swing — if the traps take over, drop the weight.',
     'none', false, 'none', 'straight_sets', 3, '12-20', 0, 5, 5);
END $$;
