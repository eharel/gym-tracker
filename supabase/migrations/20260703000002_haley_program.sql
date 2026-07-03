-- ── Haley's "Feel Strong Again" program ─────────────────────────────────────
-- Postpartum-friendly full-body program, 2–3×/week, alternating A/B.
-- All machine/dumbbell/bodyweight (bar_type none), no percentage warmups —
-- each workout starts with easy cardio instead. RPE 7 across the board
-- (2–3 reps in reserve). Bodyweight core moves get weight_increment 0 so
-- auto-progression never suggests phantom weight.
DO $$
DECLARE
  v_profile uuid;
  v_program uuid;
  v_wa uuid;
  v_wb uuid;
  v_warmup text := '5–10 min: recumbent bike or treadmill at a casual pace, then gentle arm circles and hip hinges.';
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE name = 'Haley') THEN
    RETURN; -- already seeded
  END IF;

  INSERT INTO profiles (name) VALUES ('Haley') RETURNING id INTO v_profile;

  INSERT INTO programs (name, description, is_active, profile_id)
  VALUES (
    'Feel Strong Again',
    'Full-body, 2–3×/week — alternate A and B. Aim for RPE 7: finish every set feeling like 2–3 more reps were in the tank. Exhale on the exertion (push/press = breathe out).',
    true,
    v_profile
  ) RETURNING id INTO v_program;

  INSERT INTO workout_templates (program_id, name, order_in_program, warmup_text)
  VALUES (v_program, 'Workout A', 0, v_warmup) RETURNING id INTO v_wa;
  INSERT INTO workout_templates (program_id, name, order_in_program, warmup_text)
  VALUES (v_program, 'Workout B', 1, v_warmup) RETURNING id INTO v_wb;

  -- ── Workout A: posterior strength & stability ─────────────────────────────
  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     weight_increment, rounding_increment, bar_type)
  VALUES
    (v_wa, 'Leg Press', 0, '7',
     'Feet high and wide on the sled — shifts work to glutes/hamstrings, off the right knee. Only lower as far as feels comfortable.',
     'A', 'none', 'straight_sets', 3, '10-12', 10, 5, 'none'),
    (v_wa, 'Lat Pulldown', 1, '7',
     'Back strength to counter baby-carrying posture.',
     'A', 'none', 'straight_sets', 3, '10-12', 5, 5, 'none'),
    (v_wa, 'Glute Bridges', 2, '7',
     'Bodyweight on a mat. Wakes up glutes and pelvic floor with zero knee stress.',
     'B', 'none', 'straight_sets', 3, '10-12', 0, 5, 'none'),
    (v_wa, 'Dumbbell Chest Press', 3, '7',
     'Flat or incline bench. Weight is per dumbbell.',
     'B', 'none', 'straight_sets', 3, '10-12', 5, 5, 'none'),
    (v_wa, 'Bird-Dogs', 4, '7',
     'Reps are per side. On all fours, extend opposite arm + leg. Slow and controlled — diastasis-safe core.',
     NULL, 'none', 'straight_sets', 3, '8', 0, 5, 'none');

  -- ── Workout B: hips & upper-body balance ──────────────────────────────────
  INSERT INTO exercise_templates
    (workout_template_id, name, position, rpe_target, notes, superset_group,
     warmup_rule, working_set_type, working_set_count, working_rep_target,
     weight_increment, rounding_increment, bar_type)
  VALUES
    (v_wb, 'Seated Hamstring Curl', 0, '7',
     'Strong hamstrings are the best knee stabilizer.',
     'A', 'none', 'straight_sets', 3, '10-12', 5, 5, 'none'),
    (v_wb, 'Seated Cable Row', 1, '7',
     'Posture and upper back — core-safe.',
     'A', 'none', 'straight_sets', 3, '10-12', 5, 5, 'none'),
    (v_wb, 'Dumbbell RDL', 2, '7',
     'Knees only slightly bent. Push hips straight back like closing a car door with your glutes. Weight is per dumbbell.',
     'B', 'none', 'straight_sets', 3, '10-12', 5, 5, 'none'),
    (v_wb, 'Seated Dumbbell Overhead Press', 3, '7',
     'Seated with back support so the core doesn''t overcompensate. Weight is per dumbbell.',
     'B', 'none', 'straight_sets', 3, '10-12', 5, 5, 'none'),
    (v_wb, 'Pallof Press', 4, '7',
     'Reps are per side. Cable at chest height, stand sideways, press out and back in — resist the twist.',
     NULL, 'none', 'straight_sets', 3, '10', 5, 2.5, 'none');

  -- Home-screen PR stat tracks her main lower-body lift
  UPDATE programs
    SET highlight_exercise_id = (
      SELECT id FROM exercise_templates WHERE workout_template_id = v_wa AND name = 'Leg Press'
    )
    WHERE id = v_program;
END $$;
