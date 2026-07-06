-- ============================================================
-- Subscriptions / plan management
-- ============================================================
CREATE TYPE plan_tier AS ENUM ('FREE', 'BASIC', 'PRO');

ALTER TABLE users
  ADD COLUMN plan           plan_tier DEFAULT 'FREE',
  ADD COLUMN plan_expires_at TIMESTAMP;

CREATE TABLE subscription_history (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan         plan_tier NOT NULL,
  billing      VARCHAR(10) DEFAULT 'monthly',  -- 'monthly' | 'annual'
  activated_at TIMESTAMP DEFAULT NOW(),
  expires_at   TIMESTAMP
);
