-- ── Move Pull-ups to the Fri/Sat gym day ─────────────────────────────────────
-- Fri/Sat held only Incline Bench — too thin to justify a gym trip, which is
-- part of why that session wasn't happening. Pull-ups were the one main
-- movement pattern living on a skippable day (Thu), and went 29 days
-- untrained because of it. Moving the row (not copying) keeps its history.
-- Its superset pairing with Leg Raises is dissolved, since they're now apart.
DO $$
DECLARE
  v_prog uuid; t_thu uuid; t_fs uuid; e_pullups uuid;
BEGIN
  SELECT p.id INTO v_prog FROM programs p
    JOIN profiles pr ON pr.id = p.profile_id
    WHERE pr.name = 'Eli' AND p.name = 'Weekly Split';
  SELECT id INTO t_thu FROM workout_templates WHERE program_id = v_prog AND name = 'Glenwood · Pulls & Curls';
  SELECT id INTO t_fs  FROM workout_templates WHERE program_id = v_prog AND name = 'Gym · Incline';
  SELECT id INTO e_pullups FROM exercise_templates
    WHERE workout_template_id = t_thu AND name = 'Pull-ups';
  IF e_pullups IS NULL THEN RETURN; END IF;  -- already moved

  UPDATE exercise_templates
    SET workout_template_id = t_fs, position = 1, superset_group = NULL
    WHERE id = e_pullups;

  -- Close the gap Thursday's ordering left behind
  UPDATE exercise_templates SET position = 0, superset_group = NULL
    WHERE workout_template_id = t_thu AND name = 'Leg Raises (Hanging/Chair)';
  UPDATE exercise_templates SET position = 1
    WHERE workout_template_id = t_thu AND name = 'DB Curls';
END $$;
