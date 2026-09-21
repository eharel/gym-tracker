-- ── Backfill weights on sets completed at the prescribed weight ──────────────
-- Completing a set without touching its weight left actual_weight NULL. The
-- session planner already read that as "done at target_weight", but progress
-- charts, exercise history, the PR stat and staleness all skipped those rows,
-- hiding every set done exactly as prescribed (438 at the time of writing).
-- The app now records target_weight on completion; this aligns the history.
-- Lossless: is_weight_override stays false on these rows, which still marks
-- them as "accepted the prescribed weight" rather than "typed a weight".
UPDATE set_logs
  SET actual_weight = target_weight
  WHERE completed
    AND actual_weight IS NULL
    AND target_weight IS NOT NULL;
