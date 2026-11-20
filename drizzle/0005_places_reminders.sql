CREATE TABLE places (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX places_owner ON places(owner,updated_at);
--> statement-breakpoint
CREATE TABLE notification_preferences (owner TEXT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Europe/Moscow', enabled INTEGER NOT NULL DEFAULT 1);
--> statement-breakpoint
CREATE TABLE reminder_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, profile_id TEXT, text TEXT NOT NULL, due_local TEXT NOT NULL, timezone TEXT NOT NULL, due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued', done INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX reminders_due ON reminder_jobs(status,done,due_at,retry_at,lease_until);
--> statement-breakpoint
CREATE INDEX reminders_owner ON reminder_jobs(owner,due_at);
--> statement-breakpoint
CREATE TABLE scheduler_state (id TEXT PRIMARY KEY, last_run INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
ALTER TABLE tg_links ADD COLUMN selected_place_id TEXT;
