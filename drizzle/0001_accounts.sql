CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX sessions_account ON sessions(account_id);
--> statement-breakpoint
CREATE TABLE auth_limits (key TEXT PRIMARY KEY NOT NULL, window INTEGER NOT NULL, attempts INTEGER NOT NULL);
