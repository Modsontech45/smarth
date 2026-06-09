-- ============================================================
-- User zone restrictions
-- Admin can restrict which zones a user can view/control.
-- Empty (no rows for user) = full access (default open).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_zone_restrictions (
  id        SERIAL PRIMARY KEY,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone      VARCHAR(50) NOT NULL,
  UNIQUE (user_id, zone)
);

CREATE INDEX IF NOT EXISTS idx_uzr_user ON user_zone_restrictions(user_id);
