# Quick Start: Full Stack Engineer Agent

## 🎯 Kapan pakai agent ini?

Gunakan **Full Stack Engineer** untuk:
- Build fitur baru (backend API, frontend UI, mobile screens)
- Fix bugs di codebase
- Refactor/optimize kode
- Code review & audit keamanan
- Setup CI/CD pipeline
- Dockerize aplikasi
- Troubleshoot deployment issues

## 🚀 Contoh Task

### Backend
```
Buat REST API endpoint POST /api/users/register dengan validasi email,
password hashing (bcrypt), dan simpan ke PostgreSQL. Include unit test.
```

### Frontend
```
Buat form registrasi di Next.js dengan validasi client-side (Zod),
responsive design, dan accessibility WCAG AA compliant.
```

### Mobile
```
Buat screen login di React Native dengan biometric authentication
support (Touch ID / Face ID) untuk iOS dan Android.
```

### DevOps
```
Buat Dockerfile multi-stage untuk aplikasi Node.js, optimized untuk
production (minimal layers, non-root user, health check).
```

### Bug Fix
```
User melaporkan query dashboard timeout setelah 30 detik. 
Investigasi dan fix performance issue di endpoint /api/analytics.
```

### Code Review
```
Review file lib/auth.ts — cek security issues, performance, dan
best practices. Kasih rekomendasi improvement.
```

## 📋 Apa yang agent lakukan otomatis?

1. **Membaca kode existing** untuk understand patterns & conventions
2. **Implement solusi** sesuai project style
3. **Menulis test** (unit/integration) untuk kode baru
4. **Menjalankan build + test** untuk verifikasi
5. **Smoke test manual** jika diperlukan
6. **Melaporkan bug** yang ditemukan dengan format terstruktur
7. **Update dokumentasi** jika ada perubahan API/behavior

## 🐛 Format Laporan Bug

Kalau agent menemukan bug, akan muncul report seperti ini:

```
🐛 BUG FOUND: SQL injection vulnerability in search endpoint
Location: app/api/search/route.ts:45
Impact: CRITICAL
Description: User input directly interpolated into raw SQL query
Root cause: Missing parameterized query, using string concatenation
Suggested fix: Use prepared statements with placeholders
```

Bug juga otomatis tersimpan di **shared memory** dengan key `bug:[timestamp]`
sehingga agent lain atau Manager Agent bisa lihat.

## ✅ Final Checklist Agent

Sebelum agent bilang "done", dia WAJIB centang semua ini:
- [ ] Code builds without errors
- [ ] Tests pass (or new tests written and passing)
- [ ] No linter/formatter warnings
- [ ] Manual smoke test completed
- [ ] Bug report filed if issues found
- [ ] Documentation updated if needed
- [ ] Changes follow project conventions

## 🛠️ Tools yang Dipakai Agent

| Tool | Fungsi |
|------|--------|
| `filesystem` | Baca/tulis file kode, config, docs |
| `shell` | Jalankan npm/yarn/pip, build, test, lint |
| `github` | Baca repo, issues, PRs untuk context |
| `gitlab` | Integrasi GitLab penuh via MCP |
| `delegate` | Lempar task ke agent spesialis lain |
| `memory` | Share temuan/bug dengan team |
| `tavily` | Search dokumentasi API, contoh library |
| `env` | Baca environment variables (perlu approval) |

## 💡 Tips Optimasi

### Berikan context yang cukup
❌ "Fix bug di dashboard"
✅ "User melaporkan dashboard /analytics timeout setelah 30 detik ketika filter date range > 3 bulan. Fix performance issue."

### Spesifikasi tech stack jika perlu
❌ "Buat API user registration"
✅ "Buat API user registration pakai Express.js + Prisma ORM + PostgreSQL. Include rate limiting (5 req/min) dan email verification."

### Request explicit test
Meskipun agent default menulis test, kamu bisa eksplisit:
✅ "Buat API endpoint lengkap dengan unit test dan integration test pakai Jest + Supertest."

### Tanya opini teknis
✅ "Review arsitektur microservices kita — apakah perlu API gateway? Trade-off apa yang harus dipertimbangkan?"

## 🔐 Security by Default

Agent secara default akan:
- Validate & sanitize semua user input
- Pakai parameterized queries (tidak string interpolation SQL)
- Hash password dengan bcrypt/argon2
- Set secure HTTP headers (CSP, HSTS, X-Frame-Options)
- Implement rate limiting untuk sensitive endpoints
- Never commit secrets/API keys

Kalau agent perlu akses `.env` file, akan muncul **approval card** di chat.

## 📊 Workflow di Multi-Agent System

### Scenario: Build fitur besar dengan Manager Agent

1. **Kamu** → kirim task ke **Manager Agent**:
   ```
   Build complete user authentication system: registration, login,
   password reset, email verification, JWT token refresh.
   ```

2. **Manager Agent** → breakdown & delegate:
   - Sub-task 1 → **Full Stack Engineer**: buat backend API
   - Sub-task 2 → **Full Stack Engineer**: buat frontend UI
   - Sub-task 3 → **SQL Agent**: design database schema
   - Sub-task 4 → **Full Stack Engineer**: setup email service

3. **Full Stack Engineer** → execute, test, report

4. **Manager Agent** → review semua hasil, compile final report

## 🎨 Tidak Dilakukan oleh Agent Ini

Agent ini fokus di **kode & infrastruktur**. Untuk task lain:
- **Design visual/UI mockup** → delegate ke Designer Agent (jika ada)
- **Konten marketing/copy** → delegate ke Content Creator Agent
- **Data analysis/SQL query kompleks** → delegate ke SQL/Data Agent
- **Video editing** → bukan domain agent ini

Agent akan otomatis delegate jika task di luar scope-nya.

---

**Reputation promise**: *Shipping working, tested, production-ready code.*

Selamat coding! 🚀
