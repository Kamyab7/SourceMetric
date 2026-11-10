CREATE TABLE repositories (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'github', github_id TEXT NOT NULL UNIQUE,
 full_name TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', private INTEGER NOT NULL DEFAULT 0,
 archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_success TEXT, traffic_success TEXT, traffic_error TEXT
);
CREATE TABLE project_repositories (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
 PRIMARY KEY(project_id,repository_id)
);
CREATE INDEX repository_associations ON project_repositories(repository_id);
CREATE TABLE repository_jobs (
 repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
 next_attempt TEXT NOT NULL, lease_token TEXT, lease_until TEXT, failures INTEGER NOT NULL DEFAULT 0,
 last_attempt TEXT, last_error TEXT, manual_requested_at TEXT, status TEXT NOT NULL DEFAULT 'queued'
);
CREATE INDEX repository_due ON repository_jobs(next_attempt,lease_until);
CREATE TABLE repository_attempts (
 id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
 started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, error TEXT
);
CREATE INDEX repository_attempt_time ON repository_attempts(started_at,id);
CREATE TABLE repository_snapshots (
 repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
 observed_at TEXT NOT NULL, stars INTEGER NOT NULL CHECK(stars>=0), forks INTEGER NOT NULL CHECK(forks>=0),
 PRIMARY KEY(repository_id,observed_at)
);
CREATE TABLE repository_clones (
 repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
 day TEXT NOT NULL, count INTEGER NOT NULL CHECK(count>=0), uniques INTEGER NOT NULL CHECK(uniques>=0),
 observed_at TEXT NOT NULL, provisional INTEGER NOT NULL,
 PRIMARY KEY(repository_id,day)
);
