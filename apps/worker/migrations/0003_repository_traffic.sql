CREATE TABLE repository_views (
 repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
 day TEXT NOT NULL, count INTEGER NOT NULL CHECK(count>=0), uniques INTEGER NOT NULL CHECK(uniques>=0),
 observed_at TEXT NOT NULL, provisional INTEGER NOT NULL,
 PRIMARY KEY(repository_id,day)
);
CREATE TABLE repository_traffic_snapshots (
 id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
 metric TEXT NOT NULL CHECK(metric IN ('views','paths','referrers')), observed_at TEXT NOT NULL,
 window_days INTEGER NOT NULL DEFAULT 14 CHECK(window_days=14), count INTEGER, uniques INTEGER,
 items TEXT NOT NULL DEFAULT '[]', UNIQUE(repository_id,metric,observed_at)
);
CREATE INDEX traffic_snapshot_history ON repository_traffic_snapshots(repository_id,metric,observed_at DESC);
CREATE TABLE repository_traffic_status (
 repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
 metric TEXT NOT NULL CHECK(metric IN ('clones','views','paths','referrers')),
 last_attempt TEXT NOT NULL, last_success TEXT, status TEXT NOT NULL, error TEXT,
 PRIMARY KEY(repository_id,metric)
);
-- Existing clone fields remain clone-specific. Do not invent successes for new endpoints.
INSERT INTO repository_traffic_status(repository_id,metric,last_attempt,last_success,status,error)
 SELECT r.id,'clones',j.last_attempt,r.traffic_success,
 CASE WHEN r.traffic_error IS NOT NULL THEN 'failed' WHEN r.traffic_success IS NOT NULL THEN 'success' ELSE 'unknown' END,r.traffic_error
 FROM repositories r JOIN repository_jobs j ON j.repository_id=r.id WHERE j.last_attempt IS NOT NULL;
