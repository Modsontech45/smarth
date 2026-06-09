-- Add last_seen timestamp to devices for ESP32 heartbeat tracking
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP;
