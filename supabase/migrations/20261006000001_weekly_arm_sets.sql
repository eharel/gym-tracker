-- ── Weekly Split: direct arm work goes to 3 sets ─────────────────────────────
-- Carried over as 2 sets from Full Body A, where curls and triceps were a
-- 2-set superset pair. In the weekly split they're standalone, and they live
-- only on the optional Glenwood days — so a skipped Tuesday meant zero direct
-- tricep sets that week. The alternate follows its primary so a swap keeps
-- the same volume. Full Body A/B is left alone (still supersetted there).
UPDATE exercise_templates
  SET working_set_count = 3
  WHERE working_set_count = 2
    AND name IN ('Overhead Tricep Extension', 'DB Curls', 'EZ Bar Curls')
    AND workout_template_id IN (
      SELECT wt.id FROM workout_templates wt
      JOIN programs p ON p.id = wt.program_id
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE pr.name = 'Eli' AND p.name = 'Weekly Split'
    );
