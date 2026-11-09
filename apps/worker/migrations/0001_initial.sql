PRAGMA foreign_keys = ON;
CREATE TABLE projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE packages (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, canonical_id TEXT NOT NULL, display_name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '', latest_stable TEXT, latest_prerelease TEXT,
 archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_success TEXT,
 UNIQUE(provider,canonical_id)
);
CREATE TABLE project_packages (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
 PRIMARY KEY(project_id,package_id)
);
CREATE INDEX associations_package ON project_packages(package_id);
CREATE TABLE collection_jobs (
 package_id TEXT PRIMARY KEY REFERENCES packages(id) ON DELETE CASCADE,
 next_attempt TEXT NOT NULL, lease_token TEXT, lease_until TEXT, failures INTEGER NOT NULL DEFAULT 0,
 last_attempt TEXT, last_error TEXT, manual_requested_at TEXT, status TEXT NOT NULL DEFAULT 'queued'
);
CREATE INDEX due_jobs ON collection_jobs(next_attempt,lease_until);
CREATE TABLE package_versions (
 package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
 version TEXT NOT NULL, prerelease INTEGER NOT NULL, first_seen TEXT NOT NULL,
 PRIMARY KEY(package_id,version)
);
CREATE TABLE sync_attempts (
 id TEXT PRIMARY KEY, package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
 started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, error TEXT
);
CREATE INDEX attempts_time ON sync_attempts(started_at);
CREATE TABLE observations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
 metric TEXT NOT NULL, scope TEXT NOT NULL, version TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL CHECK(kind IN ('cumulative','interval')), value INTEGER,
 observed_at TEXT NOT NULL, interval_start TEXT, interval_end TEXT, availability TEXT NOT NULL,
 quality TEXT NOT NULL, collection_id TEXT NOT NULL,
 UNIQUE(package_id,metric,scope,version,collection_id)
);
CREATE INDEX observations_package_time ON observations(package_id,observed_at);
CREATE INDEX observations_series ON observations(package_id,metric,scope,version,observed_at);
CREATE TABLE annotations (
 id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 package_id TEXT REFERENCES packages(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('release','campaign')), title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
 occurred_at TEXT NOT NULL, automatic INTEGER NOT NULL DEFAULT 0,
 CHECK ((project_id IS NULL) != (package_id IS NULL))
);
CREATE INDEX annotations_project ON annotations(project_id,occurred_at);
CREATE INDEX annotations_package ON annotations(package_id,occurred_at);
