-- ── Recalibrate dumbbell warmups for actual dumbbells ───────────────────────
-- 32.5% was tuned for barbell lifts that warm up with dumbbells (a 160 lb RDL
-- → 50 lb primer). Applied to real dumbbell loads it collapses: a 40 lb
-- working weight produced a 15 lb warmup. Logged overrides on these two sat
-- at 56-62%, so 60% matches what actually gets used.
--
-- Barbell RDL and Pendlay Row deliberately keep 32.5% — their working weights
-- are barbell-scale, so the lighter fraction still lands on a sane dumbbell.
UPDATE exercise_templates
  SET warmup_db_percentage = 0.6
  WHERE warmup_rule = 'dumbbell_percentage'
    AND bar_type = 'none'
    AND warmup_db_percentage = 0.325;
