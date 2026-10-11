# Design Document: AI API Gateway

| Field       | Detail                          |
|-------------|----------------------------------|
| Version     | 1.0 — Draft                      |
| Status      | Draft                            |
| Author      | Product Manager Agent            |
| Date        | 2026-08-28                       |
| PRD Ref     | PRD-api-gateway.md               |
| Plan Ref    | PLAN-api-gateway.md              |

---

## 1. Overview

Gateway ini adalah reverse proxy layer yang duduk di antara consumer API dan NVIDIA NIM endpoint. Consumer tidak tahu bahwa di belakang layar ada NVIDIA — semua identifier, header, dan nama model di-abstract menjadi namespace milik kita sendiri.

```
Consumer App
    │
    │  Authorization: Bearer gw_xxxx
    │  POST /v1/chat
    ▼
┌─────────────────────────────────────────┐
│           AI API Gateway                │
│                                         │
│  Auth → Rate Limit → Transform → Proxy  │
│                    ↕                    │
│          Logging + Metrics              │
└─────────────────────────────────────────┘
    │
    │  Authorization: Bearer nvapi-xxxx   ← hidden
    │  POST /v1/chat/completions          ← NVIDIA format
    ▼
NVIDIA NIM Endpoint
```

**Prinsip desain utama:**
- **Transparency by design** — tidak ada satu pun identifier vendor yang bisa bocor ke layer consumer
- **Config-driven routing** — tambah/ubah route tanpa perlu redeploy
- **Fail-safe** — jika dependency (Redis, PostgreSQL) down, sistem degrades gracefully dengan fallback behavior yang jelas
- **Minimal surface area** — gateway hanya transformasi + proxy, tidak menyimpan data sensitif permanen

---

## 2. User Personas (Ringkasan)

### Rendra — Backend Developer Consumer
- Konsumsi API via `Authorization: Bearer gw_*`
- Hanya peduli: request format, response format, rate limit, dan dokumentasi
- Tidak boleh tahu nama vendor, model internal, atau cara kerja proxy

### Dian — Tech Lead / Architect
- Butuh: audit trail, zero vendor lock-in leak, kemampuan ganti provider cepat
- Interaksi via: Admin API, log platform, CI security scan
- Success criteria: bisa ganti NVIDIA → provider lain dalam 1 hari kerja

### Siti — Product Manager
- Butuh: usage stats per API key, cost visibility, error rate per route
- Interaksi via: Admin API `/admin/stats`, future dashboard
- Success criteria: bisa laporan usage AI ke C-level mingguan

---

## 3. User Journey Map

### Journey: Rendra — Pertama Kali Pakai Gateway

| Stage | Action | Touchpoint | Emotion | Pain Point | Opportunity |
|-------|--------|------------|---------|------------|-------------|
| **Discovery** | Dapat info gateway dari PM/Tech Lead | Slack, README | 😐 Netral | "Dokumentasi di mana?" | README langsung ada contoh curl |
| **Onboarding** | Minta API key dari admin | Admin API / manual | 😐 Netral | Proses minta key lambat | Self-serve portal (fase 2) |
| **First Call** | Kirim request pertama ke `/v1/chat` | API endpoint | 😊 Antusias | Format request beda dari OpenAI | OpenAI-compatible format |
| **Integration** | Integrasikan ke aplikasi | SDK / HTTP client | 😊 Produktif | Error message kurang jelas | Error code terdokumentasi |
| **Operasional** | Monitor rate limit usage | Response header | 😐 Netral | Tidak tahu sisa quota | `X-RateLimit-Remaining` header |
| **Incident** | Hit rate limit saat load tinggi | `429` response | 😤 Frustrasi | Tidak tahu kapan bisa retry | `Retry-After` header jelas |

### Journey: Dian — Audit & Provider Migration

| Stage | Action | Touchpoint | Emotion |
|-------|--------|------------|---------|
| **Audit** | Cek log untuk compliance review | Log platform (JSON) | 😊 Lega (log terstruktur) |
| **Security Check** | Scan response untuk vendor leak | CI automated test | 😊 Confident |
| **Config Change** | Update route mapping ke provider baru | Config file | 😐 Netral (config-driven) |
| **Validation** | Jalankan integration test suite | CI pipeline | 😊 Confident |
| **Deploy** | Deploy tanpa downtime | Rolling deploy | 😊 Relieved |

---

## 4. System Architecture

### 4.1 Komponen Utama

```
┌──────────────────────────────────────────────────────────────────┐
│                        AI API Gateway                            │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐   │
│  │  HTTP Layer │    │  Middleware  │    │   Proxy Engine    │   │
│  │  (Fastify)  │───▶│  Pipeline   │───▶│   (undici/fetch)  │   │
│  └─────────────┘    └──────────────┘    └───────────────────┘   │
│                            │                       │             │
│                     ┌──────┴──────┐         ┌──────┴──────┐     │
│                     │  Middleware │         │  Transform  │     │
│                     │  Modules   │         │   Engine    │     │
│                     └──────┬──────┘         └─────────────┘     │
│                            │                                     │
│              ┌─────────────┼─────────────┐                      │
│              ▼             ▼             ▼                       │
│        ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│        │  Auth    │ │  Rate    │ │ Logger   │                   │
│        │  Module  │ │  Limiter │ │ Module   │                   │
│        └──────────┘ └──────────┘ └──────────┘                   │
│              │             │                                     │
│        ┌─────┴──┐    ┌─────┴──┐                                 │
│        │Postgres│    │ Redis  │                                  │
│        └────────┘    └────────┘                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Middleware Pipeline (Request Flow)

```
Request masuk
    │
    ▼
[1] Request Parser        ← parse body, headers, method
    │
    ▼
[2] Auth Middleware        ← validasi Bearer token (gw_*)
    │ FAIL → 401
    ▼
[3] Rate Limit Middleware  ← cek Redis counter per api_key_id
    │ EXCEED → 429 + Retry-After
    ▼
[4] Route Resolver        ← map /v1/chat → NVIDIA endpoint URL
    │ NOT FOUND → 404
    ▼
[5] Request Transformer   ← tambah NVIDIA API key, model name, strip consumer fields
    │
    ▼
[6] Upstream Proxy        ← forward ke NVIDIA via undici
    │ FAIL → 502/504
    ▼
[7] Response Transformer  ← strip NVIDIA headers, remap model name, normalize body
    │
    ▼
[8] Logger Middleware      ← catat: timestamp, key_id, route, status, latency
    │
    ▼
Response ke consumer
```

### 4.3 Folder Struktur

```
gateway/
├── src/
│   ├── app.js                  ← Fastify app factory
│   ├── server.js               ← entry point
│   ├── config/
│   │   ├── routes.json         ← route mapping config (internal → NVIDIA)
│   │   ├── models.json         ← model name mapping (internal → NVIDIA)
│   │   └── tiers.json          ← rate limit tier config
│   ├── middleware/
│   │   ├── auth.js             ← API key validation
│   │   ├── rateLimiter.js      ← Redis-based rate limiting
│   │   └── logger.js           ← JSON request logging
│   ├── proxy/
│   │   ├── engine.js           ← undici upstream caller
│   │   ├── requestTransform.js ← transform consumer request → NVIDIA format
│   │   └── responseTransform.js← transform NVIDIA response → consumer format
│   ├── routes/
│   │   ├── v1/
│   │   │   ├── chat.js
│   │   │   ├── embeddings.js
│   │   │   └── completions.js
│   │   ├── health.js
│   │   └── admin/
│   │       ├── keys.js         ← CRUD API key
│   │       └── stats.js        ← usage stats
│   ├── models/
│   │   ├── apiKey.js           ← PostgreSQL queries
│   │   └── usageLog.js
│   └── utils/
│       ├── keyGenerator.js     ← generate gw_* keys
│       └── errors.js           ← error format factory
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── package.json
```


---

## 5. API Contract

### 5.1 Consumer Endpoints

#### POST /v1/chat
Chat completion — kompatibel dengan format OpenAI.

**Request:**
```http
POST /v1/chat
Authorization: Bearer gw_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "model": "chat-pro",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Explain quantum computing in simple terms." }
  ],
  "temperature": 0.7,
  "max_tokens": 512
}
```

**Response (200 OK):**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1722153600,
  "model": "chat-pro",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Quantum computing uses qubits instead of classical bits..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 120,
    "total_tokens": 145
  }
}
```

> ⚠️ Field `model` di response wajib menggunakan nama internal kita (`chat-pro`), bukan nama model NVIDIA.

---

#### POST /v1/embeddings
Generate text embeddings.

**Request:**
```http
POST /v1/embeddings
Authorization: Bearer gw_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "model": "embed-standard",
  "input": "The quick brown fox jumps over the lazy dog"
}
```

**Response (200 OK):**
```json
{
  "object": "list",
  "model": "embed-standard",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023, -0.0091, 0.0142, ...]
    }
  ],
  "usage": {
    "prompt_tokens": 9,
    "total_tokens": 9
  }
}
```

---

#### POST /v1/completions
Text completion (non-chat).

**Request:**
```http
POST /v1/completions
Authorization: Bearer gw_xxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "model": "complete-fast",
  "prompt": "Once upon a time",
  "max_tokens": 100,
  "temperature": 0.8
}
```

**Response (200 OK):**
```json
{
  "id": "cmpl-xyz789",
  "object": "text_completion",
  "created": 1722153600,
  "model": "complete-fast",
  "choices": [
    {
      "text": ", in a land far away...",
      "index": 0,
      "finish_reason": "length"
    }
  ],
  "usage": {
    "prompt_tokens": 4,
    "completion_tokens": 100,
    "total_tokens": 104
  }
}
```

---

#### GET /health
Basic health check.

```http
GET /health

200 OK
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0"
}
```

#### GET /health/deep
Deep health check — cek semua dependency.

```http
GET /health/deep

200 OK
{
  "status": "ok",
  "components": {
    "redis": { "status": "ok", "latency_ms": 2 },
    "upstream": { "status": "ok", "latency_ms": 145 },
    "database": { "status": "ok", "latency_ms": 5 }
  }
}

503 Service Unavailable (jika salah satu komponen gagal)
{
  "status": "degraded",
  "components": {
    "redis": { "status": "error", "error": "Connection refused" },
    "upstream": { "status": "ok", "latency_ms": 145 },
    "database": { "status": "ok", "latency_ms": 5 }
  }
}
```

---

### 5.2 Admin Endpoints

> Semua admin endpoint butuh `Authorization: Bearer <admin-token>` (token berbeda dari consumer key).

#### POST /admin/keys — Buat API key baru
```http
POST /admin/keys
Authorization: Bearer <admin-token>

{
  "name": "Tim Produk - Fitur Chat",
  "tier": "standard",
  "rate_limit_rpm": 120
}

201 Created
{
  "id": "key_01j5kx...",
  "key": "gw_a1b2c3d4e5f6g7h8",
  "name": "Tim Produk - Fitur Chat",
  "tier": "standard",
  "rate_limit_rpm": 120,
  "created_at": "2026-08-28T07:00:00Z"
}
```

> ⚠️ `key` hanya dikembalikan sekali saat create. Setelah itu tidak bisa dilihat lagi (hashed di DB).

#### GET /admin/keys — List semua API key
```http
GET /admin/keys
Authorization: Bearer <admin-token>

200 OK
{
  "data": [
    {
      "id": "key_01j5kx...",
      "name": "Tim Produk - Fitur Chat",
      "tier": "standard",
      "rate_limit_rpm": 120,
      "is_active": true,
      "created_at": "2026-08-28T07:00:00Z",
      "last_used_at": "2026-08-28T07:15:00Z"
    }
  ],
  "total": 1
}
```

#### DELETE /admin/keys/:id — Revoke API key
```http
DELETE /admin/keys/key_01j5kx...
Authorization: Bearer <admin-token>

204 No Content
```

#### GET /admin/stats — Usage stats
```http
GET /admin/stats?from=2026-08-01&to=2026-08-28&key_id=key_01j5kx...

200 OK
{
  "period": { "from": "2026-08-01", "to": "2026-08-28" },
  "total_requests": 1520,
  "total_tokens": 384000,
  "by_route": {
    "/v1/chat": { "requests": 1200, "tokens": 320000 },
    "/v1/embeddings": { "requests": 300, "tokens": 60000 },
    "/v1/completions": { "requests": 20, "tokens": 4000 }
  },
  "error_rate": 0.012,
  "avg_latency_ms": 234
}
```

---

### 5.3 Response Headers (Consumer-facing)

| Header | Value | Keterangan |
|--------|-------|------------|
| `X-RateLimit-Limit` | `60` | Max request per menit |
| `X-RateLimit-Remaining` | `45` | Sisa request di window ini |
| `X-RateLimit-Reset` | Unix timestamp | Kapan counter reset |
| `X-Request-Id` | UUID | ID unik per request (untuk debug) |
| `Content-Type` | `application/json` | Always JSON |

**Header yang wajib di-strip dari NVIDIA response (tidak boleh sampai ke consumer):**
```
x-nvidia-*
x-nvcf-*
x-envoy-*
server: nginx  (replace dengan generic)
via:
x-powered-by:
```


---

## 6. Data Model

### 6.1 PostgreSQL Schema

```sql
-- API Keys table
CREATE TABLE api_keys (
  id            TEXT PRIMARY KEY DEFAULT gen_ulid(),
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,   -- bcrypt hash, raw key tidak disimpan
  key_prefix    TEXT NOT NULL,          -- 8 char pertama untuk identifikasi (gw_a1b2c3d4)
  tier          TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','standard','premium')),
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active);

-- Usage logs table
CREATE TABLE usage_logs (
  id            BIGSERIAL PRIMARY KEY,
  api_key_id    TEXT NOT NULL REFERENCES api_keys(id),
  route         TEXT NOT NULL,          -- '/v1/chat', '/v1/embeddings', dll
  method        TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  latency_ms    INTEGER NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens  INTEGER,
  error_code    TEXT,                   -- null jika sukses
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usage_logs_api_key_id ON usage_logs(api_key_id);
CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at DESC);
CREATE INDEX idx_usage_logs_route ON usage_logs(route);

-- Admin tokens table
CREATE TABLE admin_tokens (
  id            TEXT PRIMARY KEY DEFAULT gen_ulid(),
  token_hash    TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.2 Redis Schema

```
# Rate limit counter per API key (sliding window per menit)
Key:   ratelimit:{api_key_id}:{window_minute}
Type:  String (integer counter)
TTL:   120 detik (2x window, untuk cleanup otomatis)
Value: jumlah request dalam window ini

Contoh:
  ratelimit:key_01j5kx:1722153600  →  "45"

# API key cache (hindari hit DB setiap request)
Key:   apikey:cache:{key_hash}
Type:  Hash
TTL:   300 detik (5 menit)
Value: { id, tier, rate_limit_rpm, is_active }
```

### 6.3 Config Files

**routes.json** — mapping route internal → NVIDIA endpoint:
```json
{
  "/v1/chat": {
    "upstream": "https://integrate.api.nvidia.com/v1/chat/completions",
    "method": "POST",
    "timeout_ms": 30000
  },
  "/v1/embeddings": {
    "upstream": "https://integrate.api.nvidia.com/v1/embeddings",
    "method": "POST",
    "timeout_ms": 10000
  },
  "/v1/completions": {
    "upstream": "https://integrate.api.nvidia.com/v1/completions",
    "method": "POST",
    "timeout_ms": 30000
  }
}
```

**models.json** — mapping model name internal → NVIDIA model ID:
```json
{
  "chat-pro":      "meta/llama-3.1-70b-instruct",
  "chat-fast":     "meta/llama-3.1-8b-instruct",
  "embed-standard":"nvidia/nv-embedqa-e5-v5",
  "complete-fast": "mistralai/mixtral-8x7b-instruct-v0.1"
}
```

**tiers.json** — rate limit per tier:
```json
{
  "free":     { "rpm": 10,  "daily_limit": 100 },
  "standard": { "rpm": 60,  "daily_limit": 1000 },
  "premium":  { "rpm": 300, "daily_limit": 10000 }
}
```

---

## 7. Error Handling

### 7.1 Error Response Format (Semua Error)

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "You have exceeded the rate limit. Please retry after 45 seconds.",
    "type": "rate_limit_error",
    "request_id": "req_01j5kxabc123"
  }
}
```

> ⚠️ Format ini konsisten untuk semua error — tidak ada error message yang mengandung kata nvidia, nim, nvcf, atau nama model internal NVIDIA.

### 7.2 Error Code Registry

| HTTP Status | Error Code | Trigger |
|-------------|------------|---------|
| 400 | `INVALID_REQUEST` | Body tidak valid, field required missing |
| 400 | `INVALID_MODEL` | Model name tidak dikenal di models.json |
| 401 | `UNAUTHORIZED` | Tidak ada Authorization header |
| 401 | `INVALID_API_KEY` | API key tidak ditemukan atau sudah direvoke |
| 404 | `ROUTE_NOT_FOUND` | Route tidak ada di routes.json |
| 429 | `RATE_LIMIT_EXCEEDED` | Melebihi RPM limit |
| 500 | `INTERNAL_ERROR` | Unexpected error di gateway |
| 502 | `UPSTREAM_ERROR` | NVIDIA return error (4xx/5xx) |
| 504 | `UPSTREAM_TIMEOUT` | NVIDIA tidak response dalam timeout window |

### 7.3 NVIDIA Error Translation

Jika NVIDIA return error, gateway wajib translate sebelum kirim ke consumer:

```js
// responseTransform.js — translateUpstreamError()
function translateUpstreamError(nvidiaError, requestId) {
  // Hapus semua referensi vendor dari error message
  const cleanMessage = sanitizeVendorReferences(nvidiaError.message)

  return {
    error: {
      code: mapNvidiaErrorCode(nvidiaError.status),
      message: cleanMessage,
      type: 'upstream_error',
      request_id: requestId
    }
  }
}

// Kata-kata yang wajib di-sanitize dari error message
const VENDOR_TERMS = ['nvidia', 'nim', 'nvcf', 'nvapi', 'nv-', 'meta/llama', 'mistralai']
```


---

## 8. Security Design

### 8.1 Threat Model

| Ancaman | Vector | Mitigasi |
|---------|--------|----------|
| API key NVIDIA bocor ke consumer | Response header/body | Strip semua NVIDIA header, sanitize response body |
| Brute force API key | Auth endpoint | Rate limit per IP (10 req/menit untuk request dengan key invalid) |
| API key consumer dicuri | Penyimpanan client | Key hanya ditampilkan sekali saat create, setelah itu hashed di DB |
| Header injection dari consumer | Request ke upstream | Whitelist header yang diteruskan, strip sisanya |
| Log leak identifier vendor | stdout logs | Logger tidak catat raw response body, hanya metadata |
| Redis bypass rate limit | Jika Redis down | Fail-closed: blok semua request jika Redis tidak reachable |
| Admin endpoint diakses consumer | Routing | Admin routes di-protect dengan token berbeda, prefix `/admin/*` |

### 8.2 Header Forwarding Whitelist

Hanya header berikut yang diteruskan dari consumer request ke NVIDIA:

```
content-type
accept
accept-encoding (hanya gzip, deflate)
```

Semua header lain di-drop. Header yang ditambahkan gateway ke upstream:
```
authorization: Bearer <NVIDIA_API_KEY>   ← dari env var, bukan dari consumer
x-request-id: <generated-uuid>
```

### 8.3 API Key Security

```
Generate:  crypto.randomBytes(24).toString('hex') → gw_ prefix
Store:     bcrypt hash (rounds: 12) di kolom key_hash
Display:   Raw key hanya sekali saat POST /admin/keys response
Validate:  bcrypt.compare(rawKey, storedHash) per request
Cache:     Redis cache hasil validasi 5 menit (key: apikey:cache:{key_hash})
Revoke:    Set is_active=false + delete Redis cache entry
```

### 8.4 Environment Variables (Wajib)

```bash
# .env.example

# Server
PORT=3000
NODE_ENV=production

# NVIDIA — TIDAK BOLEH di-log atau dikembalikan ke consumer
NVIDIA_API_KEY=nvapi-xxxxxxxxxxxxxxxxxxxx
NVIDIA_BASE_URL=https://integrate.api.nvidia.com

# Database
DATABASE_URL=postgresql://user:pass@host:5432/gateway

# Redis
REDIS_URL=redis://host:6379

# Admin
ADMIN_SECRET=changeme-use-strong-secret-in-production

# Security
BCRYPT_ROUNDS=12
API_KEY_PREFIX=gw_

# Observability
LOG_LEVEL=info
```

> ⚠️ `NVIDIA_API_KEY` dan `ADMIN_SECRET` wajib disimpan di secret manager (Vault, AWS Secrets Manager, dll) di production — jangan pernah di-commit ke repo.

---

## 9. Logging Design

### 9.1 Log Format (JSON stdout)

Setiap request menghasilkan satu log line:

```json
{
  "timestamp": "2026-08-28T07:15:32.451Z",
  "level": "info",
  "event": "request",
  "request_id": "req_01j5kxabc123",
  "api_key_id": "key_01j5kx...",
  "api_key_prefix": "gw_a1b2c3",
  "route": "/v1/chat",
  "method": "POST",
  "status_code": 200,
  "latency_ms": 234,
  "prompt_tokens": 25,
  "completion_tokens": 120,
  "total_tokens": 145,
  "upstream_status": 200,
  "upstream_latency_ms": 189
}
```

**Yang TIDAK boleh di-log:**
- Raw request body (bisa mengandung data sensitif user)
- Raw response body
- API key consumer (raw atau hash)
- NVIDIA API key
- Kata-kata: nvidia, nim, nvcf dalam nilai field

### 9.2 Log Levels

| Level | Kapan digunakan |
|-------|-----------------|
| `info` | Setiap request sukses (2xx) |
| `warn` | Rate limit hit (429), invalid key (401) |
| `error` | Upstream error (502/504), internal error (500) |
| `debug` | Hanya di development — detail transform, cache hit/miss |

### 9.3 Error Log Format

```json
{
  "timestamp": "2026-08-28T07:15:32.451Z",
  "level": "error",
  "event": "upstream_error",
  "request_id": "req_01j5kxabc123",
  "api_key_id": "key_01j5kx...",
  "route": "/v1/chat",
  "status_code": 502,
  "error_code": "UPSTREAM_ERROR",
  "upstream_status": 503,
  "upstream_latency_ms": 5000,
  "message": "Upstream service returned 503"
}
```


---

## 10. Graceful Degradation Strategy

| Kondisi | Behavior | Recovery |
|---------|----------|----------|
| Redis down | Fail-closed: semua request diblok dengan `503` + pesan "Service temporarily unavailable" | Auto-recover saat Redis kembali online |
| PostgreSQL down | Auth gagal (tidak bisa validasi key) → `503`. Log tetap ke stdout | Auto-recover saat DB kembali |
| NVIDIA timeout (>30s) | Return `504 UPSTREAM_TIMEOUT` ke consumer | Retry logic: 1x retry dengan backoff 500ms |
| NVIDIA return 5xx | Return `502 UPSTREAM_ERROR` ke consumer (error message di-sanitize) | Tidak retry (upstream problem) |
| Redis cache miss | Fallback ke PostgreSQL query langsung | Cache di-populate kembali setelah hit DB |
| Config file corrupt | Fail on startup — gateway tidak start tanpa config valid | Fix config, restart |

---

## 11. Design Decisions & Rationale

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| HTTP framework | Fastify (bukan Express) | 2-3x lebih cepat, built-in schema validation, TypeScript support |
| HTTP client ke upstream | undici (bukan axios/node-fetch) | Native Node.js, low overhead, connection pooling built-in |
| Rate limit storage | Redis (bukan in-memory) | In-memory hilang saat restart, tidak bisa scale horizontal |
| API key hashing | bcrypt rounds 12 | Balance security vs performance. rounds 10 terlalu cepat, 14 terlalu lambat |
| Response transform | Per-field mapping (bukan regex scrub) | Regex scrub rapuh dan bisa false positive. Field mapping lebih predictable |
| Config format | JSON (bukan hardcoded) | Bisa ganti provider tanpa redeploy — ini requirement utama |
| Log format | JSON stdout | Mudah di-ingest ke Loki/ELK/CloudWatch tanpa parser custom |
| Error format | Flat object `{ error: { code, message, type } }` | OpenAI-compatible, familiar bagi developer consumer |
| Admin auth | Separate token (bukan same consumer key) | Separation of privilege — consumer tidak bisa akses admin endpoint |

---

## 12. Definition of Done — Security Checklist

Sebelum setiap deploy, run checklist ini:

**Vendor Identity Leak**
- [ ] `curl -i POST /v1/chat` → tidak ada `x-nvidia-*` di response header
- [ ] Response body field `model` berisi nama internal, bukan NVIDIA model ID
- [ ] Error message tidak mengandung: nvidia, nim, nvcf, nvapi, meta/llama, mistralai
- [ ] `GET /health/deep` tidak expose URL NVIDIA di response body
- [ ] Log stdout tidak ada nilai yang mengandung NVIDIA identifier

**Auth & Access Control**
- [ ] Request tanpa header → `401`
- [ ] Request dengan key yang di-revoke → `401`
- [ ] Consumer key tidak bisa akses `/admin/*` → `401`
- [ ] NVIDIA_API_KEY tidak muncul di log, response, atau error message

**Rate Limiting**
- [ ] Setelah N+1 request (N = limit) → `429` dengan `Retry-After` header
- [ ] Counter reset setelah 1 menit
- [ ] Counter persist across gateway restart (Redis)

**Reliability**
- [ ] NVIDIA down → `502`, bukan panic/unhandled error
- [ ] Redis down → `503`, bukan bypass rate limit
- [ ] Invalid JSON body → `400 INVALID_REQUEST`

---

## 13. Future Considerations (Sprint 5+)

| Fitur | Deskripsi | Complexity |
|-------|-----------|------------|
| Streaming support | SSE / chunked transfer untuk chat response | High |
| Multi-provider fallback | Jika NVIDIA down, fallback ke OpenAI atau Groq | High |
| Cost tracking | Hitung biaya per request berdasarkan token count × harga provider | Medium |
| Self-serve key portal | UI sederhana untuk consumer request API key sendiri | Medium |
| Webhook quota alert | Notifikasi saat consumer hampir habis quota harian | Low |
| SDK wrapper | JS/Python SDK yang wraps HTTP call ke gateway | Medium |
| Request caching | Cache response untuk identical request (embedding khususnya) | Medium |
| Grafana dashboard | Visualisasi usage, error rate, latency per route per key | Low |

