-- ── Wednesday curls move to the EZ bar ───────────────────────────────────────
-- Rifle has an EZ bar after all, which is the better choice: the 25 lb bar
-- removes the 45 lb floor a straight bar imposed (a big jump from the 30 lb
-- already logged), and the semi-supinated grip is easier on elbows already
-- loaded by deadlifts, dips and pull-ups.
--
-- Converted in place rather than replaced, and pointed at the existing EZ Bar
-- Curls movement, so Wednesday continues that lift's history instead of
-- starting blank. Rep target and rounding now match the movement's other
-- slots, so the same lift reads the same everywhere.
UPDATE exercise_templates ex
  SET name = 'EZ Bar Curls',
      bar_type = 'ez_bar',
      movement_id = root.id,
      working_rep_target = '10-12',
      rounding_increment = 2.5,
      notes = 'Total weight (plates + bar) — the EZ bar is 25 lb. Strict: no hip swing.'
  FROM exercise_templates root
  WHERE ex.name = 'Barbell Curls'
    AND root.name = 'EZ Bar Curls'
    AND root.movement_id IS NULL;
