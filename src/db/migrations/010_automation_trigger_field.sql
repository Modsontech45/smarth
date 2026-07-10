-- Which sensor reading field to compare for SENSOR_THRESHOLD automations.
-- Values: temperature | humidity | gas_ppm | air_quality | light_lux | motion | water_leak
ALTER TABLE automations ADD COLUMN IF NOT EXISTS trigger_field VARCHAR(30);
