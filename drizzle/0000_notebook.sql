CREATE TABLE profiles (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX profiles_owner ON profiles(owner);
--> statement-breakpoint
CREATE TABLE photos (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, profile_id TEXT NOT NULL, object_key TEXT NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX photos_profile ON photos(owner, profile_id);
--> statement-breakpoint
CREATE TABLE bot_connections (owner TEXT PRIMARY KEY NOT NULL, token_hash TEXT UNIQUE NOT NULL, last_seen TEXT, username TEXT);
--> statement-breakpoint
CREATE TABLE bot_updates (owner TEXT NOT NULL, update_id TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(owner, update_id));
