-- ============================================================
-- Configuration technique des appareils
-- Permet de définir comment chaque appareil communique
-- avec l'ESP32 et quelle plage de valeurs il produit/accepte
-- ============================================================

ALTER TABLE devices
  ADD COLUMN signal_type VARCHAR(20)  DEFAULT 'digital',
  ADD COLUMN data_type   VARCHAR(20)  DEFAULT 'boolean',
  ADD COLUMN unit        VARCHAR(20),
  ADD COLUMN min_value   FLOAT        DEFAULT 0,
  ADD COLUMN max_value   FLOAT        DEFAULT 1,
  ADD COLUMN gpio_pin    INTEGER;

-- signal_type : 'digital' | 'analog' | 'pwm' | 'dht22' | 'i2c' | 'uart'
-- data_type   : 'boolean' | 'float' | 'integer' | 'percentage'
-- unit        : '°C' | '%' | 'ppm' | 'lux' | 'boolean' | 'Pa' | 'deg' | etc.
-- min_value   : valeur minimale attendue (ex. -40 pour DHT22)
-- max_value   : valeur maximale attendue (ex. 80 pour DHT22)
-- gpio_pin    : numéro de broche GPIO sur l'ESP32

COMMENT ON COLUMN devices.signal_type IS 'Protocole de lecture/écriture : digital, analog, pwm, dht22, i2c, uart';
COMMENT ON COLUMN devices.data_type   IS 'Type de la valeur : boolean, float, integer, percentage';
COMMENT ON COLUMN devices.unit        IS 'Unité de mesure : °C, %, ppm, lux, boolean, deg...';
COMMENT ON COLUMN devices.min_value   IS 'Valeur minimale attendue (pour validation et affichage)';
COMMENT ON COLUMN devices.max_value   IS 'Valeur maximale attendue';
COMMENT ON COLUMN devices.gpio_pin    IS 'Numéro de broche GPIO ESP32';
