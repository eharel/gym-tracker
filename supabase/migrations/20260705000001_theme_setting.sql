-- ── Per-profile theme preference ─────────────────────────────────────────────
-- Free text (not a CHECK constraint) on purpose: themes are defined in the
-- app's CSS, and adding one shouldn't require a schema migration. Unknown
-- values fall back to the default theme in the app.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'ember';
