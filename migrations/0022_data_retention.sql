-- Data retention (privacy policy: participant data is deleted no later than 90 days after the event).
-- See app/lib/retention.server.ts for the rules and docs in CLAUDE.md.

-- Admin pause switch ("legal hold"): 1 = never warn or purge this event until an admin switches it off again
-- (e.g. an open dispute or security incident). Default 0.
ALTER TABLE events ADD COLUMN retention_hold INTEGER NOT NULL DEFAULT 0 CHECK (retention_hold IN (0, 1));

-- One row per event and stage. 'w30' / 'w7' / 'w1' = a warning email that reached at least one admin; `detail` holds
-- {due, sent, failed, recipients}: a warning only counts while its `due` equals the event's CURRENT purge date, so moving
-- the event end invalidates warnings that announced the old date. 'purged' = the data of this event is gone: it is written
-- in the SAME batch as the deletions (every delete is gated on this row) and holds a numbers-only snapshot of what was removed.
CREATE TABLE retention_log (
  event_id INTEGER NOT NULL REFERENCES events(id),
  stage TEXT NOT NULL CHECK (stage IN ('w30', 'w7', 'w1', 'purged')),
  at TEXT NOT NULL,
  detail TEXT,
  PRIMARY KEY (event_id, stage)
);
