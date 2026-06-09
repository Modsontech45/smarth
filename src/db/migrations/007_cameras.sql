-- ============================================================
-- Cameras — third-party IP / stream cameras per user
-- ============================================================
CREATE TABLE IF NOT EXISTS cameras (
  id           SERIAL PRIMARY KEY,
  owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  url          TEXT NOT NULL,
  stream_type  VARCHAR(20) NOT NULL DEFAULT 'mjpeg',  -- mjpeg | snapshot | hls | iframe
  zone         VARCHAR(50)  DEFAULT 'main',
  refresh_ms   INTEGER      DEFAULT 1000,              -- snapshot refresh interval
  enabled      BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMP    DEFAULT NOW(),
  updated_at   TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cameras_owner ON cameras(owner_id);
