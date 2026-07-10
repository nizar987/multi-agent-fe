# Agent Platform Desktop

A local-first, multi-agent AI platform built with Electron + Next.js. Create specialized AI agents with custom tools, connect them to any Anthropic / OpenAI / Gemini-compatible provider, let them collaborate through a Manager/Supervisor system, and run them entirely on your machine — no cloud backend required.

---

## ✨ Features

### 🤖 Multi-Agent System

- Create unlimited agents with custom names, avatars, colors, system prompts, and tool configurations
- Group agents into **categories** (e.g. "coding", "research") so the workspace can pull in a whole category at once instead of one agent at a time
- Each agent has its own conversation history, model override, and optional working directory
- Per-agent model override support

### 🔌 Multi-Provider AI

- Speaks three wire formats — **Anthropic Messages API**, **OpenAI Chat Completions**, and **Google Gemini** — normalized internally so agents, tools, and streaming work identically regardless of provider
- Save multiple AI connections at once and switch the active one, or let per-model routing pick the right connection automatically
- Built-in **provider preset catalog** (Connections → AI Provider → Provider preset): Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, xAI (Grok), Mistral, Moonshot/Kimi, Z.AI (GLM), Together AI, Cerebras, Fireworks, NVIDIA NIM, SiliconFlow, Nebius, Hyperbolic, Chutes, Venice, and self-hosted routers (9router) — pick one and the base URL, wire format, and starter models are filled in for you
- Works with any OpenAI-compatible gateway or self-hosted router by pointing the base URL manually
- Vision passthrough test and a plain connection test before you rely on a provider

### 🧩 Agent Manager (Supervisor)

- A supervisor layer that orchestrates multiple agents for complex tasks
- Clarification flow — asks the user when the request is ambiguous
- Two-phase dispatch: **PLAN** mode (read-only, drafts approach) → **ACT** mode (executes)
- Automatic quality review with revision requests
- Live per-assignment detail view: drafted plan, event log, final result, and review notes
- Structured final reports
- Bounded guards (max clarification rounds, max attempts, max revisions) to prevent infinite loops

### 🤝 Workspace

- Two modes: **Parallel** (send one message to several agents at once, each with its own thread) and **Manager** (delegate a task to a team, supervised end-to-end)
- Add agents individually or a whole category at once
- Stop an individual agent's run mid-stream without cancelling the others
- Session history with autosave, retry, and reply-to-selection
- Live preview panel for links, files, and generated content

### 📊 Usage & Context Limit

- **Usage** page tracks token consumption (input/output, per model, per day, and per call source — agent / manager / vision / test) across every AI call, on any connected provider
- Optional **context limit**: cap the tokens sent per request and older turns are trimmed automatically, keeping the most recent conversation and never breaking a tool call/result pair

### 🛠️ Tools & MCP Integration

Agents can be equipped with the following tools:

| Tool | Description |
|------|-------------|
| **GitHub** | Repository exploration, issue/PR management (via REST API) |
| **GitLab** | Full MCP integration via bundled `@modelcontextprotocol/server-gitlab` |
| **Filesystem** | Read/write files via MCP (`@modelcontextprotocol/server-filesystem`) |
| **Shell** | Execute shell commands, locked to the agent's working directory (with approval) |
| **Database** | SQL queries (PostgreSQL, MySQL) — writes gated behind approval |
| **Redis** | Key-value store operations — writes gated behind approval |
| **Tavily web** | Search / extract / crawl / map the web via the Tavily API |
| **Monitoring** | Query Grafana (via `mcp-grafana`), Prometheus, and Loki |
| **Memory** | Shared cross-agent memory (read/write/delete with audit log) |
| **Delegate** | Agent-to-agent delegation (up to configurable depth) |
| **Vision** | Read attached images/screenshots via a vision-capable model |
| **Environment** | Read `.env` files (gated behind approval — contents go to the model) |

### ✅ Approvals & Permissions

- Every risky action (shell commands, SQL/Redis writes, `.env` reads) pauses for an approval card in chat: **Always allow**, **Once**, or **Deny**
- Execution mode is picked per chat: **Approval** (ask each time), **Act** (run immediately), or **Plan** (draft only, nothing executed)
- The **Permissions** page manages the "always allow" list built up from past approvals

### 📚 Knowledge Base

- Upload documents and context that agents can reference
- Global knowledge (available to all agents) or per-agent knowledge

### ✦ Skills

- Reusable instruction sets injected into agent system prompts
- Create once, apply to multiple agents

### ▤ Shared Memory

- Cross-agent key-value store
- Full audit trail (who read/wrote/deleted what and when)
- Agents can collaborate by reading and writing shared state

### ⏰ Schedules (Cron Jobs)

- Schedule recurring agent tasks with cron expressions
- Enable/disable jobs, track last run time

### 📎 Attachments

- Upload images and PDF documents in chat
- PDF parsing with Anthropic document API support; images handled via the vision tool on any provider

### 📈 Monitoring

- Connect Grafana, Prometheus, and Loki as named connections and query them from chat or via agent tools

### 📋 Logs

- View activity logs for debugging and monitoring

### ⚙️ Settings & Connections

- AI provider configuration with the provider preset catalog described above
- Multi-connection manager for AI, GitHub, GitLab, Database, Redis, Grafana, Prometheus, and Loki — save several, mark one active per kind, and test each independently
- Filesystem allowed directories (native folder picker)
- First-run onboarding wizard

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Electron Main Process                    │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Next.js Standalone Server (localhost, random port)   │
│  │                                                    │    │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │    │
│  │  │ Pages    │  │ API      │  │ MCP Subprocess │  │    │
│  │  │ (React)  │  │ Routes   │  │ (stdio)        │  │    │
│  │  └──────────┘  └──────────┘  └───────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  ┌──────────────┐  ┌────────────────────────────────┐   │
│  │ Config       │  │ SQLite (better-sqlite3)         │   │
│  │ Service      │  │ - agents, conversations          │   │
│  │ (safeStorage)│  │ - memories, skills, knowledge    │   │
│  │              │  │ - connections, cron_jobs         │   │
│  │              │  │ - manager_tasks, token_usage etc.│   │
│  └──────────────┘  └────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         │ loadURL(http://localhost:<port>)
         ▼
┌─────────────────────────────────────────────────────────┐
│              Electron Renderer (BrowserWindow)            │
│              Next.js UI (React components)                │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Electron 31 |
| Frontend | Next.js 14 + React 18 |
| Database | SQLite via better-sqlite3 (WAL mode) |
| AI | Anthropic Messages API, OpenAI Chat Completions, Google Gemini — normalized to one internal shape |
| Tool Protocol | Model Context Protocol (MCP) SDK |
| External Connections | PostgreSQL (pg), MySQL (mysql2), Redis (ioredis), Tavily, Grafana/Prometheus/Loki |
| Scheduling | node-cron |
| Markdown | react-markdown + remark-gfm |
| Charts | Recharts |
| Packaging | electron-builder |

### Data Flow

1. User sends message → Next.js API route (`/api/chat` or `/api/workspace/chat`)
2. `lib/agent-runtime.ts` builds the agent loop (system prompt + tools + memory), optionally trimming history to the configured context-token budget
3. AI call via `lib/ai.ts`, which resolves the active (or per-model-routed) connection, speaks that provider's wire format, and normalizes the response
4. Tool calls dispatched: MCP servers (filesystem, gitlab, grafana), built-in tools (github, shell, db, redis, tavily, monitoring, memory, vision, delegate)
5. Results streamed back to the UI; token usage for the call is logged for the Usage page
6. Everything persisted in local SQLite

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd multi-agent

# Install dependencies
npm install

# Rebuild native modules for Electron
npm run rebuild:electron
```

### Development

```bash
# Terminal 1: Start Next.js dev server
npm run dev

# Terminal 2: Start Electron (points to localhost:3210)
npm run electron:dev
```

> Native modules (`better-sqlite3`) are built against a specific Node/Electron ABI. If DB-backed routes throw a `NODE_MODULE_VERSION` mismatch while running `npm run dev` directly with system Node, run `npm run rebuild:node` — then `npm run rebuild:electron` again before packaging/running under Electron.

### Production Build

```bash
# Build the app
npm run build

# Package for current platform
npm run pack

# Create distributable installer
npm run dist          # auto-detect platform
npm run dist:mac      # macOS (.dmg)
npm run dist:linux    # Linux (AppImage + deb)
npm run dist:win      # Windows (NSIS .exe)
```

Installers will be output to the `release/` directory.

---

## 📖 Usage

### 1. First Run — Onboarding

When you first launch the app, the onboarding wizard will guide you through:

- Setting up your AI provider (pick a preset or enter a base URL + API key + model)
- Optionally configuring GitHub/GitLab tokens
- Optionally selecting allowed filesystem directories

### 2. Create an Agent

Go to **Agents** → **+ New Agent**

- Give it a name, avatar, color, and description
- Write a system prompt (personality + instructions)
- Assign a **category** so it can be added to the workspace as part of a group
- Select which tools it can use
- Assign skills and knowledge

### 3. Chat with an Agent

Click any agent card to open a conversation. Type messages, upload files, and watch the agent use its tools in real time.

### 4. Work with a Team in the Workspace

Go to **Workspace**:

- **Parallel** mode: add agents (or a whole category), send one message, and watch each agent respond independently
- **Manager** mode: describe a complex task — the Manager clarifies requirements, plans sub-tasks, dispatches to the right agents, reviews results, and produces a structured final report

### 5. Connect More AI Providers

Go to **Connections** → **AI Provider** → **+ Add** and pick a **Provider preset**, or enter a custom base URL for any Anthropic/OpenAI/Gemini-compatible endpoint. Save several and mark one active, or let per-model routing use the right one automatically.

### 6. Watch Token Usage

Go to **Usage** to see total/today token counts, a per-model breakdown, and recent calls. Flip on the **context limit** toggle and set a token budget if you want older conversation turns trimmed automatically.

### 7. Schedule Recurring Tasks

Go to **Schedules** to have agents run tasks automatically on a cron schedule.

---

## 📁 Project Structure

```
multi-agent/
├── app/
│   ├── (app)/               # Next.js App Router pages (sidebar-nav'd)
│   │   ├── agents/          # Agent CRUD pages
│   │   ├── chat/            # Chat UI per agent
│   │   ├── workspace/       # Multi-agent workspace (parallel + manager)
│   │   ├── manager/         # Agent Manager task detail
│   │   ├── connections/     # Multi-connection manager (AI, GitHub, GitLab, DB, Redis, monitoring)
│   │   ├── skills/          # Skills management
│   │   ├── knowledge/       # Knowledge base
│   │   ├── memory/          # Shared memory viewer
│   │   ├── usage/           # Token usage + context limit
│   │   ├── logs/            # Activity logs
│   │   ├── monitoring/      # Grafana/Prometheus/Loki
│   │   ├── permissions/     # Approval allowlist
│   │   ├── schedules/       # Cron jobs
│   │   ├── tools/           # Tool connectivity status
│   │   ├── settings/        # Configuration UI
│   │   └── layout.tsx       # Root layout with sidebar
│   └── api/                 # API routes (chat, agents, connections, usage, etc.)
├── components/               # React components
├── lib/                      # Core business logic
│   ├── agent-runtime.ts      # Agent execution loop
│   ├── ai.ts                 # Multi-provider AI client (anthropic/openai/gemini)
│   ├── ai-provider-presets.ts# Provider preset catalog
│   ├── context-limit.ts      # Context-token budget trimming
│   ├── usage-db.ts           # Token usage log + aggregates
│   ├── db.ts                 # SQLite setup + migrations
│   ├── mcp.ts                # MCP server manager
│   ├── manager.ts            # Agent Manager (supervisor)
│   ├── config.ts             # Config service (safeStorage-backed)
│   ├── connections.ts        # Multi-connection registry
│   ├── cron.ts                # Cron job scheduler
│   ├── memory.ts             # Shared memory operations
│   ├── allowlist.ts          # "Always allow" approval list
│   ├── shell.ts              # Sandboxed shell tool + approval registry
│   └── ...
├── electron/
│   └── main.js               # Electron main process
├── scripts/                  # Build scripts
├── data/                     # Runtime data directory
└── release/                  # Build output (installers)
```

---

## 🔧 Configuration

All configuration is managed through the Settings and Connections UI. Under the hood:

- **Regular config** → stored in `config.json` in the userData directory (AI provider settings, context-limit budget, filesystem allowlist, theme, etc.)
- **Secrets** (API keys, tokens) → stored via `safeStorage` (OS keychain: Keychain on macOS, DPAPI on Windows, libsecret on Linux)

No `.env` file needed in production.

---

## 🗄️ Database

The SQLite database is stored at:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Agent Platform/data/app.db` |
| Windows | `%APPDATA%/Agent Platform/data/app.db` |
| Linux | `~/.config/Agent Platform/data/app.db` |

Key tables: `agents`, `conversations`, `messages`, `memories`, `memory_audit`, `skills`, `knowledge`, `connections`, `cron_jobs`, `manager_tasks`, `task_assignments`, `task_events`, `workspace_sessions`, `approval_allowlist`, `token_usage`.

---

## 📄 License

Private — not open source.
