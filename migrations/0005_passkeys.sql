-- Migration number: 0005 	 Phase 3 (part A): passkeys (WebAuthn) and their one-time challenges.
-- Keep in sync with src/db/schema.ts.

CREATE TABLE passkeys (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  TEXT    NOT NULL UNIQUE,   -- base64url
  public_key     TEXT    NOT NULL,          -- base64url COSE public key
  counter        INTEGER NOT NULL DEFAULT 0,
  transports     TEXT    NOT NULL DEFAULT '[]', -- JSON array
  name           TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at   TEXT
);
CREATE INDEX passkeys_user_id_idx ON passkeys(user_id);

-- Server-side WebAuthn challenges: 5-minute TTL, deleted when used (single use).
CREATE TABLE webauthn_challenges (
  challenge   TEXT    PRIMARY KEY,          -- base64url, as sent to the browser
  kind        TEXT    NOT NULL CHECK (kind IN ('register', 'login')),
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE, -- set for 'register'
  expires_at  INTEGER NOT NULL              -- epoch ms
);
CREATE INDEX webauthn_challenges_expires_idx ON webauthn_challenges(expires_at);
