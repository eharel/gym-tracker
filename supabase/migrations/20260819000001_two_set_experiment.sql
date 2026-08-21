-- ── 2-set experiment (3-4 week trial, started 2026-08-19) ────────────────────
-- Accessory lifts were showing identical reps across all 3 sets (8-8-8), a
-- sign of pacing rather than near-failure effort. Cutting to 2 sets, both
-- taken to genuine failure, and watching for a real fatigue dropoff.
-- Revert to 3 if reps stay flat or 3rd-session frequency doesn't improve.
UPDATE exercise_templates
  SET working_set_count = 2
  WHERE working_set_type <> 'top_set'
    AND working_set_count = 3
    AND name IN (
      'Barbell RDL',
      'Pendlay Row',
      'Lat Pulldown (Wide)',
      'Pull-ups',
      'Bulgarian Split Squat'
    )
    AND workout_template_id IN (
      SELECT wt.id FROM workout_templates wt
      JOIN programs p ON p.id = wt.program_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE pr.name = 'Eli'
    );
