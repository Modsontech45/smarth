-- ============================================================
-- Energy readings (per actuator/appliance)
-- ============================================================
CREATE TABLE IF NOT EXISTS energy_readings (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  power_w     FLOAT  NOT NULL DEFAULT 0,
  current_a   FLOAT  NOT NULL DEFAULT 0,
  voltage_v   FLOAT  NOT NULL DEFAULT 220,
  energy_wh   FLOAT  NOT NULL DEFAULT 0,
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_device_time
  ON energy_readings(device_id, recorded_at DESC);

-- Add daily energy accumulator column to actuator_states
ALTER TABLE actuator_states
  ADD COLUMN IF NOT EXISTS energy_today_wh FLOAT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_energy_wh  FLOAT DEFAULT 0;

-- Alert threshold config keys (warn + crit levels, settable from the app)
INSERT INTO system_config (key, value, description) VALUES
  ('temp_crit',  '45',   'Critical temperature threshold (°C) — fires CRITICAL alert'),
  ('gas_crit',   '1500', 'Critical gas ADC threshold (0–4095) — fires CRITICAL alert')
ON CONFLICT (key) DO NOTHING;

-- Update gas_ppm_max default to match ADC scale used by MQ-2
UPDATE system_config SET value='800', description='Gas warning ADC threshold (0–4095) — fires WARNING alert'
WHERE key='gas_ppm_max' AND value='400';
