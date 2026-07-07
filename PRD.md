# PRD — Agent Platform Desktop

**Status:** Draft v1
**Owner:** Nizar
**Last updated:** 2 Juli 2026
**Relasi dokumen:** Ini evolusi dari PRD.md (v2) Agent Platform versi
web-lokal. Semua fitur inti (custom agent, tools MCP, delegasi, shared
memory, skills) tetap berlaku — dokumen ini fokus ke perubahan yang
dibutuhkan supaya aplikasi bisa **diinstall seperti aplikasi desktop
biasa** di Linux, macOS, dan Windows, dengan **semua konfigurasi lewat
UI** (bukan file `.env`).

---

## 1. Latar Belakang & Masalah

Versi sekarang jalan sebagai project Next.js yang harus dijalankan manual
(`npm install`, isi `.env`, `npm run dev`). Ini oke buat Nizar sendiri,
tapi bertentangan dengan tujuan "general purpose untuk non-engineer" di
PRD sebelumnya:

- Non-engineer tidak bisa (dan tidak seharusnya perlu) install Node.js,
  edit file `.env`, atau paham apa itu PAT scope.
- Konfigurasi lewat `.env` berarti API key & token tersimpan plain text
  di file — tidak ada penyimpanan aman, dan salah edit bikin app mati
  tanpa pesan error yang jelas.
- Tidak ada cara distribusi: "kirim zip terus suruh npm install" bukan
  distribusi.
- Ketergantungan Docker (untuk GitHub MCP server) adalah blocker besar —
  tidak realistis menyuruh pengguna umum install Docker.

## 2. Tujuan (Goals)

1. Aplikasi bisa **diinstall dengan installer standar** di tiga OS:
   - Linux: `.AppImage` dan `.deb`
   - macOS: `.dmg`
   - Windows: `.exe` (NSIS installer)
2. **Semua konfigurasi lewat UI Settings**, tanpa menyentuh file:
   - **AI model/provider:** base URL (Anthropic langsung atau gateway
     seperti Genfity), API key, model default, dan override model per
     agent.
   - **GitHub:** Personal Access Token.
   - **GitLab:** Personal Access Token + API URL (mendukung gitlab.com
     maupun self-hosted).
   - **Filesystem:** pilih folder yang diizinkan lewat dialog folder
     native OS (bukan ketik path manual).
3. **Token & API key disimpan aman** memakai fasilitas OS (Keychain di
   macOS, Credential Manager/DPAPI di Windows, libsecret di Linux) —
   bukan plain text.
4. **Zero dependency eksternal** saat runtime: tidak butuh Node.js
   terinstall, tidak butuh Docker, tidak butuh npm. Semua yang dibutuhkan
   dibundel dalam installer.
5. **First-run onboarding:** saat pertama dibuka, user dituntun mengisi
   minimal API key AI supaya app langsung bisa dipakai.
6. Semua fitur platform yang sudah ada tetap jalan: custom agent, tools
   GitHub/GitLab/Filesystem, delegasi antar agent, shared memory, skills.

## 3. Non-Goals (di luar scope versi ini)

- Tidak masuk app store (Mac App Store, Microsoft Store, Snap/Flathub) —
  distribusi cukup lewat file installer (mis. GitHub Releases).
- Tidak ada auto-update pada rilis pertama (dievaluasi di fase lanjut).
- Tidak ada code signing/notarization pada rilis pertama (berbayar dan
  butuh akun developer) — konsekuensinya ada warning "unidentified
  developer" saat install; didokumentasikan cara bypass-nya.
- Tidak ada versi mobile.
- Tetap single-user, tanpa sinkronisasi antar device.
- Tidak menyediakan LLM lokal (Ollama dsb.) — model tetap via API, tapi
  karena base URL bisa dikonfigurasi, user yang paham bisa mengarahkan ke
  endpoint OpenAI-compatible/Anthropic-compatible lokal sendiri.

## 4. Target Pengguna

- **Primer:** Nizar — pemakaian harian untuk kerjaan engineering.
- **Sekunder (naik prioritas dibanding PRD sebelumnya):** pengguna
  non-engineer yang mau pakai agent custom — sekarang benar-benar bisa,
  karena install = klik installer, konfigurasi = isi form di Settings.

## 5. User Stories

| # | Sebagai... | Saya ingin... | Supaya... |
|---|---|---|---|
| 1 | User baru | menginstall aplikasi dengan double-click installer | tidak perlu paham Node.js/terminal |
| 2 | User baru | dituntun mengisi API key saat pertama buka app | app langsung bisa dipakai tanpa baca dokumentasi |
| 3 | User | mengatur base URL + API key + model AI dari Settings | bisa pakai Anthropic langsung, Genfity gateway, atau endpoint compatible lain |
| 4 | User | mengganti model default tanpa restart app | eksperimen model cepat |
| 5 | User | memasukkan token GitHub/GitLab di Settings dan menekan "Test connection" | tahu langsung config-nya benar atau salah |
| 6 | User | menambahkan GitLab self-hosted lewat URL custom | repo kantor (self-hosted) bisa diakses |
| 7 | User | memilih folder yang boleh diakses agent lewat dialog folder biasa | tidak salah ketik path, dan sadar persis folder mana yang dibuka aksesnya |
| 8 | User | token saya tersimpan di penyimpanan aman OS | tidak ada credential plain text di disk |
| 9 | User | data saya (agent, memory, skills, chat) tetap ada setelah update/reinstall | tidak kehilangan setup yang sudah dibangun |
| 10 | User | menghapus token/API key dari Settings | bisa cabut akses kapan pun |

## 6. Fitur (Functional Requirements)

### 6.1 Instalasi & Runtime
- Installer per OS: `.AppImage` + `.deb` (Linux x64), `.dmg` (macOS,
  Intel & Apple Silicon), `.exe` NSIS (Windows x64).
- Aplikasi membundel runtime sendiri — user tidak perlu install apa pun
  selain aplikasi ini.
- Data user (SQLite DB, config) disimpan di direktori data standar OS
  (`~/.config`/`AppData`/`Application Support`), terpisah dari folder
  instalasi — aman dari update/reinstall.

### 6.2 Settings — AI Provider
- Field: Base URL (default `https://api.anthropic.com`), API key, model
  default (dropdown + input bebas untuk model custom via gateway).
- Tombol **Test connection** — kirim satu request kecil, tampilkan
  sukses/gagal beserta pesan error yang bisa dimengerti manusia.
- Perubahan berlaku langsung ke chat berikutnya, tanpa restart.

### 6.3 Settings — GitHub & GitLab
- GitHub: field PAT + Test connection + link cara membuat PAT dengan
  scope minimal (read-only).
- GitLab: field PAT + API URL (default `https://gitlab.com/api/v4`) +
  Test connection. Mendukung lebih dari satu konfigurasi tidak wajib di
  v1 (cukup satu GitHub + satu GitLab).
- Tombol hapus token per layanan.

### 6.4 Settings — Filesystem
- Daftar folder yang diizinkan, ditambah lewat dialog folder native OS.
- Tiap folder bisa dihapus dari daftar kapan pun.
- Indikasi jelas di UI bahwa agent dengan tool filesystem hanya bisa
  mengakses folder-folder di daftar ini.

### 6.5 First-run Onboarding
- Wizard singkat saat data dir masih kosong: (1) isi API key AI +
  test, (2) opsional: GitHub/GitLab token, (3) opsional: pilih folder,
  (4) selesai → dibuatkan agent contoh (seed) otomatis.
- Semua langkah kecuali API key bisa di-skip.

### 6.6 Penyimpanan Aman
- API key & token disimpan lewat keychain/credential store OS.
- Config non-rahasia (base URL, model default, daftar folder) disimpan
  sebagai JSON di data dir.
- Tidak ada credential yang pernah ditulis ke log atau dikirim ke
  system prompt.

### 6.7 Fitur Platform yang Dibawa Serta (tanpa perubahan perilaku)
- Custom agent (CRUD via UI), tools MCP (GitHub, GitLab, Filesystem),
  delegasi antar agent + depth limit, shared memory + halaman audit,
  skill library, riwayat percakapan — semua sesuai PRD.md v2.
- Satu perubahan teknis penting: **GitHub MCP tidak lagi lewat Docker**
  (lihat PLAN — diganti binary native per platform yang dibundel/diunduh),
  karena Docker bukan dependency yang bisa diasumsikan ada.

## 7. Non-Functional Requirements

- **Ukuran installer** wajar untuk app desktop berbasis web-runtime
  (target < 150 MB per platform).
- **Cold start** < 5 detik di hardware umum.
- **Tanpa network saat idle** — network hanya dipakai saat memanggil
  LLM API atau MCP GitHub/GitLab; tidak ada telemetry.
- **Data portabel:** seluruh state user = 1 folder data (DB + config) —
  gampang di-backup manual.
- **Kegagalan konfigurasi harus ramah:** API key salah/model tidak
  tersedia/token expired harus menghasilkan pesan jelas di UI, bukan
  crash atau spinner selamanya.

## 8. Metrik Keberhasilan

- Install → chat pertama yang berhasil (dengan API key valid) dalam
  < 10 menit oleh pengguna yang belum pernah lihat app ini, di ketiga OS.
- Zero kebutuhan menyentuh terminal atau file config untuk seluruh alur
  pemakaian normal.
- Token tidak pernah ditemukan plain text di disk (diverifikasi manual
  saat testing).
- Semua skenario uji fitur platform dari PLAN sebelumnya (delegasi,
  shared memory, skills) tetap lolos di build ter-install, bukan cuma di
  dev mode.

## 9. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Native module (better-sqlite3) tidak cocok ABI dengan runtime desktop | Rebuild native module terhadap runtime target di proses build (electron-rebuild atau prebuild yang sesuai) |
| GitHub MCP server selama ini via Docker — tidak bisa diasumsikan ada | Ganti ke binary Go native per platform (dibundel atau diunduh saat first-run), atau endpoint remote resmi GitHub MCP |
| `npx` tidak tersedia di mesin user (dipakai untuk GitLab/Filesystem MCP) | Bundel package MCP sebagai dependency app dan spawn pakai runtime Node internal app — tidak bergantung npm/npx eksternal |
| Build tanpa code signing memicu warning keamanan macOS/Windows | Dokumentasikan langkah bypass di README rilis; anggarkan signing di fase lanjut kalau app mulai dipakai orang lain |
| Keychain Linux bervariasi antar distro (libsecret tidak selalu ada) | Fallback terenkripsi berbasis file dengan peringatan jelas di Settings |
| Ukuran bundle bengkak | Audit dependency sebelum rilis; tidak membundel dev-only packages |
| Perubahan config butuh reload MCP subprocess | Rancang config service dengan mekanisme reload koneksi MCP saat config berubah |

## 10. Keputusan Terbuka

1. **Electron vs Tauri** — direkomendasikan Electron untuk v1 (reuse
   penuh codebase Next.js + Node untuk spawn MCP subprocess), dengan
   trade-off ukuran bundle. Detail pertimbangan ada di PLAN.
2. Auto-update: ditunda, dievaluasi setelah rilis pertama dipakai.
3. Dukungan multi-provider AI sekaligus (bukan cuma satu base URL aktif):
   ditunda — v1 cukup satu provider aktif yang bisa diganti.
