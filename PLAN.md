# PLAN — Agent Platform Desktop

**Terkait:** PRD-desktop.md, PLAN.md (versi web-lokal)
**Last updated:** 2 Juli 2026

---

## Keputusan Teknologi: Electron (bukan Tauri) untuk v1

| Pertimbangan | Electron | Tauri v2 |
|---|---|---|
| Reuse codebase Next.js yang ada | Langsung — main process = Node, bisa jalankan Next standalone | Butuh restrukturisasi; backend Rust atau Node sidecar |
| Spawn MCP subprocess (stdio) | Native — Node `child_process` | Bisa, tapi butuh sidecar/permission model Tauri |
| better-sqlite3 (native module) | Jalan dengan rebuild ABI | Harus pindah ke SQLite via Rust atau sidecar |
| Ukuran bundle | ~100–150 MB | ~10–20 MB |
| Kecepatan sampai rilis v1 | Cepat (migrasi, bukan rewrite) | Lambat (banyak rewrite) |

**Keputusan:** Electron untuk v1 — memaksimalkan reuse semua kode yang
sudah ada (Next.js app, better-sqlite3, MCP client via Node). Tauri
dicatat sebagai kandidat v2 kalau ukuran bundle jadi masalah nyata.

Pola arsitektur:
```
┌───────────────────────────────────────────────┐
│ Electron Main Process (Node)                    │
│  - Next.js standalone server (localhost, port   │
│    acak) — seluruh app & API routes yang ada    │
│  - Config service (electron-store + safeStorage)│
│  - MCP subprocess spawning (pakai Node internal) │
│  - Native dialogs (folder picker)                │
└──────────────┬──────────────────────────────────┘
               │ loadURL(http://localhost:<port>)
┌──────────────▼──────────────────────────────────┐
│ Electron Renderer (BrowserWindow)                │
│  - UI Next.js yang sudah ada + halaman Settings  │
└──────────────────────────────────────────────────┘
```

---

## Fase A — Migrasi ke Shell Electron

Tujuan: app yang sekarang jalan identik di dalam window Electron,
masih pakai `.env` dulu (Settings UI menyusul di Fase B).

- [ ] Setup Electron main process: jalankan Next.js standalone build di
      port acak lokal, buka BrowserWindow ke port itu
- [ ] Pindahkan lokasi `DATABASE_PATH` ke data dir OS
      (`app.getPath("userData")/data/app.db`)
- [ ] Rebuild `better-sqlite3` terhadap ABI Electron
      (`electron-rebuild`) dan pastikan CRUD agent jalan
- [ ] Ganti semua pemanggilan MCP `npx ...` menjadi spawn langsung ke
      package yang dibundel: `process.execPath` + `ELECTRON_RUN_AS_NODE=1`
      + path ke `node_modules/@modelcontextprotocol/server-*/dist/index.js`
      — menghilangkan dependency npm/npx eksternal
- [ ] Smoke test dev mode di ketiga OS (cukup Linux + satu OS lain dulu
      kalau akses hardware terbatas; sisanya via CI di Fase D)

**Definition of done:** app terbuka sebagai window desktop, semua fitur
lama jalan, data tersimpan di data dir OS.

**Estimasi:** 3–5 hari.

---

## Fase B — Config Service & Settings UI

Tujuan: `.env` pensiun total; semua konfigurasi lewat UI.

### B.1 Config service (fondasi)
- [ ] Definisikan skema config terpusat:
      `{ ai: { baseUrl, model }, gitlab: { apiUrl }, filesystem: { allowedDirs[] } }`
      di electron-store (JSON di userData)
- [ ] Rahasia (API key AI, PAT GitHub, PAT GitLab) via `safeStorage`
      Electron (Keychain/DPAPI/libsecret) — dengan fallback file
      terenkripsi + warning kalau libsecret tidak tersedia (Linux)
- [ ] Refactor semua pembacaan `process.env.*` di `lib/` menjadi
      pembacaan dari config service (satu modul `lib/config.ts` sebagai
      satu-satunya pintu)
- [ ] Mekanisme reload: perubahan config AI langsung dipakai chat
      berikutnya; perubahan token/dirs me-restart MCP client terkait

### B.2 Halaman Settings
- [ ] Settings → AI Provider: base URL, API key, model default,
      tombol **Test connection** (1 request kecil, tampilkan error
      yang manusiawi)
- [ ] Settings → GitHub: PAT, Test connection, tombol hapus token,
      link dokumentasi scope minimal
- [ ] Settings → GitLab: PAT + API URL, Test connection, hapus token
- [ ] Settings → Filesystem: daftar folder + tombol "Add folder"
      (dialog native `dialog.showOpenDialog`), hapus per folder
- [ ] Status per tool di form builder agent sekarang membaca config
      service (bukan env) untuk menentukan configured/not

### B.3 First-run onboarding
- [ ] Deteksi first run (data dir kosong) → wizard: API key AI (wajib,
      dengan test), GitHub/GitLab (skippable), folder (skippable),
      selesai → jalankan seed agent contoh otomatis

**Definition of done:** instalasi baru bisa dikonfigurasi 100% dari UI
sampai chat pertama sukses; tidak ada lagi kode yang membaca `.env`.

**Estimasi:** 1–1,5 minggu.

---

## Fase C — MCP Tanpa Docker & Bundling Dependency

Tujuan: hilangkan semua asumsi dependency eksternal.

- [ ] **GitHub MCP:** ganti Docker dengan salah satu dari:
      (a) binary Go `github-mcp-server` per platform — diunduh saat
      first-run ke data dir (checksum diverifikasi), atau dibundel di
      installer; atau (b) endpoint remote resmi GitHub MCP (streamable
      HTTP) kalau tersedia stabil — pilih (a) sebagai default karena
      konsisten local-first
- [ ] **GitLab & Filesystem MCP:** sudah Node-based — pastikan dibundel
      sebagai dependency production dan di-spawn dengan Node internal
      Electron (lanjutan kerjaan Fase A)
- [ ] Health check tiap MCP server saat start + tampilkan status di
      halaman Settings/Tools (hijau/merah + pesan error)
- [ ] Uji ketiga tool end-to-end di build ter-install (bukan dev mode)

**Definition of done:** mesin bersih tanpa Node/Docker/npm bisa
menjalankan ketiga tool MCP.

**Estimasi:** 4–6 hari (paling banyak riset di butir GitHub binary).

---

## Fase D — Packaging & Distribusi

Tujuan: installer nyata di tiga OS, build berulang lewat CI.

- [ ] Konfigurasi `electron-builder`:
      - Linux: AppImage + deb (x64)
      - macOS: dmg (universal atau x64+arm64 terpisah)
      - Windows: NSIS exe (x64)
- [ ] Pastikan rebuild native module masuk pipeline build
- [ ] CI (GitHub Actions) matrix build 3 OS → artifact ke GitHub Releases
- [ ] Dokumentasi install per OS di README rilis, termasuk cara melewati
      warning "unidentified developer" (macOS) / SmartScreen (Windows)
      karena build belum di-sign
- [ ] Uji install → onboarding → chat pertama di mesin/VM bersih per OS

**Definition of done:** siapa pun bisa unduh installer dari Releases dan
sampai chat pertama tanpa bantuan.

**Estimasi:** 4–6 hari (di luar antri debugging CI lintas OS yang
biasanya makan waktu ekstra).

---

## Fase E — Polish (backlog, evaluasi setelah rilis pertama)

- [ ] Auto-update (electron-updater + GitHub Releases)
- [ ] Code signing & notarization (butuh Apple Developer $99/th +
      sertifikat Windows) — baru layak kalau dipakai orang lain
- [ ] System tray + start minimized
- [ ] Export/import seluruh data dir (backup 1 klik)
- [ ] Evaluasi migrasi Tauri kalau ukuran bundle terbukti jadi keluhan

---

## Urutan Kerja

```
Fase A (shell Electron, 3–5 hari)
   │
   ▼
Fase B (config service + Settings UI, 1–1,5 minggu)
   │
   ▼
Fase C (MCP tanpa Docker, 4–6 hari)   ← bisa paralel sebagian dengan B
   │
   ▼
Fase D (packaging + CI, 4–6 hari)
   │
   ▼
Rilis v1 → pakai harian → Fase E sesuai kebutuhan nyata
```

Total estimasi kasar sampai rilis v1: **±4–5 minggu** ritme side project.

## Catatan Prioritas

- **Fase A jangan dilewati dengan menggabungkan ke B.** Memastikan app
  lama jalan utuh di Electron dulu (masih pakai env) memisahkan masalah
  "runtime desktop" dari masalah "config UI" — kalau digabung, debugging
  jadi tebak-tebakan dua variabel sekaligus.
- Item paling berisiko adalah **GitHub MCP tanpa Docker** (Fase C) —
  kalau ternyata mentok, fallback sementara yang jujur: fitur GitHub
  ditandai "butuh Docker" di Settings, sambil GitLab & Filesystem tetap
  jalan penuh. Jangan biarkan satu tool memblokir rilis.
- Validasi runtime dari PLAN.md versi web (Fase 1.1 — delegasi, shared
  memory, skills) tetap harus dilakukan; paling efisien digabung ke
  smoke test Fase A karena kode fiturnya sama persis.
