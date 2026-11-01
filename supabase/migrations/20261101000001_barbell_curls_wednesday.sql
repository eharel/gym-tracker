-- ── Barbell Curls on Wednesday ───────────────────────────────────────────────
-- Wednesday is the thinnest reliable day (3 working sets, ~20 min in a 45-min
-- slot) while biceps are the only muscle with no reliable home: DB Curls sit
-- on the Thursday Glenwood session, which has not run once in six weeks.
-- A new movement rather than a copy of EZ Bar Curls: that's 30 lb total on a
-- 25 lb EZ bar, and a straight 45 lb barbell can't go below 45, so inheriting
-- those weights would prescribe a load the equipment can't make.
DO $$
DECLARE v_prog uuid; t_wed uuid;
BEGIN
  SELECT p.id INTO v_prog FROM programs p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.name = 'Eli' AND p.name = 'Weekly Split';
  SELECT id INTO t_wed FROM workout_templates
    WHERE program_id = v_prog AND name = 'Rifle · Deadlift & Press';
  IF t_wed IS NULL
     OR EXISTS (SELECT 1 FROM exercise_templates WHERE workout_template_id = t_wed AND name = 'Barbell Curls')
  THEN RETURN; END IF;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, bar_type, is_alternate_only,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment)
  VALUES
    (t_wed, 'Barbell Curls', 2, '8',
     'Total weight including the 45 lb bar. Strict — no hip swing; if the bar needs body English the set is over.',
     'barbell', false, 'none', 'straight_sets', 3, '8-12', 0, 5, 5);
END $$;
