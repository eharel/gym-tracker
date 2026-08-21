-- ── Optional deadlift backoff + alternates matched to the 2-set trial ────────
-- Deadlift gets a backoff percentage and rep target but keeps
-- backoff_set_count = 0. initializeSession only generates backoffs when the
-- count is > 0, so nothing is prescribed and nothing nags on completion —
-- but "Add set" after the top set now computes the backoff the normal way
-- (80% of the top set), making it genuinely optional.
-- 80%/5-8 rather than the squat's 81%/8-10: deadlift backoff volume is far
-- more costly to recover from, and the top set is already the program's
-- heaviest rep range.
UPDATE exercise_templates
  SET backoff_percentage = 0.80,
      backoff_rep_target = '5-8'
  WHERE name = 'Deadlift (Conv.)'
    AND backoff_set_count = 0
    AND backoff_percentage IS NULL;

-- Alternates share the slot being tested, so they follow the same 2-set rule
UPDATE exercise_templates
  SET working_set_count = 2
  WHERE is_alternate_only = true
    AND working_set_count = 3
    AND name IN ('DB Chest-Supported Row', 'DB Shoulder Press');
