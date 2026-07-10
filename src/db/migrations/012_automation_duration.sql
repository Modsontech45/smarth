-- Optional auto-off delay: when > 0 the scheduler turns the devices back off after this many seconds.
ALTER TABLE automations ADD COLUMN IF NOT EXISTS action_duration_seconds INTEGER;
