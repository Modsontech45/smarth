-- Allow a single automation rule to fire all OUTPUT devices at once.
ALTER TABLE automations ADD COLUMN IF NOT EXISTS action_all_devices BOOLEAN DEFAULT FALSE;
-- action_device_id can now be NULL when action_all_devices = TRUE.
ALTER TABLE automations ALTER COLUMN action_device_id DROP NOT NULL;
