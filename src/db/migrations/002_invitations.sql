-- ============================================================
-- Table des invitations
-- ============================================================
CREATE TABLE invitations (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(150) NOT NULL,
  role        user_role DEFAULT 'USER',
  token       VARCHAR(128) UNIQUE NOT NULL,
  invited_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMP NOT NULL,
  accepted    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);
