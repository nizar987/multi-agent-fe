# PLAN — Migrasi Backend ke Python (gRPC + REST Gateway)

**Terkait:** PRD-backend-migration.md, PRD.md, DESIGN.md
**Last updated:** 6 Juli 2026

Plan implementasi turunan dari PRD-backend-migration.md. Pendekatan
**strangler** (bertahap, backend lama tetap fallback per domain). Checkbox
per fase; tiap fase diakhiri gate verifikasi sebelum lanjut.

---

## Keputusan Teknologi (ringkas)

| Aspek | Pilihan | Alasan |
|---|---|---|
| Deploy | Server terpisah (remote) | Backend lepas dari Electron; bisa di-scale/deploy sendiri |
| Topologi | Gateway REST + 1 core gRPC | Monolith modular; hindari kompleksitas microservice dini |
| Gateway | FastAPI (Python) | Satu bahasa dgn core, SSE mudah, Pydantic validation |
| Core RPC | `grpc.aio` (async) | Cocok streaming + I/O eksternal (AI, MCP, connectors) |
| DB | PostgreSQL 16 + SQLAlchemy 2 async + asyncpg | Konkurensi, JSONB, skala |
| Migrasi skema | Alembic | Versioned, reversible |
| Proto tooling | `buf` (lint + breaking + codegen) | Kontrak tunggal, cegah breaking change |

Struktur repo target:
```
backend/
├── proto/agentplatform/v1/*.proto     # sumber kebenaran kontrak
├── gateway/                           # FastAPI: REST↔gRPC, SSE, auth
│   ├── app/ (routers, mappers, auth)
│   └── generated/                     # stub gRPC hasil codegen
├── core/                              # service gRPC + domain logic
│   ├── services/ (servicer per domain)
│   ├── domain/   (logika, repository)
│   ├── db/       (models, alembic)
│   └── generated/
├── migration/                         # skrip SQLite→Postgres
└── buf.yaml / buf.gen.yaml
```

---

## Fase 0 — Fondasi

Tujuan: kerangka jalan (gateway↔core↔Postgres) tanpa logika bisnis.

- [ ] Scaffold repo `backend/` (gateway + core) + manajemen dependensi (uv/poetry)
- [ ] Setup `proto/` + `buf.yaml`/`buf.gen.yaml`; codegen stub ke gateway & core
- [ ] Definisikan `Ping`/`Health` RPC untuk uji end-to-end
- [ ] Core: server `grpc.aio` minimal yang melayani `Health`
- [ ] Gateway: FastAPI + Uvicorn, endpoint `GET /health` yang call core via gRPC
- [ ] Postgres lokal (docker-compose) + Alembic init (belum ada tabel domain)
- [ ] Auth skeleton: middleware Bearer di gateway (token dummy), inject ke gRPC metadata
- [ ] CI: lint proto (`buf`), build gateway & core, `pytest` kosong hijau
- [ ] **Gate:** `curl` gateway `/health` → gRPC core → 200; CI hijau

## Fase 1 — Domain Read-only (paritas paralel)

Tujuan: domain aman & read-heavy jalan di Python, dibandingkan output dgn backend lama.

- [ ] `.proto` untuk `AgentService`, `SettingsService`, `LogService`,
      `SkillService`, `KnowledgeService`
- [ ] Alembic: tabel `agents`, `settings`, `logs`, `skills`, `knowledge`
- [ ] Core: repository + servicer tiap domain (read + CRUD dasar)
- [ ] Gateway: router REST memetakan path lama (`GET /api/agents`, dst.)
- [ ] Pydantic schema + mapper REST↔proto per endpoint
- [ ] Suite paritas: script yang tembak backend lama & baru, diff respons
- [ ] **Gate:** paritas hijau untuk seluruh endpoint read-only

## Fase 2 — Chat & Runtime (streaming)

Tujuan: domain paling kompleks — streaming end-to-end.

- [ ] `ChatService.StreamChat` (server-streaming) + message `ChatEvent`
      (`text`/`tool_call`/`tool_result`/`approval`/`delegate_*`/`notice`/`done`/`error`)
- [ ] Core: port `agent-runtime.ts` + `ai.ts` → Python (loop agent, panggil AI provider)
- [ ] Core: integrasi MCP tools (spawn/stdio), delegate antar-agent
- [ ] Gateway: `POST /api/chat` & `POST /api/workspace/chat` → buka gRPC stream,
      map tiap `ChatEvent` ke SSE `data: {json}\n\n`
- [ ] Pertahankan header SSE: `text/event-stream`, `no-cache, no-transform`, `x-accel-buffering: no`
- [ ] Tangani cancel: klien putus → cancel gRPC stream → stop runtime
- [ ] Persist pesan assistant ke Postgres di akhir stream
- [ ] Test streaming: first-token latency, urutan event, cancel, error mid-stream
- [ ] **Gate:** chat end-to-end setara backend lama (fungsional + latency)

## Fase 3 — Domain Stateful & Sensitif

Tujuan: sisa domain, termasuk yang butuh desain ulang untuk remote.

- [ ] `MemoryService` (+ memory_audit dipertahankan) — read/write/delete
- [ ] `ManagerService` (tasks, clarify) — port `manager.ts`/`manager-db.ts`
- [ ] `ConnectionService` — connector Postgres/MySQL/Redis via
      `asyncpg`/`aiomysql`/`redis.asyncio` + endpoint `test`
- [ ] `ToolService` — status tools, GitHub via REST, env/config tools
- [ ] `SchedulerService` — cron sebagai task async internal core (ganti `node-cron`)
- [ ] `ShellService` — eksekusi shell + alur approval streaming
      (**putuskan open-question:** server-side vs IPC klien Electron)
- [ ] `BackupService` — sesuaikan ke storage server / klien
- [ ] Secrets: simpan terenkripsi di DB, endpoint settings hanya tandai "set"
- [ ] **Gate:** paritas hijau semua domain; audit log sensitif jalan

## Fase 4 — Cutover Data & Frontend

Tujuan: pindah data & alihkan frontend sepenuhnya ke gateway baru.

- [ ] Skrip migrasi `migration/` SQLite→Postgres (idempotent, `--dry-run`, resumable)
- [ ] Mapping tipe: PK→identity/BIGSERIAL, TEXT-JSON→JSONB, `datetime('now')`→`timestamptz`
- [ ] Verifikasi: row-count + checksum per tabel, laporan selisih
- [ ] Backup SQLite asli sebelum switchover
- [ ] Frontend: arahkan base URL ke gateway + Authorization header
- [ ] Electron: layar konfigurasi endpoint + token; jadi klien tipis
- [ ] Jalankan migrasi di staging → verifikasi → produksi
- [ ] Pensiunkan `app/api/**` lama setelah verifikasi
- [ ] **Gate:** 100% data termigrasi & terverifikasi; frontend jalan penuh via gateway

## Fase 5 — Hardening

Tujuan: siap produksi.

- [ ] Rate limiting & timeout per klien/endpoint di gateway
- [ ] TLS di edge; core tidak ter-expose publik (network policy / mTLS internal)
- [ ] Observability: logging terstruktur, OpenTelemetry trace gateway↔core, metrics Prometheus
- [ ] Error mapping gRPC status → HTTP lengkap & konsisten
- [ ] Load test streaming & non-stream; tetapkan target p95
- [ ] Dokumentasi deploy (Docker/compose atau k8s) + runbook
- [ ] **Gate:** error-rate < 0.1% beban normal; p95 dalam target; load test lolos

---

## Dependensi Antar-Fase

```
Fase 0 ──▶ Fase 1 ──▶ Fase 2 ──▶ Fase 3 ──▶ Fase 4 ──▶ Fase 5
 (fondasi)  (read)    (chat)     (stateful) (cutover)  (harden)
```
Fase 1–3 bisa sebagian paralel per domain **setelah** proto & fondasi (Fase 0)
stabil. Cutover data (Fase 4) menunggu semua domain terverifikasi.

## Definition of Done (per domain)

1. `.proto` di-review & lolos `buf` breaking-check.
2. Alembic migration + model DB.
3. Servicer core + domain logic + unit test.
4. Router gateway + mapper + Pydantic schema.
5. Endpoint lolos suite paritas vs backend lama.
6. Auth diberlakukan; secrets tidak plaintext.

## Risiko & Mitigasi (operasional)

- **Streaming/backpressure/cancel** → prioritas Fase 2, test khusus, shadow-run.
- **Paritas runtime agent (MCP/delegate/approval)** → suite paritas + jalan paralel.
- **Migrasi data silent-mismatch** → dry-run + checksum + backup + rollback window.
- **Drift proto gateway/core** → codegen dari satu sumber + CI breaking-check.

## Blokir yang Perlu Diputuskan Dulu (dari PRD §15)

1. Shell/filesystem lokal: server-side atau IPC klien Electron? (blokir Fase 3 `ShellService`)
2. Multi-user? → menentukan auth single-secret vs JWT+tenant (pengaruh Fase 0 & 3)
3. Target deploy core (VPS / orchestrator / managed) (pengaruh Fase 5)
4. Electron dipertahankan atau frontend jadi web murni? (pengaruh Fase 4)
