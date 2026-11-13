CREATE TABLE mcp_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  grant_id TEXT
);
CREATE INDEX mcp_connections_owner ON mcp_connections(user_id, created_at);
