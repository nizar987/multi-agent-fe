# Agent Platform Desktop

A local-first, multi-agent AI platform built with Electron + Next.js. Create specialized AI agents with custom tools, let them collaborate through a Manager/Supervisor system, and run them entirely on your machine — no cloud required.

---

## ✨ Features

### 🤖 Multi-Agent System

- Create unlimited agents with custom names, avatars, system prompts, and tool configurations
- Each agent has its own conversation history and personality
- Per-agent model override support

### 🧩 Agent Manager (Supervisor)

- A supervisor layer that orchestrates multiple agents for complex tasks
- Clarification flow — asks the user when the request is ambiguous
- Two-phase dispatch: **PLAN** mode (read-only, drafts approach) → **ACT** mode (executes)
- Automatic quality review with revision requests
- Structured final reports
- Bounded guards (max clarification rounds, max attempts, max revisions) to prevent infinite loops

### 🤝 Workspace

- Multi-agent collaborative sessions
- Pick a team of agents, give them a shared task
- Each agent works independently with its own conversation thread

### 🛠️ Tools & MCP Integration

Agents can be equipped with the following tools:

| Tool | Description |
|------|-------------|
| **GitHub** | Repository exploration, issue/PR management (via REST API) |
| **GitLab** | Full MCP integration via bundled `@modelcontextprotocol/server-gitlab` |
| **Filesystem** | Read/write files via MCP (`@modelcontextprotocol/server-filesystem`) |
| **Shell** | Execute shell commands (with approval) |
| **Database** | SQL queries (PostgreSQL, MySQL, SQLite) |
| **Redis** | Key-value store operations |
| **Memory** | Shared cross-agent memory (read/write/delete with audit log) |
| **Delegate** | Agent-to-agent delegation (up to configurable depth) |
| **Environment** | Read environment variables |

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

### ⏰ Cron Jobs

- Schedule recurring agent tasks with cron expressions
- Enable/disable jobs, track last run time

### 📎 Attachments

- Upload images and PDF documents in chat
- PDF parsing with Anthropic document API support

### 📋 Logs

- View activity logs for debugging and monitoring

### ⚙️ Settings

- AI provider configuration (any Anthropic-compatible endpoint)
- Connection management (GitHub, GitLab, Database, Redis)
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
│  │ Service      │  │ - agents, conversations         │   │
│  │ (safeStorage)│  │ - memories, skills, knowledge   │   │
│  └──────────────┘  │ - connections, cron_jobs, etc.  │   │
│                     └────────────────────────────────┘   │
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
| AI | Anthropic-compatible Messages API |
| Tool Protocol | Model Context Protocol (MCP) SDK |
| External Connections | PostgreSQL (pg), MySQL (mysql2), Redis (ioredis) |
| Scheduling | node-cron |
| Markdown | react-markdown + remark-gfm |
| Charts | Recharts |
| Packaging | electron-builder |

### Data Flow

1. User sends message → Next.js API route (`/api/chat`)
2. `lib/agent-runtime.ts` builds the agent loop (system prompt + tools + memory)
3. AI call via `lib/ai.ts` (Anthropic-compatible endpoint)
4. Tool calls dispatched: MCP servers (filesystem, gitlab), built-in tools (github, shell, db, redis, memory, delegate)
5. Results streamed back to the UI
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

- Setting up your AI provider (API key + base URL + model)
- Optionally configuring GitHub/GitLab tokens
- Optionally selecting allowed filesystem directories

### 2. Create an Agent

Go to **Agents** → **+ New Agent**

- Give it a name, avatar, and description
- Write a system prompt (personality + instructions)
- Select which tools it can use
- Assign skills and knowledge

### 3. Chat with an Agent

Click any agent card to open a conversation. Type messages, upload files, and watch the agent use its tools in real time.

### 4. Use the Manager for Complex Tasks

Go to **Workspace** or **Manager** to orchestrate multiple agents:

- Describe a complex task
- The Manager clarifies requirements, plans sub-tasks, and dispatches to the right agents
- Reviews results and requests revisions if needed
- Produces a structured final report

### 5. Schedule Recurring Tasks

Set up cron jobs to have agents run tasks automatically on a schedule.

---

## 📁 Project Structure

```
multi-agent/
├── app/                    # Next.js App Router
│   ├── agents/             # Agent CRUD pages
│   ├── api/                # API routes (chat, agents, connections, etc.)
│   ├── chat/               # Chat UI per agent
│   ├── workspace/          # Multi-agent workspace
│   ├── manager/            # Agent Manager tasks
│   ├── skills/             # Skills management
│   ├── knowledge/          # Knowledge base
│   ├── memory/             # Shared memory viewer
│   ├── logs/               # Activity logs
│   ├── settings/           # Configuration UI
│   └── layout.tsx          # Root layout with sidebar
├── components/             # React components
├── lib/                    # Core business logic
│   ├── agent-runtime.ts    # Agent execution loop
│   ├── ai.ts               # Anthropic-compatible AI client
│   ├── db.ts               # SQLite setup + migrations
│   ├── mcp.ts              # MCP server manager
│   ├── manager.ts          # Agent Manager (supervisor)
│   ├── config.ts           # Config service (electron-store + safeStorage)
│   ├── connections.ts      # Multi-connection registry
│   ├── cron.ts             # Cron job scheduler
│   ├── memory.ts           # Shared memory operations
│   └── ...
├── electron/
│   └── main.js             # Electron main process
├── scripts/                # Build scripts
├── data/                   # Runtime data directory
└── release/                # Build output (installers)
```

---

## 🔧 Configuration

All configuration is managed through the Settings UI. Under the hood:

- **Regular config** → stored in `electron-store` (JSON in the userData directory)
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

Key tables: `agents`, `conversations`, `messages`, `memories`, `memory_audit`, `skills`, `knowledge`, `connections`, `cron_jobs`, `manager_tasks`, `task_assignments`, `task_events`, `workspace_sessions`.

---

## 📄 License

Private — not open source.
