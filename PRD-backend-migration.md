# PRD — Migrasi Backend ke Python (gRPC + REST Gateway)

**Status:** Draft v1
**Owner:** Nizar
**Last updated:** 6 Juli 2026
**Relasi dokumen:** Melanjutkan PRD.md & DESIGN.md (Agent Platform Desktop).
Dokumen ini fokus ke **migrasi lapisan backend** dari Next.js API routes
(TypeScript, in-process Electron) menjadi **backend Python berdiri sendiri**
yang diakses frontend lewat **REST gateway (FastAPI)**, dengan **gRPC**
sebagai kontrak antara gateway dan core service.

---

## 1. Latar Belakang & Masalah

Backend saat ini adalah kumpulan **Next.js API routes** (`app/api/**`) yang
memanggil modul di `lib/**` secara in-process, dibungkus Electron, dengan
storage **SQLite** (`better-sqlite3`) yang menempel di file lokal pengguna.
Model ini punya keterbatasan:

- **Terikat ke Node/Electron.** Semua logika agent (runtime, MCP, manager,
  cron, shell, connections) hidup di proses Next.js yang sama. Tidak bisa
  di-scale, di-deploy, atau dipakai ulang di luar app desktop.
- **Bahasa & ekosistem.** Banyak tooling AI/agent, data pipeline, dan
  library gRPC lebih matang di Python. Tim ingin backend ditulis Python.
- **SQLite single-writer.** WAL membantu, tapi `better-sqlite3` sinkron dan
  single-process — tidak cocok begitu backend jadi service remote yang
  melayani banyak koneksi/agent paralel.
- **Tidak ada batas kontrak.** Frontend memanggil fungsi `lib/*` lewat route
  tipis; tidak ada schema/kontrak formal antar layer, sehingga sulit menguji
  atau menggganti implementasi backend.

## 2. Tujuan (Goals)

1. **Backend Python berdiri sendiri** (bukan lagi in-process Electron) yang
   memuat seluruh logika: agent runtime, chat/streaming, manager, memory,
   connections, tools/MCP, cron, skills, logs, settings.
2. **Core service meng-expose gRPC** sebagai satu-satunya kontrak internal —
   di-generate dari file `.proto` yang jadi sumber kebenaran.
3. **Gateway REST (FastAPI)** di depan core service: menerjemahkan
   REST/JSON (dan SSE untuk streaming) dari frontend ke gRPC ke core.
4. **Frontend tetap konsumsi REST/SSE** dengan perubahan seminimal mungkin —
   idealnya cuma base URL + auth header yang berubah.
5. **Migrasi storage ke PostgreSQL** dengan skrip migrasi data dari SQLite
   yang aman dan bisa diulang (idempotent).
6. **Autentikasi antar-proses** — karena backend kini remote, endpoint tidak
   boleh terbuka tanpa auth (beda dari model desktop lokal sebelumnya).
7. **Paritas fitur 1:1** dengan backend lama sebelum switchover; tidak ada
   fitur yang hilang.

## 3. Non-Goals

- **Bukan** memecah backend jadi banyak microservice. Topologi target adalah
  **satu core service gRPC** (monolith modular) di belakang **satu gateway**.
  Pemecahan lebih lanjut bisa jadi pekerjaan lanjutan, di luar scope ini.
- **Bukan** mendesain ulang UI/UX frontend. Perubahan frontend dibatasi ke
  lapisan pemanggilan API + auth.
- **Bukan** mengganti provider AI, MCP protocol, atau format skill/memory.
- **Bukan** menghapus Electron shell; namun Electron kini jadi *klien tipis*
  yang menunjuk ke backend remote (lihat §11).

## 4. Arsitektur Target

```
┌─────────────┐   REST/JSON + SSE    ┌──────────────────┐   gRPC     ┌──────────────────┐
│  Frontend   │ ───────────────────▶ │  API Gateway     │ ─────────▶ │  Core Service     │
│ (Next.js /  │ ◀─────────────────── │  (FastAPI, Py)   │ ◀───────── │  (Python, gRPC)   │
│  Electron)  │    auth: Bearer      │  - REST↔gRPC     │  server-   │  - agent runtime  │
└─────────────┘                      │  - SSE streaming │  streaming │  - manager/cron   │
                                     │  - authn/z       │            │  - memory/tools   │
                                     │  - rate limit    │            │  - connections    │
                                     └──────────────────┘            └────────┬─────────┘
                                                                              │ SQLAlchemy
                                                                     ┌────────▼─────────┐
                                                                     │   PostgreSQL      │
                                                                     └──────────────────┘
                                              external: AI provider, MCP servers, DB/Redis
                                              connectors, shell workers
```

**Prinsip:**

- **Gateway tidak menyimpan state bisnis.** Ia hanya translasi protokol,
  auth, rate limit, dan streaming. Semua logika ada di core.
- **`.proto` adalah kontrak tunggal.** Gateway dan core sama-sama
  meng-generate stub dari proto yang sama. Perubahan API dimulai dari proto.
- **Streaming chat** dipetakan dari **gRPC server-streaming** di core →
  **SSE** di gateway → frontend (frontend sudah membaca SSE `data: ...\n\n`,
  jadi kontrak ke browser tidak berubah).

## 5. Pemetaan Modul Lama → Baru

Modul `lib/*.ts` dan route `app/api/*` dipindah ke domain di core service.

| Domain (core) | Sumber lama (`lib/` & `app/api/`) | gRPC service |
|---|---|---|
| Agents | `db.ts`, `app/api/agents/**` | `AgentService` |
| Chat / Runtime | `agent-runtime.ts`, `ai.ts`, `app/api/chat`, `app/api/workspace/chat` | `ChatService` (streaming) |
| Manager / Tasks | `manager.ts`, `manager-db.ts`, `app/api/manager/**` | `ManagerService` |
| Memory | `memory.ts`, `app/api/memory/**` | `MemoryService` |
| Connections | `connections.ts`, `connections-db.ts`, `db-clients.ts`, `app/api/connections/**` | `ConnectionService` |
| Tools / MCP | `mcp.ts`, `tools-db.ts`, `tools-env.ts`, `tools-github.ts`, `app/api/tools/**` | `ToolService` |
| Shell / Approval | `shell.ts`, `app/api/shell/approve` | `ShellService` (streaming approval) |
| Cron / Scheduler | `cron.ts`, `app/api/cron/**` | `SchedulerService` |
| Skills | `app/api/skills/**` | `SkillService` |
| Knowledge | `app/api/knowledge/**` | `KnowledgeService` |
| Settings / Secrets | `config.ts`, `paths.ts`, `app/api/settings/**` | `SettingsService` |
| Backup | `backup.ts`, `app/api/backup` | `BackupService` |
| Logs | `logger.ts`, `app/api/logs` | `LogService` |
| Preview / Onboarding | `preview-detect.ts`, `app/api/preview`, `app/api/onboarding` | `MiscService` |

Catatan: operasi yang di desktop lama menyentuh filesystem lokal
(`pick-folder`, `pick-backup-folder`, shell approval interaktif) perlu
didesain ulang untuk model remote — lihat §11 (Dampak ke Frontend/Electron).

## 6. Kontrak gRPC (`.proto`)

Semua service didefinisikan dalam paket `agentplatform.v1`. Contoh minimal:

```proto
syntax = "proto3";
package agentplatform.v1;

service AgentService {
  rpc ListAgents(ListAgentsRequest) returns (ListAgentsResponse);
  rpc GetAgent(GetAgentRequest) returns (Agent);
  rpc CreateAgent(CreateAgentRequest) returns (Agent);
  rpc UpdateAgent(UpdateAgentRequest) returns (Agent);
  rpc DeleteAgent(DeleteAgentRequest) returns (Empty);
}

service ChatService {
  // server-streaming → dipetakan ke SSE di gateway
  rpc StreamChat(ChatRequest) returns (stream ChatEvent);
}

message ChatEvent {
  oneof event {
    TextDelta      text        = 1;
    ToolCall       tool_call   = 2;
    ToolResult     tool_result = 3;
    ApprovalRequest approval   = 4;
    DelegateStart  delegate_start = 5;
    DelegateEnd    delegate_end   = 6;
    SystemNotice   notice      = 7;
    Done           done        = 8;
    ErrorEvent     error       = 9;
  }
}
```

`ChatEvent` sengaja mencerminkan event SSE yang sudah dipakai frontend
(`text`, `tool_call`, `tool_result`, `approval_request`, `delegate_start/end`,
`system_notice`, `done`, `error`), sehingga gateway cukup memetakan `oneof`
gRPC menjadi `data: {json}\n\n`.

**Aturan versioning:** paket bernomor (`v1`); perubahan breaking → `v2`.
Field ditambah (tag baru), tidak pernah dihapus/di-renumber.

## 7. Gateway (FastAPI)

Tanggung jawab gateway:

- **Translasi REST↔gRPC.** Tiap endpoint REST memetakan ke satu (atau
  beberapa) RPC. Path REST menjaga kompatibilitas dengan frontend saat ini
  (mis. `GET /api/agents`, `POST /api/chat`).
- **Streaming.** Endpoint `POST /api/chat` dan `POST /api/workspace/chat`
  membuka gRPC server-stream ke core, lalu meneruskan tiap `ChatEvent`
  sebagai SSE. Header dipertahankan: `text/event-stream`,
  `cache-control: no-cache, no-transform`, `x-accel-buffering: no`.
- **Auth.** Validasi token Bearer (lihat §9) sebelum meneruskan ke core;
  inject identity ke gRPC metadata.
- **Rate limit & timeout** per klien/endpoint.
- **Error mapping.** gRPC status code → HTTP status (mis. `NOT_FOUND`→404,
  `UNAUTHENTICATED`→401, `INVALID_ARGUMENT`→400, `INTERNAL`→500).
- **Validasi input** dengan Pydantic sebelum menyusun message gRPC.

Gateway **stateless** → bisa di-scale horizontal di belakang load balancer.

## 8. Core Service & Data Layer

- **Bahasa/runtime:** Python 3.12+, `grpcio` + `grpcio-tools` (atau
  `grpc.aio` untuk async), server async agar cocok dengan streaming & I/O
  eksternal (AI provider, MCP, DB connectors).
- **ORM/DB:** SQLAlchemy 2.x (async) + `asyncpg` ke PostgreSQL. Migrasi
  skema dikelola **Alembic**.
- **Struktur:** monolith modular — tiap domain (§5) jadi package Python
  dengan servicer gRPC + repository + domain logic. Servicer tipis;
  logika di layer domain agar mudah diuji tanpa gRPC.
- **Integrasi eksternal dipertahankan:** panggilan AI provider, MCP servers,
  connector DB (Postgres/MySQL/Redis via `asyncpg`/`aiomysql`/`redis.asyncio`),
  dan eksekusi shell (worker terisolasi + alur approval).
- **Concurrency:** background task (cron/scheduler) jalan sebagai task
  async internal atau worker terpisah dalam proses core.

## 9. Autentikasi & Keamanan (BARU — karena remote)

Model lama aman-by-default karena semuanya lokal. Setelah remote, ini wajib:

- **Token Bearer** antara frontend↔gateway (mis. API key per instance atau
  JWT bila nanti ada multi-user). Untuk tahap awal single-user: satu secret
  yang dibuat saat provisioning, disimpan aman di klien.
- **mTLS atau token internal** antara gateway↔core; core tidak boleh
  ter-expose langsung ke publik (network policy / bind ke internal).
- **Secrets** (AI API key, connector credentials) disimpan di core/DB
  terenkripsi (bukan lagi `secrets.json` di disk klien). Endpoint settings
  hanya menyimpan/menandai "set", tidak pernah mengembalikan nilai plaintext.
- **TLS** wajib di edge (gateway) untuk semua trafik remote.
- **Rate limiting & audit log** untuk operasi sensitif (shell, connections,
  memory write) — memory audit sudah ada di skema lama, dipertahankan.

## 10. Migrasi Data SQLite → PostgreSQL

- **Skema:** terjemahkan tabel SQLite (`agents`, `conversations`, `messages`,
  `memories`, `memory_audit`, dan tabel manager/connections/tools/cron) ke
  DDL Postgres via Alembic. `INTEGER PK AUTOINCREMENT`→`BIGSERIAL`/identity;
  kolom `TEXT` JSON→`JSONB`; `datetime('now')`→`timestamptz DEFAULT now()`.
- **Skrip migrasi data** (idempotent, bisa di-resume): baca SQLite lama,
  tulis ke Postgres dengan menjaga relasi FK dan urutan id. Sediakan mode
  `--dry-run` dan verifikasi jumlah baris per tabel setelah migrasi.
- **Validasi:** hitung checksum/row-count per tabel sebelum & sesudah;
  laporan selisih. Simpan backup SQLite asli sebelum switchover.
- **Rollback:** selama fase paralel (§12), SQLite lama tetap ada sebagai
  fallback sampai Postgres terverifikasi.

## 11. Dampak ke Frontend & Electron

- **Frontend (Next.js/React):** perubahan minimal — arahkan pemanggilan ke
  **base URL gateway** + sertakan **Authorization header**. Kontrak
  REST/SSE dijaga sama, jadi komponen chat (`res.body.getReader()` +
  parsing `data:`) tetap bekerja.
- **Electron:** berubah dari "host backend in-process" menjadi **klien tipis**
  yang menunjuk backend remote. Tambah layar konfigurasi endpoint + token.
- **Operasi lokal yang tak relevan lagi remote** (`pick-folder`,
  `pick-backup-folder`, akses filesystem lokal, shell approval interaktif)
  perlu keputusan desain: (a) jalankan pada konteks server, atau (b) tetap
  ditangani sisi klien Electron via IPC lokal. **→ Open question (§15).**

## 12. Strategi Migrasi (Bertahap / Strangler)

Big-bang rewrite berisiko; pakai pendekatan strangler agar bisa switchover
per domain dengan aman.

**Fase 0 — Fondasi.** Setup repo Python (gateway + core), toolchain proto,
CI, Postgres + Alembic, skeleton auth. Belum ada logika bisnis.

**Fase 1 — Read-only paritas.** Pindahkan domain "aman" & read-heavy dulu:
`AgentService`, `SettingsService`, `LogService`, `KnowledgeService`,
`SkillService`. Jalankan paralel dengan backend lama; bandingkan output.

**Fase 2 — Chat & Runtime.** Implement `ChatService` streaming (gRPC
server-stream → SSE), agent runtime, AI provider, MCP tools. Ini domain
paling kompleks; uji streaming end-to-end.

**Fase 3 — Stateful & sensitif.** `MemoryService`, `ManagerService`,
`ConnectionService`, `ToolService`, `SchedulerService`, `ShellService`
(termasuk desain ulang approval untuk remote).

**Fase 4 — Cutover data.** Jalankan migrasi SQLite→Postgres, verifikasi,
switch frontend sepenuhnya ke gateway baru, pensiunkan API routes lama.

**Fase 5 — Hardening.** Rate limit, observability, load test, cleanup.

Tiap fase: backend lama tetap jadi fallback sampai domain terverifikasi.

## 13. Tech Stack & Tooling

- **Gateway:** Python 3.12, FastAPI, Uvicorn, Pydantic v2, `grpcio`.
- **Core:** Python 3.12, `grpcio`/`grpc.aio`, `grpcio-tools`, SQLAlchemy 2
  (async) + `asyncpg`, Alembic.
- **Proto:** `buf` untuk lint/breaking-change/codegen (atau `grpcio-tools`
  langsung). Proto disimpan di satu direktori `proto/` sebagai source of truth.
- **DB:** PostgreSQL 16.
- **Auth:** JWT/Bearer (`pyjwt`), TLS di edge.
- **Testing:** `pytest` + `pytest-asyncio`; kontrak test terhadap stub gRPC;
  test streaming SSE; migrasi test dengan DB ephemeral.
- **Observability:** logging terstruktur, OpenTelemetry (trace lintas
  gateway↔core), metrics Prometheus.
- **Packaging/deploy:** container (Docker) untuk gateway & core; compose/
  k8s untuk orkestrasi; env-config lewat secret manager.

## 14. Kriteria Sukses & Metrik

- **Paritas fungsional:** semua endpoint lama punya padanan; suite paritas
  hijau (respons setara antara backend lama & baru).
- **Streaming:** latency first-token chat ≤ backend lama; tidak ada buffering
  (SSE tetap real-time di belakang proxy).
- **Data:** 100% baris termigrasi & terverifikasi (row-count + checksum).
- **Keamanan:** tidak ada endpoint core ter-expose tanpa auth; secrets tidak
  pernah plaintext di klien.
- **Reliabilitas:** error-rate gateway < 0.1% pada beban normal; p95 latency
  REST non-stream dalam target yang disepakati.

## 15. Risiko & Open Questions

**Risiko**
- **Kompleksitas streaming** (gRPC stream→SSE, backpressure, cancel saat
  klien putus). Mitigasi: prioritaskan di Fase 2, test khusus.
- **Paritas runtime agent** (MCP, delegate, tool approval) sulit ditiru
  persis. Mitigasi: suite paritas + shadow-run paralel.
- **Overhead ganda proto** (gateway & core generate stub). Mitigasi: `buf` +
  CI breaking-change check.
- **Migrasi data** JSON→JSONB & tipe waktu rawan silent-mismatch. Mitigasi:
  dry-run + verifikasi + backup.

**Open questions (perlu keputusan)**
1. Operasi filesystem/shell lokal: dijalankan di server, atau tetap di
   klien Electron via IPC? (memengaruhi desain `ShellService` & backup)
2. Multi-user ke depan? (menentukan auth: single secret vs JWT + tenant)
3. Deploy target core: satu VPS, container orchestrator, atau managed?
4. Apakah Electron tetap dipertahankan, atau frontend jadi web app murni
   setelah backend remote?
5. Retensi/rotasi secret & kebijakan enkripsi at-rest di Postgres.

## 16. Milestone (indikatif)

| Milestone | Isi | Fase |
|---|---|---|
| M0 | Repo, toolchain proto, CI, Postgres+Alembic, auth skeleton | 0 |
| M1 | Domain read-only paralel & suite paritas | 1 |
| M2 | Chat streaming end-to-end (gRPC→SSE) | 2 |
| M3 | Domain stateful & sensitif (memory, manager, connections, tools, cron, shell) | 3 |
| M4 | Migrasi data SQLite→Postgres + cutover frontend | 4 |
| M5 | Hardening, observability, load test | 5 |
