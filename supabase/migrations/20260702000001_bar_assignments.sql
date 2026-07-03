-- ── Bar assignments the 20260625 auto-seed can't infer ──────────────────────
-- That migration only marks percentage_of_top_set exercises as barbells.
-- These lifts use a bar but warm up differently (or not at all).
UPDATE exercise_templates SET bar_type = 'barbell'
  WHERE name IN ('Barbell RDL', 'Pendlay Row') AND bar_type = 'none';

UPDATE exercise_templates SET bar_type = 'ez_bar'
  WHERE name = 'EZ Bar Curls' AND bar_type = 'none';
