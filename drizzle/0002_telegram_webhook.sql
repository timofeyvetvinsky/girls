CREATE TABLE tg_links (owner TEXT PRIMARY KEY NOT NULL, telegram_id TEXT UNIQUE NOT NULL, selected_id TEXT, delete_id TEXT, delete_until INTEGER);
--> statement-breakpoint
CREATE TABLE tg_pairings (code_hash TEXT PRIMARY KEY NOT NULL, owner TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE tg_deliveries (update_id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0);
