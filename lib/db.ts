import Database from "better-sqlite3";
import path from "path";
import { getDataDir } from "./paths";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const file = path.join(getDataDir(), "app.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      system_prompt TEXT DEFAULT '',
      model_override TEXT DEFAULT NULL,
      tools TEXT DEFAULT '[]',            -- JSON array: github|gitlab|filesystem|memory|delegate|shell|database|redis|env|monitoring
      skill_ids TEXT DEFAULT '[]',        -- JSON array of skill ids
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      title TEXT DEFAULT 'New conversation',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,                 -- user|assistant|system|tool
      content TEXT NOT NULL,
      meta TEXT DEFAULT NULL,             -- JSON: tool calls etc.
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_by_agent INTEGER DEFAULT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      agent_name TEXT,
      action TEXT NOT NULL,               -- read|write|delete
      key TEXT NOT NULL,
      value_preview TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      content TEXT NOT NULL,              -- instructions injected into the system prompt
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_id INTEGER DEFAULT NULL REFERENCES agents(id) ON DELETE CASCADE, -- NULL = global (all agents)
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    /* ---------- Agent Manager (supervisor) ---------- */
    CREATE TABLE IF NOT EXISTS manager_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_request TEXT NOT NULL,
      agent_ids TEXT NOT NULL DEFAULT '[]',       -- JSON array of agent ids the manager may use ([] = all)
      model TEXT DEFAULT NULL,                     -- AI model for manager reasoning + workers ([] = each agent's default)
      status TEXT NOT NULL CHECK (status IN (
        'clarifying','planning','in_progress','reviewing','revising','reporting','done','failed'
      )),
      clarification_question TEXT DEFAULT NULL,   -- pertanyaan terbuka ke user saat status=clarifying
      clarification_rounds INTEGER NOT NULL DEFAULT 0,
      assumptions TEXT DEFAULT NULL,              -- asumsi yg diambil kalau klarifikasi di-skip
      report TEXT DEFAULT NULL,                   -- markdown laporan akhir
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES manager_tasks(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      agent_name TEXT NOT NULL DEFAULT '',        -- snapshot nama agent utk laporan
      subtask_description TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,         -- urutan eksekusi (sequential)
      status TEXT NOT NULL CHECK (status IN (
        'pending','in_progress','submitted','needs_revision','approved','failed'
      )),
      attempt_count INTEGER NOT NULL DEFAULT 0,    -- total dispatch (completion loop)
      revision_count INTEGER NOT NULL DEFAULT 0,   -- berapa kali review menolak
      last_plan TEXT,                              -- rencana agent (fase plan) sebelum act
      last_result TEXT,
      last_review_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES manager_tasks(id) ON DELETE CASCADE,
      assignment_id INTEGER REFERENCES task_assignments(id),
      event_type TEXT NOT NULL,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_task ON task_assignments(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);

    /* ---------- multi-connection registry (github/gitlab/database/redis/monitoring) ---------- */
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('github','gitlab','database','redis','grafana','prometheus','loki','tavily','ai')),
      name TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',   -- JSON non-secret fields (host, apiUrl, engine, …)
      is_active INTEGER NOT NULL DEFAULT 0, -- exactly one active per kind
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---------- workspace sessions ---------- */
    CREATE TABLE IF NOT EXISTS workspace_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New session',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_session_agents (
      session_id INTEGER NOT NULL REFERENCES workspace_sessions(id) ON DELETE CASCADE,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL,
      PRIMARY KEY (session_id, agent_id)
    );

    /* ---------- approval allowlist ---------- */
    /* actions the user chose "Always allow" for — they skip the approval card */
    CREATE TABLE IF NOT EXISTS approval_allowlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,                         -- shell | database | redis | env
      detail TEXT NOT NULL,                       -- exact command / SQL / detail string
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(kind, detail)
    );

    /* ---------- cron jobs ---------- */
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL,                     -- cron expression: "0 9 * * *"
      prompt TEXT NOT NULL,                       -- task to run
      enabled INTEGER NOT NULL DEFAULT 1,         -- 0=paused, 1=active
      last_run TEXT DEFAULT NULL,                 -- timestamp of last execution
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // light migrations for older DBs: agent avatar + color
  const cols = (d.prepare("PRAGMA table_info(agents)").all() as any[]).map((c) => c.name);
  if (!cols.includes("avatar")) d.exec("ALTER TABLE agents ADD COLUMN avatar TEXT DEFAULT '🤖'");
  if (!cols.includes("color")) d.exec("ALTER TABLE agents ADD COLUMN color TEXT DEFAULT '#c15f3c'");
  if (!cols.includes("shell_auto")) d.exec("ALTER TABLE agents ADD COLUMN shell_auto INTEGER DEFAULT 0");
  // working_dir: per-agent folder override for shell & filesystem tools
  if (!cols.includes("working_dir")) d.exec("ALTER TABLE agents ADD COLUMN working_dir TEXT DEFAULT NULL");
  // category: free-form label to group agents (e.g. "coding", "research") so the
  // workspace can pull in a whole category at once instead of one agent at a time.
  if (!cols.includes("category")) d.exec("ALTER TABLE agents ADD COLUMN category TEXT DEFAULT ''");

  // manager: last_plan column added after the initial manager tables shipped
  const acols = (d.prepare("PRAGMA table_info(task_assignments)").all() as any[]).map((c) => c.name);
  if (!acols.includes("last_plan")) d.exec("ALTER TABLE task_assignments ADD COLUMN last_plan TEXT DEFAULT NULL");

  const tcols = (d.prepare("PRAGMA table_info(manager_tasks)").all() as any[]).map((c) => c.name);
  if (!tcols.includes("agent_ids")) d.exec("ALTER TABLE manager_tasks ADD COLUMN agent_ids TEXT NOT NULL DEFAULT '[]'");
  if (!tcols.includes("model")) d.exec("ALTER TABLE manager_tasks ADD COLUMN model TEXT DEFAULT NULL");
  if (!tcols.includes("clarification_options")) d.exec("ALTER TABLE manager_tasks ADD COLUMN clarification_options TEXT DEFAULT NULL");
  // attachments (JSON array of {name,kind,mediaType,data}) for file/photo uploads
  if (!tcols.includes("attachments")) d.exec("ALTER TABLE manager_tasks ADD COLUMN attachments TEXT DEFAULT NULL");

  // connections: older DBs have a CHECK that only allows the original four kinds.
  // SQLite cannot alter a CHECK, so rebuild the table once when the monitoring kinds are missing.
  const connSql = String(
    (d.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='connections'").get() as any)?.sql ?? ""
  );
  if (connSql && !connSql.includes("'ai'")) {
    d.exec(`
      BEGIN;
      ALTER TABLE connections RENAME TO connections_old;
      CREATE TABLE connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('github','gitlab','database','redis','grafana','prometheus','loki','tavily','ai')),
        name TEXT NOT NULL,
        config TEXT NOT NULL DEFAULT '{}',
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO connections(id,kind,name,config,is_active,created_at)
        SELECT id,kind,name,config,is_active,created_at FROM connections_old;
      DROP TABLE connections_old;
      COMMIT;
    `);
  }
}

/* ---------- app meta ---------- */
export function getMeta(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM app_meta WHERE key=?").get(key) as any;
  return row?.value ?? null;
}
export function setMeta(key: string, value: string) {
  getDb()
    .prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, value);
}

/* ---------- seed 3 example agents (onboarding step 4) ---------- */
export function seedExampleAgents(): { id: number; name: string }[] {
  const d = getDb();
  const count = (d.prepare("SELECT COUNT(*) c FROM agents").get() as any).c;
  if (count > 0) {
    return d.prepare("SELECT id,name FROM agents ORDER BY id LIMIT 3").all() as any;
  }
  const ins = d.prepare(
    "INSERT INTO agents(name,description,system_prompt,tools,skill_ids,avatar,color) VALUES(?,?,?,?,?,?,?)"
  );
  const seeds = [
    {
      name: "Repo Agent",
      description: "Explores and answers questions about GitHub/GitLab repos.",
      prompt:
        "You are Repo Agent. Use the GitHub/GitLab tools to read repositories, issues, and merge requests. Answer concisely and include file/URL references when relevant.",
      tools: ["github", "gitlab", "memory"],
      avatar: "🔍",
      color: "#2b6cb0",
    },
    {
      name: "FS Agent",
      description: "Reads and writes files in the allowed folders.",
      prompt:
        "You are FS Agent. Use the filesystem tools to read/write files ONLY inside the folders the user allowed. Always confirm before overwriting a file.",
      tools: ["filesystem", "memory"],
      avatar: "📁",
      color: "#2e7d4f",
    },
    {
      name: "SQL Agent",
      description: "Helps write and explain SQL queries.",
      prompt:
        "You are SQL Agent. Help the user write, optimize, and explain SQL queries. You may delegate file-reading tasks to FS Agent.",
      tools: ["delegate", "memory"],
      avatar: "💾",
      color: "#b7791f",
    },
  ];
  const out: { id: number; name: string }[] = [];
  for (const s of seeds) {
    const r = ins.run(s.name, s.description, s.prompt, JSON.stringify(s.tools), "[]", s.avatar, s.color);
    out.push({ id: Number(r.lastInsertRowid), name: s.name });
  }
  return out;
}
