-- Panitia viewers: committee members with READ-ONLY access to aggregate dashboards (/panitia on the admin Worker).
-- Own realm, same pattern as the scanners: own tables, own cookie, never the admins table. A viewer session is
-- never recognised by the admin middleware, and the /panitia routes only ever return counts (no names, emails or phones).

-- One row per person who asked for access. status: pending (waiting for an admin), approved (may log in), rejected (denied
-- or revoked; blocks repeated requests until an admin approves or deletes the row). `expires_at` = event end + 7 days:
-- it ends access automatically and the 5-minute job deletes the row afterwards (data minimisation).
CREATE TABLE viewers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  name TEXT NOT NULL,
  section TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  last_login_at TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX viewers_status ON viewers (status, requested_at);

-- Same mechanism as admin_login_codes (6 digits, 10 minutes, 5 attempts, newest code only), separate table.
CREATE TABLE viewer_login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL CHECK (email = lower(email)),
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TEXT,
  ip TEXT
);
CREATE INDEX viewer_login_codes_email ON viewer_login_codes (email, created_at);

-- Viewer sessions: random 256-bit token in an HttpOnly cookie, only its SHA-256 here. 24 hours, absolute.
-- The session lookup joins `viewers` (approved + not expired), so revoking access ends the session at once.
CREATE TABLE viewer_sessions (
  token_hash TEXT PRIMARY KEY,
  viewer_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX viewer_sessions_viewer ON viewer_sessions (viewer_id);
CREATE INDEX viewer_sessions_expires ON viewer_sessions (expires_at);
