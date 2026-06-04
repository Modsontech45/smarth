-- ============================================================
-- Users
-- ============================================================
CREATE TYPE user_role AS ENUM ('ADMIN', 'USER', 'GUEST');

CREATE TABLE users (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(100) NOT NULL,
  email                   VARCHAR(150) UNIQUE NOT NULL,
  password                VARCHAR(255),                      -- NULL when using Google-only auth
  role                    user_role DEFAULT 'USER',
  api_key                 VARCHAR(64) UNIQUE NOT NULL,

  -- Email verification
  email_verified          BOOLEAN DEFAULT FALSE,
  email_verify_token      VARCHAR(128),
  email_verify_expires    TIMESTAMP,

  -- Password reset
  reset_password_token    VARCHAR(128),
  reset_password_expires  TIMESTAMP,

  -- Google OAuth
  google_id               VARCHAR(100) UNIQUE,

  created_at              TIMESTAMP DEFAULT NOW(),
  updated_at              TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Devices
-- ============================================================
CREATE TYPE device_type   AS ENUM ('INPUT', 'OUTPUT');
CREATE TYPE device_status AS ENUM ('ONLINE', 'OFFLINE');

CREATE TABLE devices (
  id          SERIAL PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  device_key  VARCHAR(64) UNIQUE NOT NULL,
  type        device_type NOT NULL,
  status      device_status DEFAULT 'OFFLINE',
  zone        VARCHAR(50) DEFAULT 'main',
  description TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Sensor readings
-- ============================================================
CREATE TABLE sensor_readings (
  id           SERIAL PRIMARY KEY,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  temperature  FLOAT,
  humidity     FLOAT,
  gas_ppm      FLOAT,
  air_quality  FLOAT,
  motion       BOOLEAN DEFAULT FALSE,
  light_lux    FLOAT,
  water_leak   BOOLEAN DEFAULT FALSE,
  recorded_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Actuator states
-- ============================================================
CREATE TABLE actuator_states (
  id           SERIAL PRIMARY KEY,
  device_id    INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  state        BOOLEAN DEFAULT FALSE,
  triggered_by VARCHAR(20) DEFAULT 'manual',
  updated_at   TIMESTAMP DEFAULT NOW()
);

INSERT INTO actuator_states (device_id, state)
  SELECT id, false FROM devices WHERE type = 'OUTPUT';

-- ============================================================
-- Alerts
-- ============================================================
CREATE TYPE alert_type     AS ENUM ('FIRE', 'GAS_LEAK', 'INTRUSION', 'WATER_LEAK', 'HIGH_TEMP', 'POWER_CUT');
CREATE TYPE alert_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE alerts (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  type        alert_type NOT NULL,
  zone        VARCHAR(50),
  severity    alert_severity DEFAULT 'WARNING',
  message     TEXT,
  resolved    BOOLEAN DEFAULT FALSE,
  resolved_by INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Automations
-- ============================================================
CREATE TYPE trigger_type      AS ENUM ('SENSOR_THRESHOLD', 'TIME_BASED', 'DEVICE_STATUS');
CREATE TYPE trigger_condition AS ENUM ('GT', 'LT', 'EQ', 'GTE', 'LTE');

CREATE TABLE automations (
  id                 SERIAL PRIMARY KEY,
  owner_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               VARCHAR(100) NOT NULL,
  description        TEXT,
  trigger_type       trigger_type NOT NULL,
  trigger_device_id  INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  trigger_condition  trigger_condition,
  trigger_value      FLOAT,
  trigger_time       TIME,
  action_device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  action_state       BOOLEAN NOT NULL,
  enabled            BOOLEAN DEFAULT TRUE,
  last_triggered_at  TIMESTAMP,
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- System config
-- ============================================================
CREATE TABLE system_config (
  id          SERIAL PRIMARY KEY,
  key         VARCHAR(100) UNIQUE NOT NULL,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TIMESTAMP DEFAULT NOW()
);

INSERT INTO system_config (key, value, description) VALUES
  ('temp_max',        '35',   'Maximum temperature threshold (°C)'),
  ('gas_ppm_max',     '400',  'Maximum gas concentration (ppm)'),
  ('light_threshold', '100',  'Light level to trigger automatic lighting (lux)'),
  ('sensor_interval', '300',  'ESP32 sensor read interval (seconds)'),
  ('auto_mode',       'true', 'Enable intelligent automation rules');
