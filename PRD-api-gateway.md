# PRD: AI API Gateway (Abstraction Layer atas NVIDIA NIM)

| Field       | Detail                              |
|-------------|-------------------------------------|
| Version     | 1.0 — Draft                         |
| Status      | Draft                               |
| Author      | Product Manager Agent               |
| Date        | 2026-08-28                          |
| Stack       | Node.js (Express/Fastify) — Backend |
| Stakeholders| Engineering, Product, Business      |

---

## 1. Problem Statement

Tim ingin memanfaatkan kekuatan model AI dari NVIDIA NIM (NVIDIA Inference Microservices) — mulai dari LLM, embedding, hingga image generation — tanpa mengekspos identitas vendor tersebut ke end-user maupun ke developer konsumen API.

**Masalah konkret:**
- Jika consumer langsung hit endpoint NVIDIA, mereka tahu produk kita bergantung pada NVIDIA → **vendor lock-in terekspos**
- Tidak ada lapisan kontrol: rate limit, auth, logging, cost tracking semua tidak ada
- Jika suatu hari kita ganti provider (misal ke OpenAI, Groq, atau self-hosted), semua consumer harus ubah integrasi
- API key NVIDIA bisa bocor karena langsung dipakai di sisi client/consumer

**Siapa yang terdampak:**
- Developer internal yang membangun fitur AI di atas gateway ini
- End-user aplikasi yang tidak perlu tahu model apa yang berjalan di balik layar

**Dampak jika tidak diselesaikan:**
- Vendor dependency terekspos → negosiasi bisnis dengan NVIDIA melemah
- Tidak ada central control plane → audit, billing, abuse prevention mustahil dilakukan
- Migration cost sangat tinggi jika harus ganti provider di kemudian hari

---

## 2. Goals & Success Metrics

### Business Goals
- Sembunyikan identitas NVIDIA dari semua consumer (zero leakage)
- Miliki satu titik kendali untuk semua request AI (single pane of glass)
- Minimasi migration cost jika ganti provider di masa depan

### User Goals (Developer Consumer)
- Bisa konsumsi API AI dengan format yang familiar (OpenAI-compatible atau custom format)
- Tidak perlu tahu atau manage API key NVIDIA
- Mendapat response yang konsisten dan terdokumentasi

### Success Metrics

| Metric | Baseline | Target (3 bulan) |
|--------|----------|------------------|
| Zero NVIDIA identity leak di response header/body | - | 100% |
| API uptime | - | ≥ 99.5% |
| P95 latency overhead gateway | - | ≤ 150ms tambahan vs direct call |
| Developer onboarding time ke gateway | - | ≤ 30 menit |
| API key rotation tanpa downtime | - | 100% sukses |

### Anti-Goals
- Gateway ini **bukan** model hosting — kita tidak menjalankan model sendiri
- Bukan untuk menggantikan NVIDIA endpoint performance — latency model tetap dari NVIDIA
- Tidak ada fine-tuning atau training capability di layer ini
- Tidak expose raw NVIDIA API format ke consumer

---

## 3. User Personas

### Persona 1 — Rendra, Backend Developer Internal
- **Usia:** 27 tahun
- **Role:** Backend Engineer di tim produk
- **Goals:** Integrasi fitur AI (chat, embedding, summarization) ke aplikasi dengan cepat
- **Pains:** Tidak mau urus rotasi API key vendor, tidak mau tahu soal vendor spesifik, butuh dokumentasi yang jelas
- **Quote:** "Kasih saya endpoint, format request-response, dan SLA-nya. Sisanya urusin kamu."

### Persona 2 — Dian, Tech Lead / Architect
- **Usia:** 34 tahun
- **Role:** Tech Lead yang bertanggung jawab atas arsitektur sistem
- **Goals:** Pastikan tidak ada vendor lock-in yang terekspos, ada audit trail, cost terkontrol
- **Pains:** Takut kalau tiba-tiba NVIDIA naik harga atau ganti term of service, semua sistem kacau
- **Quote:** "Kita harus bisa ganti vendor dalam 1 hari tanpa developer lain tahu."

### Persona 3 — Siti, Product Manager
- **Usia:** 30 tahun
- **Role:** PM yang manage fitur AI di produk
- **Goals:** Tahu berapa cost per feature, berapa request per hari, fitur mana yang paling banyak dipakai
- **Pains:** Tidak ada visibility ke usage AI, susah justify budget AI ke manajemen
- **Quote:** "Saya butuh dashboard usage per fitur biar bisa laporan ke C-level."

---

## 4. User Stories & Acceptance Criteria

### P0 — Must Have (MVP Blocker)

---

**US-01: Proxy Request ke NVIDIA tanpa ekspos identitas vendor**

> Sebagai developer consumer, saya ingin mengirim request ke gateway dan mendapat response AI, sehingga saya tidak perlu tahu model atau vendor yang digunakan.

**Acceptance Criteria:**
- [ ] Response header tidak mengandung kata `nvidia`, `nim`, `nvcf`, atau identifier NVIDIA apapun
- [ ] Response body tidak mengandung field yang mengekspos nama vendor (model name di-map ke nama internal)
- [ ] API base URL menggunakan domain milik kita sendiri (bukan api.nvidia.com)
- [ ] Error message yang dikembalikan ke consumer menggunakan format custom kita, bukan format error NVIDIA
- [ ] Jika NVIDIA return error, gateway translate ke error format standar kita sebelum dikirim ke consumer

---

**US-02: Autentikasi consumer via API Key milik kita**

> Sebagai developer consumer, saya ingin autentikasi ke gateway menggunakan API key yang diterbitkan oleh sistem kita, sehingga saya tidak perlu memegang API key NVIDIA.

**Acceptance Criteria:**
- [ ] Gateway menerbitkan API key sendiri (format: `gw_xxxxxxxxxxxxxxxx`)
- [ ] Setiap request consumer harus menyertakan header `Authorization: Bearer <api-key>`
- [ ] Request tanpa API key valid dikembalikan `401 Unauthorized`
- [ ] API key NVIDIA hanya ada di environment variable server-side, tidak pernah dikirim ke consumer
- [ ] Satu API key consumer bisa di-revoke tanpa affect consumer lain

---

**US-03: Route request ke endpoint NVIDIA yang tepat**

> Sebagai sistem, saya ingin gateway meneruskan request ke endpoint NVIDIA yang sesuai berdasarkan route yang dipanggil consumer, sehingga mapping tetap transparan dari sisi server.

**Acceptance Criteria:**
- [ ] Config mapping route internal → NVIDIA endpoint tersimpan di config/env, bukan hardcoded
- [ ] Gateway support minimal 3 jenis route: `/v1/chat`, `/v1/embeddings`, `/v1/completions`
- [ ] Request body diteruskan ke NVIDIA setelah transformasi (hapus field yang tidak relevan, tambah field required NVIDIA)
- [ ] Response dari NVIDIA di-transform sebelum dikembalikan ke consumer (normalisasi field names)
- [ ] Jika route tidak ditemukan, return `404 Not Found` dengan pesan custom

---

**US-04: Rate Limiting per API Key**

> Sebagai admin, saya ingin setiap API key consumer punya rate limit, sehingga tidak ada satu consumer yang monopoli resource atau abuse sistem.

**Acceptance Criteria:**
- [ ] Default rate limit: 60 request per menit per API key
- [ ] Jika limit tercapai, return `429 Too Many Requests` dengan header `Retry-After`
- [ ] Rate limit bisa dikonfigurasi per API key (ada tier: free, standard, premium)
- [ ] Rate limit counter di-store di Redis (bukan in-memory, agar tidak hilang saat restart)

---

**US-05: Logging setiap request & response**

> Sebagai admin, saya ingin setiap request yang masuk ke gateway tercatat, sehingga saya bisa audit, debug, dan track usage.

**Acceptance Criteria:**
- [ ] Setiap request log minimal: timestamp, api_key_id (bukan raw key), route, method, status_code, latency_ms
- [ ] Log **tidak** menyimpan raw request body yang mengandung data sensitif user (atau di-mask)
- [ ] Log ditulis ke stdout dalam format JSON (agar mudah di-ingest ke logging platform)
- [ ] Failed request ke NVIDIA juga dicatat beserta error reason-nya

---

### P1 — Should Have

---

**US-06: Health Check Endpoint**

> Sebagai DevOps/infra, saya ingin ada endpoint health check, sehingga load balancer atau Kubernetes bisa monitor status gateway.

**Acceptance Criteria:**
- [ ] `GET /health` return `200 OK` dengan body `{ "status": "ok", "uptime": <seconds> }`
- [ ] `GET /health/deep` cek koneksi ke NVIDIA endpoint dan Redis, return status masing-masing
- [ ] Jika NVIDIA tidak reachable, `/health/deep` return `503` dengan detail component yang gagal

---

**US-07: API Key Management via Admin API**

> Sebagai admin, saya ingin bisa membuat, list, dan revoke API key consumer via REST API, sehingga tidak perlu akses langsung ke database.

**Acceptance Criteria:**
- [ ] `POST /admin/keys` — buat API key baru, return key value (hanya sekali ditampilkan)
- [ ] `GET /admin/keys` — list semua key (tampilkan id, label, tier, created_at, status; key value di-hash)
- [ ] `DELETE /admin/keys/:id` — revoke key (soft delete, set status = revoked)
- [ ] Admin endpoint dilindungi oleh admin token terpisah dari consumer API key
- [ ] API key value di-hash (bcrypt/SHA-256) sebelum disimpan ke database

---

**US-08: Request Timeout & Retry ke NVIDIA**

> Sebagai sistem, saya ingin ada mekanisme timeout dan retry ke NVIDIA, sehingga gateway tidak hang selamanya jika NVIDIA lambat atau error sementara.

**Acceptance Criteria:**
- [ ] Timeout default: 30 detik untuk request ke NVIDIA
- [ ] Jika NVIDIA return 5xx, gateway retry maksimal 2x dengan exponential backoff (1s, 2s)
- [ ] Jika semua retry gagal, gateway return `502 Bad Gateway` ke consumer dengan pesan custom (tanpa mention NVIDIA)
- [ ] Timeout bisa dikonfigurasi via environment variable


### P2 — Nice to Have

**US-09: Usage Statistics per API Key**
> Sebagai admin/PM, saya ingin lihat usage stats per API key (total request, token used, error rate), sehingga bisa track cost dan usage pattern.

**Acceptance Criteria:**
- [ ] `GET /admin/keys/:id/stats` return: total_requests, total_tokens, error_count, last_used_at (last 30 hari)
- [ ] Data di-aggregate dari log table, bukan real-time counter
- [ ] Bisa filter by date range

---

**US-10: Model Aliasing**
> Sebagai admin, saya ingin bisa mapping nama model internal (misal `ai-chat-v1`) ke model NVIDIA spesifik, sehingga bisa ganti model tanpa consumer ubah kode.

**Acceptance Criteria:**
- [ ] Config model alias tersimpan di database/config file
- [ ] Consumer kirim `"model": "ai-chat-v1"` → gateway translate ke `"model": "meta/llama-3.1-70b-instruct"` sebelum kirim ke NVIDIA
- [ ] Admin bisa update alias via `PATCH /admin/models/:alias`

---

## 5. User Flow

### Flow 1: Consumer API Request (Happy Path)

```
Consumer App
    │
    ▼
[1] POST /v1/chat
    Authorization: Bearer gw_xxxx
    Body: { "model": "ai-chat-v1", "messages": [...] }
    │
    ▼
[2] Gateway: Validate API Key
    ├── Key tidak ada → 401 Unauthorized
    ├── Key revoked   → 401 Unauthorized
    └── Key valid     → lanjut
    │
    ▼
[3] Gateway: Check Rate Limit (Redis)
    ├── Limit exceeded → 429 Too Many Requests
    └── OK             → lanjut
    │
    ▼
[4] Gateway: Transform Request
    - Map "ai-chat-v1" → "meta/llama-3.1-70b-instruct"
    - Tambah NVIDIA-required headers (Authorization: Bearer NVIDIA_KEY)
    - Strip header consumer
    │
    ▼
[5] Forward ke NVIDIA NIM Endpoint
    POST https://integrate.api.nvidia.com/v1/chat/completions
    │
    ├── NVIDIA Error 5xx → Retry (max 2x)
    ├── NVIDIA Error 4xx → Transform error → return ke consumer
    └── NVIDIA 200 OK   → lanjut
    │
    ▼
[6] Gateway: Transform Response
    - Strip header NVIDIA (x-nvcf-*, server: nvidia, dll)
    - Map model name balik ke alias internal
    - Normalize field names
    │
    ▼
[7] Log Request (async, non-blocking)
    - Tulis ke log: key_id, route, status, latency, tokens
    │
    ▼
[8] Return Response ke Consumer
    Status: 200 OK
    Body: { "model": "ai-chat-v1", "choices": [...] }
```

### Flow 2: Admin Buat API Key Baru

```
Admin
  │
  ▼
POST /admin/keys
Authorization: Bearer ADMIN_TOKEN
Body: { "label": "service-kasir", "tier": "standard" }
  │
  ▼
Gateway generate key: gw_[random 32 char]
  │
  ▼
Hash key → simpan ke DB (hashed)
  │
  ▼
Return: { "key": "gw_xxx...", "id": "uuid" }
(key hanya ditampilkan SEKALI ini saja)
```

---

## 6. Functional Requirements

### Core Proxy
- Gateway harus support HTTP method: POST, GET
- Gateway harus support streaming response (Server-Sent Events / chunked transfer) untuk endpoint chat
- Semua header yang mengandung identitas NVIDIA wajib di-strip dari response
- Model name mapping wajib berjalan sebelum request diteruskan ke NVIDIA
- Error dari NVIDIA wajib di-translate ke format error standar gateway sebelum dikembalikan ke consumer

### Authentication & Authorization
- API key consumer disimpan sebagai hash (SHA-256 atau bcrypt) di database
- API key NVIDIA disimpan sebagai environment variable, tidak boleh di-log, tidak boleh masuk response
- Admin endpoint (`/admin/*`) hanya bisa diakses dengan `ADMIN_TOKEN` yang berbeda dari consumer key
- Setiap request consumer wajib validasi key sebelum diproses

### Rate Limiting
- Rate limit per API key, stored di Redis dengan TTL 60 detik sliding window
- Tier rate limit:
  - `free`: 20 req/menit
  - `standard`: 60 req/menit
  - `premium`: 300 req/menit
- Response header sertakan: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Logging
- Log format: JSON, satu baris per request
- Field wajib: `ts`, `key_id`, `route`, `method`, `status`, `latency_ms`, `upstream_latency_ms`, `tokens_used`
- Field yang DILARANG masuk log: raw API key, raw request body content, NVIDIA key
- Log ditulis ke stdout (bukan file langsung) agar bisa di-collect oleh log aggregator

### Admin API
- `POST /admin/keys` — create key
- `GET /admin/keys` — list keys (paginated, 20 per page)
- `DELETE /admin/keys/:id` — revoke key
- `GET /admin/keys/:id/stats` — usage stats (P2)
- `PATCH /admin/models/:alias` — update model alias (P2)

---

## 7. Non-Functional Requirements

### Performance
- Gateway overhead (excluding NVIDIA latency): P95 ≤ 150ms, P99 ≤ 300ms
- Support concurrent requests: minimal 100 concurrent connections per instance
- Streaming response tidak boleh di-buffer penuh — harus pipe langsung ke consumer

### Security
- API key tidak pernah di-log dalam bentuk plain text
- NVIDIA API key hanya ada di environment variable, tidak di source code
- Semua endpoint gateway wajib HTTPS di production
- Response header wajib include: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- Admin endpoint wajib IP whitelist atau VPN-only di production
- Rate limiting sebagai first line of defense terhadap abuse

### Availability & Reliability
- Target uptime: 99.5% (downtime ≤ 3.6 jam/bulan)
- Gateway tidak boleh single point of failure — harus bisa di-scale horizontal
- State (rate limit counter, API key) disimpan di Redis, bukan in-memory process
- Graceful shutdown: tunggu request yang sedang berjalan selesai sebelum restart

### Scalability
- Stateless: setiap instance tidak menyimpan state lokal
- Horizontal scaling via load balancer (Nginx / AWS ALB / Kubernetes Ingress)
- Redis sebagai shared state store

### Maintainability
- Konfigurasi via environment variable (12-factor app)
- Setiap route mapping bisa diubah tanpa redeploy (via config file atau DB)
- Unit test coverage: minimal 80% untuk logic transformasi request/response

### Observability
- Expose `/metrics` endpoint dalam format Prometheus (P1)
- Structured logging (JSON) untuk semua request
- Distributed tracing header di-forward (jika ada `traceparent` dari consumer)


---

## 8. Technical Considerations

### Stack
- **Runtime:** Node.js 20 LTS
- **Framework:** Fastify (lebih performant dari Express untuk high-throughput proxy)
- **HTTP Client:** `undici` atau `axios` untuk forward request ke NVIDIA
- **Database:** PostgreSQL — store API keys (hashed), model aliases, audit log
- **Cache / Rate Limit:** Redis 7+
- **Auth hashing:** `crypto.createHash('sha256')` untuk API key lookup
- **Process manager:** PM2 atau langsung sebagai container (Docker)

### Arsitektur

```
                        ┌─────────────────────────────────┐
Consumer App ──HTTPS──▶ │         API Gateway              │
                        │  (Node.js / Fastify)             │
                        │                                  │
                        │  1. Auth Middleware               │
                        │  2. Rate Limit Middleware (Redis) │
                        │  3. Request Transformer           │
                        │  4. Upstream Proxy (undici)       │
                        │  5. Response Transformer          │
                        │  6. Logger (async)                │
                        └────────────┬────────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │   NVIDIA NIM API     │
                          │ (hidden from consumer)│
                          └─────────────────────┘
                        
                        ┌───────────┐   ┌──────────────┐
                        │  Redis    │   │  PostgreSQL   │
                        │(rate limit│   │ (keys, logs,  │
                        │ counters) │   │  model alias) │
                        └───────────┘   └──────────────┘
```

### Header Stripping — Daftar Header NVIDIA yang Wajib Di-remove

Response header berikut harus dihapus sebelum dikirim ke consumer:
- `server` (biasanya: `nginx` atau identitas NVIDIA infra)
- `x-nvcf-*` (semua header dengan prefix ini)
- `x-request-id` dari NVIDIA (replace dengan request-id internal kita)
- `via`
- `x-powered-by`

Gateway harus inject header kita sendiri sebagai gantinya:
- `x-request-id: <internal-uuid>`
- `x-gateway-version: 1.0`

### Request/Response Transform Contract

**Request dari consumer → ke NVIDIA:**
```json
// Consumer kirim:
{
  "model": "ai-chat-v1",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}

// Gateway forward ke NVIDIA:
{
  "model": "meta/llama-3.1-70b-instruct",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```

**Response dari NVIDIA → ke consumer:**
```json
// NVIDIA return:
{
  "id": "chatcmpl-xxx",
  "model": "meta/llama-3.1-70b-instruct",
  "choices": [...]
}

// Gateway return ke consumer:
{
  "id": "chatcmpl-xxx",
  "model": "ai-chat-v1",
  "choices": [...]
}
```

### Database Schema (Ringkasan)

```sql
-- API Keys table
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label VARCHAR(100) NOT NULL,
  key_hash VARCHAR(64) UNIQUE NOT NULL,  -- SHA-256 hash
  tier VARCHAR(20) DEFAULT 'standard',   -- free/standard/premium
  status VARCHAR(20) DEFAULT 'active',   -- active/revoked
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- Model aliases table
CREATE TABLE model_aliases (
  alias VARCHAR(50) PRIMARY KEY,         -- "ai-chat-v1"
  upstream_model VARCHAR(200) NOT NULL,  -- "meta/llama-3.1-70b-instruct"
  upstream_url VARCHAR(500) NOT NULL,    -- NVIDIA endpoint URL
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Request logs table
CREATE TABLE request_logs (
  id BIGSERIAL PRIMARY KEY,
  key_id UUID REFERENCES api_keys(id),
  route VARCHAR(100),
  method VARCHAR(10),
  status_code INT,
  latency_ms INT,
  upstream_latency_ms INT,
  tokens_used INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Environment Variables

```env
# Server
PORT=3000
NODE_ENV=production

# NVIDIA (TIDAK PERNAH EXPOSE KE CONSUMER)
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxx
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# Database
DATABASE_URL=postgresql://user:pass@host:5432/gateway

# Redis
REDIS_URL=redis://localhost:6379

# Admin
ADMIN_TOKEN=admin_xxxxxxxxxxxxxxxx

# Rate limiting defaults (dapat di-override per key)
RATE_LIMIT_FREE=20
RATE_LIMIT_STANDARD=60
RATE_LIMIT_PREMIUM=300

# Upstream timeout
UPSTREAM_TIMEOUT_MS=30000
UPSTREAM_MAX_RETRIES=2
```

### Dependency yang Diperlukan

| Package | Versi | Fungsi |
|---------|-------|--------|
| `fastify` | ^4.x | HTTP framework |
| `undici` | ^6.x | HTTP client ke NVIDIA |
| `ioredis` | ^5.x | Redis client |
| `pg` | ^8.x | PostgreSQL client |
| `pino` | ^8.x | Structured JSON logger (built-in di Fastify) |
| `@fastify/rate-limit` | ^9.x | Rate limit middleware |

### Migration Strategy
- Ini adalah service baru, tidak ada migration dari existing system
- NVIDIA key yang sebelumnya tersebar di berbagai service wajib dipindahkan ke gateway setelah deployment
- Consumer service harus update base URL mereka ke gateway URL

---

## 9. Release Plan

### MVP Scope (Sprint 1-2, ~2 minggu)

| # | Fitur | Priority |
|---|-------|----------|
| 1 | Core proxy + header stripping | P0 |
| 2 | Consumer API key auth | P0 |
| 3 | Route mapping `/v1/chat`, `/v1/completions`, `/v1/embeddings` | P0 |
| 4 | Rate limiting via Redis | P0 |
| 5 | Request/response transform | P0 |
| 6 | Structured logging | P0 |
| 7 | Health check `/health` | P1 |
| 8 | Admin API (create/list/revoke key) | P1 |
| 9 | Retry + timeout ke upstream | P1 |

### Iterasi 2 (Sprint 3-4, setelah MVP stabil)

| # | Fitur | Priority |
|---|-------|----------|
| 10 | Model aliasing via admin API | P2 |
| 11 | Usage stats per API key | P2 |
| 12 | `/metrics` endpoint (Prometheus) | P1 |
| 13 | Streaming support (SSE) | P1 |

### Rollout Strategy
1. **Internal testing** — deploy ke staging, hit dengan load test (k6/Artillery)
2. **Dogfood** — tim internal pakai gateway selama 1 minggu
3. **Soft launch** — 1-2 consumer service dipindah ke gateway
4. **Full migration** — semua consumer service pindah, NVIDIA key di-revoke dari tempat lama

### Rollback Plan
- Gateway adalah additive layer — jika gagal, consumer bisa sementara direct-call NVIDIA kembali
- Tidak ada data loss risk (gateway tidak menyimpan data user)
- Feature flag per consumer untuk switch antara direct vs gateway

---

## 10. Open Questions

| # | Pertanyaan | Owner | Deadline |
|---|-----------|-------|----------|
| OQ-01 | Apakah kita pakai OpenAI-compatible format atau custom format response? Ini affect consumer migration effort | Product + Engineering | Sprint 1 Day 1 |
| OQ-02 | Berapa jumlah NVIDIA endpoint/model yang perlu di-support di MVP? | Engineering | Sprint 1 |
| OQ-03 | Apakah streaming (SSE) wajib di MVP atau bisa di iterasi 2? | Product | Sprint 1 |
| OQ-04 | Di mana gateway di-host? Self-hosted VPS, Kubernetes, atau managed (Railway/Render)? | DevOps | Pre-sprint |
| OQ-05 | Apakah perlu multi-region dari awal atau single region cukup untuk MVP? | DevOps + Product | Pre-sprint |
| OQ-06 | Siapa yang bisa akses admin API? Apakah perlu role management atau satu admin token cukup? | Product | Sprint 1 |
| OQ-07 | Apakah ada SLA yang perlu dikomunikasikan ke consumer internal tentang gateway uptime? | Product | Sprint 2 |

---

## 11. Assumptions

- NVIDIA NIM endpoint sudah aktif dan API key tersedia sebelum development dimulai
- Consumer internal bersedia update base URL ke gateway (tidak ada resistance)
- Redis dan PostgreSQL sudah tersedia di infrastructure (atau mudah di-provision)
- Tidak ada regulatory requirement yang melarang proxy traffic ke NVIDIA (data privacy sudah dicek)

---

*PRD ini adalah living document — update sesuai perkembangan sprint dan feedback engineering.*

