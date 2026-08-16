-- ── Track ab work as real exercises ─────────────────────────────────────────
-- Leg raises and incline crunches were previously untracked, mentioned only
-- in the notes of the lifts they superset with. Both are progressible, so
-- they get rep ranges (not AMRAP — AMRAP never triggers auto-progression)
-- and a weight increment for when a dumbbell/plate gets added.
DO $$
DECLARE
  v_a uuid;
  v_b uuid;
BEGIN
  SELECT wt.id INTO v_a FROM workout_templates wt
    JOIN programs p ON p.id = wt.program_id
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.name = 'Eli' AND wt.name = 'Full Body A';
  SELECT wt.id INTO v_b FROM workout_templates wt
    JOIN programs p ON p.id = wt.program_id
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.name = 'Eli' AND wt.name = 'Full Body B';

  IF v_a IS NULL OR EXISTS (SELECT 1 FROM exercise_templates WHERE name = 'Leg Raises (Hanging/Chair)') THEN
    RETURN;
  END IF;

  -- ── Full Body A: leg raises directly after Pull-ups so the superset renders
  UPDATE exercise_templates SET position = position + 1
    WHERE workout_template_id = v_a AND position >= 5;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment, bar_type, is_alternate_only)
  VALUES
    (v_a, 'Leg Raises (Hanging/Chair)', 5, '8',
     'Captain''s chair or hanging. Strict — no swing. Progress bent-knee → straight-leg → dumbbell between the feet.',
     'pull_ups_leg_raises',
     'none', 'straight_sets', 3, '8-12',
     0, 5, 5, 'none', false);

  -- ── Full Body B: crunches directly after Standing OHP (same bss_abs group)
  UPDATE exercise_templates SET position = position + 1
    WHERE workout_template_id = v_b AND position >= 5;

  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     backoff_set_count, weight_increment, rounding_increment, bar_type, is_alternate_only)
  VALUES
    (v_b, 'Incline Crunch', 5, '8',
     'Back-extension bench used in reverse — full stretch at the bottom. Log the plate held on the chest (0 if bodyweight).',
     'bss_abs',
     'none', 'straight_sets', 3, '12-15',
     0, 5, 5, 'none', false);
END $$;

-- ── Make the dumbbell warmups on RDL / Pendlay Row explicit ──────────────────
-- These intentionally warm up with dumbbells to avoid plate changes, but the
-- columns were empty, so the values came from hard-coded fallbacks (32.5%, 10)
-- and the editor showed blank fields. Same behavior, now visible and editable.
UPDATE exercise_templates
  SET warmup_db_percentage = 0.325, warmup_db_reps = 10
  WHERE name IN ('Barbell RDL', 'Pendlay Row')
    AND warmup_rule = 'dumbbell_percentage'
    AND warmup_db_percentage IS NULL;
