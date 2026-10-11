# Project Plan: AI API Gateway

| Field       | Detail                          |
|-------------|----------------------------------|
| Version     | 1.0 — Draft                      |
| Status      | Draft                            |
| Author      | Product Manager Agent            |
| Date        | 2026-08-28                       |
| PRD Ref     | PRD-api-gateway.md               |
| Stack       | Node.js (Fastify) + Redis + PostgreSQL |

---

## 1. Executive Summary

Gateway ini adalah abstraction layer di atas NVIDIA NIM endpoint. Tujuan utama: sembunyikan identitas vendor, berikan single control plane (auth, rate limit, logging), dan buat consumer API tidak perlu tahu atau peduli provider mana yang jalan di belakang.

**Masalah yang diselesaikan:** Vendor identity leak, tidak ada rate limiting, tidak ada audit trail, migration cost tinggi jika ganti provider.

**Target user:** Developer internal, Tech Lead, Product Manager yang butuh visibility usage.

**MVP target:** 4 sprint (8 minggu) — core proxy + auth + rate limit + logging live di staging.

---

## 2. Roadmap

### Now (Sprint 1–2, Minggu 1–4) — MVP Core
- Setup project struktur Fastify + middleware pipeline
- Core proxy ke NVIDIA NIM dengan header stripping
- Autentikasi via API key internal (`gw_*`)
- Rate limiting per key via Redis
- Request/response logging ke stdout (JSON)
- Health check endpoint `/health` dan `/health/deep`

### Next (Sprint 3–4, Minggu 5–8) — Hardening & Admin
- Admin API: CRUD API key, lihat usage stats
- Response transform contract (normalisasi field names)
- Error translation NVIDIA → format internal
- Multi-route support: `/v1/chat`, `/v1/embeddings`, `/v1/completions`
- Usage metrics per API key (PostgreSQL)
- Tier-based rate limit (free / standard / premium)
- Integration test suite (minimal 20 test cases)

### Later (Sprint 5+, Bulan 3+) — Growth & Observability
- Streaming support (SSE / chunked response)
- Dashboard usage (Grafana atau admin UI sederhana)
- Multi-provider support (fallback ke provider lain jika NVIDIA down)
- Cost tracking per request (token count × harga)
- Webhook notifikasi saat quota hampir habis
- SDK wrapper (JavaScript/Python) untuk consumer

---

## 3. Milestone & Deliverables

| #  | Milestone              | Deliverable                                         | Target     | Dependencies              |
|----|------------------------|-----------------------------------------------------|------------|---------------------------|
| M1 | Project Bootstrap      | Repo setup, folder struktur, CI pipeline dasar      | Minggu 1   | —                         |
| M2 | Core Proxy Live        | Proxy request ke NVIDIA, header stripped, route map | Minggu 2   | M1                        |
| M3 | Auth & Rate Limit      | API key auth, Redis rate limit, 429 handling        | Minggu 3   | M2, Redis instance        |
| M4 | Logging & Health Check | JSON logging, `/health`, `/health/deep`             | Minggu 4   | M3                        |
| M5 | MVP Staging Deploy     | Semua M1-M4 live di staging, smoke test pass        | Minggu 4   | M4, staging env ready     |
| M6 | Admin API              | CRUD API key, usage stats endpoint                  | Minggu 6   | M5, PostgreSQL schema     |
| M7 | Transform & Error      | Response normalisasi, error translation             | Minggu 6   | M5                        |
| M8 | Integration Tests      | ≥20 test cases, semua P0 stories covered            | Minggu 7   | M6, M7                    |
| M9 | Production Deploy      | Hardened build live di production                   | Minggu 8   | M8, security review pass  |

---

## 4. Sprint Planning

### Sprint 1 — Project Bootstrap & Core Proxy
**Duration:** 2 minggu (Minggu 1–2)
**Sprint Goal:** Gateway bisa menerima request consumer dan meneruskan ke NVIDIA dengan header stripped.

**User Stories:**
| Story | Description | Points | Priority |
|-------|-------------|--------|----------|
| US-03 | Route request ke NVIDIA endpoint | 5 | P0 |
| US-01 | Proxy tanpa ekspos identitas vendor | 3 | P0 |
| TECH-01 | Setup repo: Fastify, ESLint, folder struktur | 2 | P0 |
| TECH-02 | Dockerfile + docker-compose (app + Redis) | 2 | P0 |
| TECH-03 | CI pipeline (GitHub Actions): lint + test | 2 | P0 |
| TECH-04 | Env config management (.env.example, dotenv) | 1 | P0 |

**Total: 15 points**

**Definition of Done Sprint 1:**
- [ ] `POST /v1/chat` bisa proxy ke NVIDIA, response sampai ke consumer
- [ ] Semua NVIDIA header di-strip dari response
- [ ] Model name di-map ke nama internal (config-driven)
- [ ] Bisa run lokal dengan `docker-compose up`
- [ ] Tidak ada unit test yang failing

**Blockers / Risiko:**
- NVIDIA NIM API key harus sudah tersedia di Sprint 1
- Format request NVIDIA perlu dikonfirmasi (lihat Open Questions OQ-01 di PRD)

---

### Sprint 2 — Auth, Rate Limit, Logging, Health Check
**Duration:** 2 minggu (Minggu 3–4)
**Sprint Goal:** Gateway aman, terkontrol, dan bisa dimonitor. Siap deploy ke staging.

**User Stories:**
| Story | Description | Points | Priority |
|-------|-------------|--------|----------|
| US-02 | Autentikasi consumer via API key internal | 5 | P0 |
| US-04 | Rate limiting per API key via Redis | 5 | P0 |
| US-05 | Logging setiap request & response | 3 | P0 |
| US-06 | Health check endpoint `/health` + `/health/deep` | 2 | P1 |
| TECH-05 | PostgreSQL schema: api_keys, usage_logs | 3 | P0 |
| TECH-06 | Staging deploy + smoke test | 2 | P0 |

**Total: 20 points**

**Definition of Done Sprint 2:**
- [ ] Request tanpa API key valid → `401 Unauthorized`
- [ ] Request melebihi rate limit → `429 Too Many Requests` + `Retry-After` header
- [ ] Setiap request tercatat di stdout (JSON log)
- [ ] `GET /health` return `200 OK`
- [ ] `GET /health/deep` cek Redis dan NVIDIA connectivity
- [ ] Staging environment live dan bisa diakses tim internal
- [ ] Smoke test 5 skenario dasar pass (lihat Test Plan di bawah)


---

### Sprint 3 — Admin API, Transform & Error Handling
**Duration:** 2 minggu (Minggu 5–6)
**Sprint Goal:** Admin punya full control atas API key dan usage. Response consumer konsisten.

**User Stories:**
| Story | Description | Points | Priority |
|-------|-------------|--------|----------|
| US-07 | Admin API: create, list, revoke API key | 5 | P1 |
| US-08 | Response transform + error translation | 5 | P1 |
| US-09 | Usage stats per API key | 3 | P1 |
| TECH-07 | Tier config: free/standard/premium rate limits | 2 | P1 |
| TECH-08 | Route config file (JSON/YAML driven mapping) | 2 | P1 |

**Total: 17 points**

**Definition of Done Sprint 3:**
- [ ] Admin bisa `POST /admin/keys` → terbitkan API key baru
- [ ] Admin bisa `DELETE /admin/keys/:id` → revoke key (request langsung 401)
- [ ] Response body consumer tidak ada kata `nvidia`, `nim`, `nvcf`
- [ ] Error dari NVIDIA di-translate ke format: `{ error: { code, message, type } }`
- [ ] Route mapping bisa diubah via config file tanpa redeploy
- [ ] Unit test coverage ≥ 70% untuk transform & error modules

---

### Sprint 4 — Integration Tests, Security Review & Production Deploy
**Duration:** 2 minggu (Minggu 7–8)
**Sprint Goal:** Gateway production-ready, secure, dan terdokumentasi.

**User Stories:**
| Story | Description | Points | Priority |
|-------|-------------|--------|----------|
| TECH-09 | Integration test suite ≥ 20 test cases | 5 | P0 |
| TECH-10 | Security review: header injection, key leak scan | 3 | P0 |
| TECH-11 | API documentation (OpenAPI/Swagger) | 3 | P1 |
| TECH-12 | Production deploy + runbook | 3 | P0 |
| TECH-13 | Monitoring setup: uptime, error rate alert | 2 | P1 |

**Total: 16 points**

**Definition of Done Sprint 4:**
- [ ] 20+ integration test pass di CI
- [ ] Security checklist: tidak ada NVIDIA identifier bocor di log, header, body
- [ ] OpenAPI spec tersedia di `/docs`
- [ ] Production environment live
- [ ] Alert aktif untuk: error rate >5%, latency P95 >500ms, uptime <99.5%
- [ ] Runbook deploy & rollback terdokumentasi

---

## 5. Resource Planning

### Tim yang Dibutuhkan

| Role | Jumlah | Estimasi Load | Sprint |
|------|--------|---------------|--------|
| Backend Engineer (Node.js) | 1 | Full-time (100%) | Sprint 1–4 |
| DevOps / Infra | 1 | Part-time (30%) | Sprint 2, 4 |
| QA Engineer | 1 | Part-time (50%) | Sprint 3–4 |
| Product Manager | 1 | Part-time (20%) | Sprint 1–4 |
| Tech Lead (review) | 1 | Part-time (10%) | Sprint 2, 4 |

### Estimasi Total Effort

| Sprint | Effort (person-days) | Catatan |
|--------|----------------------|---------|
| Sprint 1 | 10 PD | Backend 10 PD |
| Sprint 2 | 14 PD | Backend 10 PD + DevOps 4 PD |
| Sprint 3 | 12 PD | Backend 10 PD + QA 2 PD |
| Sprint 4 | 14 PD | Backend 8 PD + QA 4 PD + DevOps 2 PD |
| **Total** | **50 PD** | ~8 minggu, 1 Backend Engineer |

### Infrastruktur yang Dibutuhkan

| Komponen | Kebutuhan | Kapan |
|----------|-----------|-------|
| NVIDIA NIM API Key | Wajib sebelum Sprint 1 | Minggu 0 |
| Redis instance | Staging: Sprint 2, Prod: Sprint 4 | Minggu 3 |
| PostgreSQL instance | Staging: Sprint 2, Prod: Sprint 4 | Minggu 3 |
| Domain / subdomain gateway | Wajib sebelum Sprint 2 | Minggu 2 |
| VPS / Cloud instance | Min 2 vCPU, 4GB RAM | Minggu 4 |
| CI/CD pipeline | GitHub Actions atau setara | Minggu 1 |

---

## 6. Risk Management

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R1 | NVIDIA API key tidak tersedia tepat waktu | Medium | High | Minta key di Minggu 0, tidak bisa mulai Sprint 1 tanpa ini |
| R2 | NVIDIA ganti format response tanpa notice | Low | High | Buat transform layer yang fleksibel, monitor changelog NIM |
| R3 | Redis tidak available → rate limit bypass | Low | High | Fallback: jika Redis down, blok semua request sampai Redis pulih |
| R4 | Latency overhead gateway > 150ms | Medium | Medium | Profiling di Sprint 2, gunakan connection pooling, undici |
| R5 | NVIDIA identifier bocor ke consumer | Medium | Critical | Automated test scan response header/body setiap CI run |
| R6 | Backend Engineer tidak familiar Fastify | Low | Medium | Berikan 1 hari onboarding + template project di Sprint 1 |
| R7 | Scope creep — PM minta fitur streaming di MVP | High | Medium | Scope freeze setelah PRD approved, perubahan masuk backlog |
| R8 | Staging environment tidak ready saat Sprint 2 | Medium | Medium | DevOps setup staging environment paralel di Sprint 1 |

---

## 7. Communication Plan

### Ritme Rutin

| Event | Frekuensi | Durasi | Peserta |
|-------|-----------|--------|---------|
| Daily standup | Setiap hari kerja | 15 menit | Backend Eng, PM |
| Sprint planning | Awal tiap sprint | 1 jam | Semua tim |
| Sprint review & demo | Akhir tiap sprint | 45 menit | Semua tim + stakeholder |
| Sprint retrospective | Akhir tiap sprint | 30 menit | Tim inti |
| Stakeholder update | Mingguan (Jumat) | Async (email/Slack) | PM → stakeholder |

### Format Weekly Update (PM → Stakeholder)
```
📅 Week N Update — AI API Gateway

✅ Wins: [top 3 hal yang selesai]
⚠️  Risks/Blockers: [top 3 hambatan]
📊 Key Metrics: [sprint velocity, test pass rate, staging status]
🔜 Next Week: [fokus sprint berikutnya]
❓ Asks: [keputusan/resource yang dibutuhkan dari stakeholder]
```

---

## 8. Launch Plan

### Pre-Launch Checklist (sebelum M9 — Production Deploy)

**Security**
- [ ] Scan response: zero NVIDIA identifier di header & body
- [ ] API key tidak pernah di-log atau muncul di error message
- [ ] Environment variable production tersimpan di secret manager
- [ ] HTTPS enforced, HSTS header aktif
- [ ] Rate limit aktif dan tested

**Reliability**
- [ ] Health check endpoint pass
- [ ] Redis dan PostgreSQL production siap
- [ ] Rollback plan terdokumentasi
- [ ] Load test minimal 100 concurrent request

**Observability**
- [ ] JSON log dikirim ke logging platform
- [ ] Alert aktif: error rate, latency, uptime
- [ ] Runbook tersedia untuk on-call engineer

**Documentation**
- [ ] OpenAPI spec live di `/docs`
- [ ] README lengkap: cara dapat API key, cara konsumsi, rate limit info
- [ ] Postman collection tersedia untuk consumer

### Launch Day Runbook
1. **T-30 menit** — Final health check staging, konfirmasi semua alert aktif
2. **T-0** — Deploy ke production, monitor error rate 15 menit pertama
3. **T+15 menit** — Jika error rate normal (<1%), announce ke tim internal
4. **T+1 jam** — Review log pertama, pastikan tidak ada NVIDIA identifier leak
5. **T+24 jam** — Review usage stats, latency P95, error patterns
6. **T+48 jam** — Post-launch retrospective dengan tim

### Rollback Plan
- Jika error rate >5% dalam 30 menit pertama → rollback ke versi sebelumnya
- Rollback command: `docker-compose down && docker-compose up -d <previous-tag>`
- Max rollback time target: **5 menit**

---

## 9. Test Plan (Smoke Test — Sprint 2)

| # | Skenario | Expected Result |
|---|----------|-----------------|
| T1 | Request tanpa Authorization header | `401 Unauthorized` |
| T2 | Request dengan API key invalid | `401 Unauthorized` |
| T3 | Request valid ke `/v1/chat` | `200 OK`, response tidak ada kata "nvidia" |
| T4 | 61 request dalam 1 menit (rate limit 60) | Request ke-61 → `429 Too Many Requests` |
| T5 | `GET /health` | `200 OK`, body `{ status: "ok" }` |
| T6 | Response header check | Tidak ada `x-nvidia-*`, `x-nvcf-*` header |
| T7 | Invalid route `/v1/unknown` | `404 Not Found`, pesan custom |
| T8 | NVIDIA endpoint simulasi down | Gateway return `502 Bad Gateway`, format custom |

