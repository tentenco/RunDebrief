CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  client TEXT,
  pinned INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0,
  brain_linked INTEGER DEFAULT 0,
  last_activity_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  tool TEXT CHECK(tool IN ('claude-code','codex')),
  source_path TEXT UNIQUE,
  started_at TEXT, ended_at TEXT,
  git_branch TEXT,
  scan_offset INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  generated_at TEXT, model TEXT,
  state_summary TEXT,
  open_items TEXT,
  next_steps TEXT,
  decisions TEXT,
  key_files TEXT,
  blocked INTEGER DEFAULT 0,
  blocked_reason TEXT,
  acknowledged INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS live_status (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id),
  pid INTEGER, tool TEXT, tmux_target TEXT,
  detected_at TEXT
);

CREATE TABLE IF NOT EXISTS session_usage (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('claude-code','codex')),
  model TEXT,
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  base_input_tokens INTEGER CHECK(base_input_tokens IS NULL OR base_input_tokens >= 0),
  cache_read_input_tokens INTEGER CHECK(cache_read_input_tokens IS NULL OR cache_read_input_tokens >= 0),
  cache_creation_input_tokens INTEGER CHECK(cache_creation_input_tokens IS NULL OR cache_creation_input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK(reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  provider_total_tokens INTEGER CHECK(provider_total_tokens IS NULL OR provider_total_tokens >= 0),
  total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens >= 0),
  observed_at TEXT,
  coverage TEXT NOT NULL CHECK(coverage IN ('complete','partial')),
  covered_from_offset INTEGER NOT NULL CHECK(covered_from_offset >= 0),
  covered_to_offset INTEGER NOT NULL CHECK(covered_to_offset >= covered_from_offset)
);

CREATE TABLE IF NOT EXISTS session_usage_events (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens >= 0),
  base_input_tokens INTEGER CHECK(base_input_tokens IS NULL OR base_input_tokens >= 0),
  cache_read_input_tokens INTEGER CHECK(cache_read_input_tokens IS NULL OR cache_read_input_tokens >= 0),
  cache_creation_input_tokens INTEGER CHECK(cache_creation_input_tokens IS NULL OR cache_creation_input_tokens >= 0),
  output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens >= 0),
  reasoning_output_tokens INTEGER CHECK(reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  provider_total_tokens INTEGER CHECK(provider_total_tokens IS NULL OR provider_total_tokens >= 0),
  total_tokens INTEGER CHECK(total_tokens IS NULL OR total_tokens >= 0),
  observed_at TEXT,
  PRIMARY KEY(session_id, provider_message_id)
);
