-- ============================================================
-- Historique des changements d'état des actionneurs
-- Chaque ON/OFF est loggé pour calculer les durées
-- ============================================================
CREATE TABLE actuator_state_history (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  state       BOOLEAN NOT NULL,
  changed_by  VARCHAR(20) DEFAULT 'manual',
  changed_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_actuator_history_device_date
  ON actuator_state_history (device_id, changed_at DESC);

CREATE INDEX idx_sensor_readings_device_date
  ON sensor_readings (device_id, recorded_at DESC);
