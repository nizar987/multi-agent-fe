import Database from "better-sqlite3";
import path from "path";
import { getDataDir } from "./paths";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const file = path.join(getDataDir(), "app.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  // 🟡 MINOR: SQLite does NOT enforce FK constraints by default.
  // Without this, ON DELETE CASCADE and FK integrity checks are silently ignored.
  db.pragma("foreign_keys = ON");
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
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
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
      assignment_id INTEGER REFERENCES task_assignments(id) ON DELETE SET NULL,
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

    /* ---------- tickets (Tasks page → executed by the Agent Manager) ---------- */
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','executing','done','failed')),
      manager_task_id INTEGER DEFAULT NULL REFERENCES manager_tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---------- run progress todos (AI-maintained checklist per conversation) ---------- */
    CREATE TABLE IF NOT EXISTS run_todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done')),
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_run_todos_conv ON run_todos(conversation_id);

    /* ---------- work journal (auto-memory: what each agent worked on & where) ---------- */
    CREATE TABLE IF NOT EXISTS work_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      conversation_id INTEGER DEFAULT NULL,
      request TEXT NOT NULL,
      working_dir TEXT NOT NULL DEFAULT '',
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_work_journal_agent ON work_journal(agent_id, id);

    /* ---------- team board (notes shared by agents running in parallel) ---------- */
    CREATE TABLE IF NOT EXISTS board_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_key TEXT NOT NULL,                     -- ws:<sessionId> | task:<taskId>
      agent_id INTEGER DEFAULT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_board_notes_key ON board_notes(board_key, id);

    /* ---------- agent runs (heartbeat + auto-resume, see lib/run-registry.ts) ---------- */
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      conversation_id INTEGER NOT NULL,
      surface TEXT NOT NULL DEFAULT 'chat',        -- chat | workspace
      mode TEXT NOT NULL DEFAULT 'approval',
      working_dir TEXT DEFAULT NULL,
      board_key TEXT DEFAULT NULL,
      model_override TEXT DEFAULT NULL,
      -- running | done | incomplete | failed | error | interrupted | resumed | superseded
      status TEXT NOT NULL DEFAULT 'running',
      resume_of INTEGER DEFAULT NULL,
      resume_count INTEGER NOT NULL DEFAULT 0,
      error TEXT DEFAULT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_beat_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_conv ON agent_runs(conversation_id, id);

    /* ---------- token usage log ---------- */
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      provider TEXT NOT NULL DEFAULT '',          -- anthropic | openai | gemini
      model TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'other',       -- agent | workspace | manager | vision | test | other
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_at ON token_usage(at);
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
  // conversation_id: per-assignment conversation so worker agents have persistent
  // history across retry attempts and revisions within the same assignment.
  if (!acols.includes("conversation_id")) d.exec("ALTER TABLE task_assignments ADD COLUMN conversation_id INTEGER DEFAULT NULL");

  const tcols = (d.prepare("PRAGMA table_info(manager_tasks)").all() as any[]).map((c) => c.name);
  if (!tcols.includes("agent_ids")) d.exec("ALTER TABLE manager_tasks ADD COLUMN agent_ids TEXT NOT NULL DEFAULT '[]'");
  if (!tcols.includes("model")) d.exec("ALTER TABLE manager_tasks ADD COLUMN model TEXT DEFAULT NULL");
  if (!tcols.includes("clarification_options")) d.exec("ALTER TABLE manager_tasks ADD COLUMN clarification_options TEXT DEFAULT NULL");
  // attachments (JSON array of {name,kind,mediaType,data}) for file/photo uploads
  if (!tcols.includes("attachments")) d.exec("ALTER TABLE manager_tasks ADD COLUMN attachments TEXT DEFAULT NULL");

  // manager: the original task_assignments/task_events shipped with plain
  // REFERENCES (= ON DELETE NO ACTION). Harmless while SQLite ignored foreign
  // keys, but now that `foreign_keys = ON` is enforced it makes "delete agent"
  // fail for every agent that ever ran a manager task. SQLite cannot alter a
  // foreign key, so rebuild both tables once:
  //   task_assignments.agent_id      → ON DELETE CASCADE (drop the agent's rows)
  //   task_events.assignment_id      → ON DELETE SET NULL (keep the event log)
  const assignFk = d.prepare("PRAGMA foreign_key_list(task_assignments)").all() as Array<{
    table: string;
    from: string;
    on_delete: string;
  }>;
  const agentFk = assignFk.find((f) => f.from === "agent_id");
  if (agentFk && agentFk.on_delete !== "CASCADE") {
    d.pragma("foreign_keys = OFF"); // required for a table rebuild
    try {
      d.exec(`
        BEGIN;
        CREATE TABLE task_assignments_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL REFERENCES manager_tasks(id) ON DELETE CASCADE,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          agent_name TEXT NOT NULL DEFAULT '',
          subtask_description TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK (status IN (
            'pending','in_progress','submitted','needs_revision','approved','failed'
          )),
          attempt_count INTEGER NOT NULL DEFAULT 0,
          revision_count INTEGER NOT NULL DEFAULT 0,
          last_plan TEXT,
          last_result TEXT,
          last_review_notes TEXT,
          conversation_id INTEGER DEFAULT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        /* rows whose task or agent no longer exists were already broken — drop them */
        INSERT INTO task_assignments_new
          SELECT id,task_id,agent_id,agent_name,subtask_description,position,status,
                 attempt_count,revision_count,last_plan,last_result,last_review_notes,
                 conversation_id,created_at,updated_at
          FROM task_assignments
          WHERE task_id IN (SELECT id FROM manager_tasks)
            AND agent_id IN (SELECT id FROM agents);
        DROP TABLE task_assignments;
        ALTER TABLE task_assignments_new RENAME TO task_assignments;

        CREATE TABLE task_events_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL REFERENCES manager_tasks(id) ON DELETE CASCADE,
          assignment_id INTEGER REFERENCES task_assignments(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          content TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO task_events_new
          SELECT id,task_id,
                 CASE WHEN assignment_id IN (SELECT id FROM task_assignments) THEN assignment_id END,
                 event_type,content,created_at
          FROM task_events
          WHERE task_id IN (SELECT id FROM manager_tasks);
        DROP TABLE task_events;
        ALTER TABLE task_events_new RENAME TO task_events;

        CREATE INDEX IF NOT EXISTS idx_assignments_task ON task_assignments(task_id);
        CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);
        COMMIT;
      `);
    } finally {
      d.pragma("foreign_keys = ON");
    }
  }

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

  // token_usage: prompt-cache counters (subsets of input_tokens).
  const ucols = (d.prepare("PRAGMA table_info(token_usage)").all() as any[]).map((c) => c.name);
  if (!ucols.includes("cache_read_tokens")) d.exec("ALTER TABLE token_usage ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0");
  if (!ucols.includes("cache_write_tokens")) d.exec("ALTER TABLE token_usage ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0");

  // created_by_agent: rows an agent wrote for itself via the self-learning tools
  // (NULL = written by the user). Agents may only edit/delete their own rows.
  const kcols = (d.prepare("PRAGMA table_info(knowledge)").all() as any[]).map((c) => c.name);
  if (!kcols.includes("created_by_agent")) d.exec("ALTER TABLE knowledge ADD COLUMN created_by_agent INTEGER DEFAULT NULL");
  const scols = (d.prepare("PRAGMA table_info(skills)").all() as any[]).map((c) => c.name);
  if (!scols.includes("created_by_agent")) d.exec("ALTER TABLE skills ADD COLUMN created_by_agent INTEGER DEFAULT NULL");

  // Text columns that were written as BLOBs (e.g. by an external script binding
  // a Buffer) come back from better-sqlite3 as Buffers, serialize to
  // {type:"Buffer",data:[…]} and crash any page that renders them. Normalize once.
  d.exec(`
    UPDATE knowledge SET title=CAST(title AS TEXT) WHERE typeof(title)='blob';
    UPDATE knowledge SET content=CAST(content AS TEXT) WHERE typeof(content)='blob';
    UPDATE skills SET name=CAST(name AS TEXT) WHERE typeof(name)='blob';
    UPDATE skills SET description=CAST(description AS TEXT) WHERE typeof(description)='blob';
    UPDATE skills SET content=CAST(content AS TEXT) WHERE typeof(content)='blob';
    UPDATE memories SET value=CAST(value AS TEXT) WHERE typeof(value)='blob';
  `);
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
