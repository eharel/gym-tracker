-- "Gym · Incline" no longer describes the session now that it's a full
-- upper-body day. Applied live; recorded here so a fresh database matches.
UPDATE workout_templates wt
  SET name = 'Gym · Upper'
  FROM programs p, profiles pr
  WHERE wt.program_id = p.id AND p.profile_id = pr.id
    AND pr.name = 'Eli' AND p.name = 'Weekly Split'
    AND wt.name = 'Gym · Incline';
