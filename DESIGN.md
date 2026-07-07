# DESIGN — Agent Platform Desktop

**Terkait:** PRD-desktop.md, PLAN-desktop.md, DESIGN.md (versi web-lokal)
**Last updated:** 2 Juli 2026

Dokumen ini melengkapi DESIGN.md sebelumnya. **Semua design token
(warna, dark mode, tipografi, spacing) dan animasi dasar (thinking dots,
tool-call indicator, skeleton, message-in, dsb.) dari DESIGN.md tetap
berlaku** — tidak diulang di sini. Dokumen ini fokus ke hal yang baru
muncul karena bentuknya jadi aplikasi desktop: app shell, Settings,
onboarding wizard, status koneksi, dan konvensi per-OS.

---

## 1. App Shell: Sidebar, Bukan Top Nav

Top nav ala website (yang sekarang dipakai) terasa asing di app desktop.
Ganti dengan **sidebar kiri tetap** — pola yang user desktop sudah hafal
(Slack, VS Code, Obsidian).

```
┌────────┬──────────────────────────────────────────┐
│        │                                            │
│  ◆ App │   [Konten halaman aktif]                   │
│        │                                            │
│ Agents │                                            │
│ Skills │                                            │
│ Memory │                                            │
│        │                                            │
│ ────── │                                            │
│ ⚙ Settings                                          │
│ ● status koneksi AI (dot kecil)                      │
└────────┴──────────────────────────────────────────┘
```

Spesifikasi:
- Lebar sidebar: **220px** tetap (tidak collapsible di v1 — hindari
  kompleksitas yang belum dibutuhkan).
- Item aktif: background `var(--accent-soft)`, teks `var(--accent)`,
  border-radius `var(--radius-sm)`, transisi 140ms.
- **Settings selalu di bawah**, dipisah garis — konvensi umum desktop.
- Di bawah Settings: **dot status koneksi AI** (hijau = API key valid &
  tes terakhir sukses, merah = gagal, abu = belum dikonfigurasi).
  Ini jawaban cepat untuk "kenapa chat-ku nggak jalan?" tanpa buka
  Settings.
- Ukuran window: default 1200×800, minimum 900×600.

```css
.sidebar {
  width: 220px;
  background: var(--bg-muted);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 12px 8px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background 140ms ease, color 140ms ease;
}

.sidebar-item:hover { background: var(--bg-surface); }
.sidebar-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
```

Konvensi per-OS untuk window chrome:
- **macOS:** frameless dengan `titleBarStyle: "hiddenInset"` — traffic
  lights menempel di sidebar; beri `padding-top: 36px` pada sidebar
  supaya tidak tertutup tombol.
- **Windows/Linux:** pakai title bar native standar di v1. Custom title
  bar itu polish, bukan kebutuhan.

---

## 2. Halaman Settings

Satu halaman, empat section dengan anchor di sub-sidebar kecil (atau
cukup scroll kalau kontennya pendek): **AI Provider · GitHub · GitLab ·
Filesystem**.

### 2.1 Pola field rahasia (API key & token)

Semua field rahasia mengikuti pola yang sama:

```
┌──────────────────────────────────────────────┐
│ API Key                                        │
│ ┌──────────────────────────────┐ [👁] [Hapus]  │
│ │ sk-ant-••••••••••••••••3f2a  │               │
│ └──────────────────────────────┘               │
│ Tersimpan aman di Keychain macOS ✓             │
└──────────────────────────────────────────────┘
```

- Nilai tersimpan **selalu masked**, tampilkan hanya 4 karakter terakhir.
- Tombol reveal (👁) menampilkan penuh selama ditekan saja.
- Baris kecil di bawah field menyebut **di mana rahasia disimpan**
  ("Keychain macOS" / "Windows Credential Manager" / "libsecret" /
  "file terenkripsi ⚠ libsecret tidak tersedia") — transparansi ini
  requirement dari PRD 6.6, bukan hiasan.
- Tombol **Hapus** selalu ada per rahasia (user story #10).

### 2.2 Tombol Test Connection — empat state

Ini interaksi terpenting di Settings; state harus tidak ambigu:

| State | Visual |
|---|---|
| Idle | Tombol secondary "Test connection" |
| Loading | Tombol disabled + spinner kecil (reuse `.btn-primary[data-loading]` dari DESIGN.md) |
| Sukses | Tombol berubah hijau sesaat: ✓ "Terhubung — model claude-sonnet-4-6 tersedia" lalu kembali idle setelah 3 detik |
| Gagal | Border field merah + pesan error manusiawi di bawahnya, persist sampai dicoba lagi |

Contoh pesan error yang baik (jangan tampilkan raw error API):
- `401` → "API key tidak valid atau sudah dicabut."
- Timeout → "Tidak bisa menghubungi {baseUrl} — cek koneksi atau URL gateway."
- `404` model → "Model '{model}' tidak dikenali endpoint ini."

```css
.field-error {
  border-color: var(--danger) !important;
  animation: shake 300ms ease;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.test-success {
  color: var(--success);
  animation: fade-in 180ms ease-out;
}
```

### 2.3 Section Filesystem

- Daftar folder sebagai baris: ikon folder + path (truncate tengah kalau
  panjang: `/Users/nizar/…/praktis-simpan`) + tombol hapus.
- Tombol **"+ Add folder"** membuka dialog folder native — tidak ada
  input path manual sama sekali.
- Banner peringatan tetap (bukan dismissible) di atas daftar:
  "Agent dengan tool Filesystem bisa membaca dan menulis semua isi
  folder di daftar ini." — pakai `var(--danger-soft)` background lembut.
- Empty state: ilustrasi ringan + "Belum ada folder yang diizinkan.
  Agent belum bisa mengakses file lokal."

---

## 3. Onboarding Wizard (First Run)

Empat langkah, modal fullscreen di atas app shell (shell terlihat blur di
belakang — memberi konteks "ini app yang sebentar lagi bisa kamu pakai").

```
[ ● ── ○ ── ○ ── ○ ]   step indicator di atas

Step 1  API Key AI        (wajib, ada Test connection inline)
Step 2  GitHub & GitLab   (skippable — tombol "Lewati" jelas terlihat)
Step 3  Folder lokal      (skippable)
Step 4  Selesai           ("3 agent contoh sudah dibuatkan untukmu →")
```

Aturan:
- Step 1 tidak bisa dilewati; tombol "Lanjut" disabled sampai test
  connection sukses. Ini satu-satunya gerbang wajib.
- Transisi antar step: slide horizontal 200ms (`transform: translateX`),
  bukan ganti konten mendadak.
- Step 4 menampilkan nama 3 agent seed (Repo Agent, FS Agent, SQL Agent)
  sebagai kartu kecil — klik salah satu langsung membuka chat-nya.
  First chat dalam < 10 menit (metrik PRD) dimulai dari sini.
- Wizard bisa dibuka ulang dari Settings ("Jalankan setup awal lagi").

```css
.wizard-step {
  animation: step-in 200ms ease-out;
}

@keyframes step-in {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}
```

---

## 4. Status Tool & MCP (Settings dan Form Builder)

Health check MCP dari PLAN Fase C butuh bahasa visual konsisten di dua
tempat: halaman Settings dan checkbox tools di form builder agent.

| Status | Dot | Teks contoh |
|---|---|---|
| Terhubung | ● hijau | "GitLab — terhubung (gitlab.praktis.co)" |
| Belum dikonfigurasi | ● abu | "GitHub — belum ada token" |
| Error | ● merah | "Filesystem — server gagal start: {pesan}" |
| Sedang connect | ● biru pulse | reuse `.pulse-dot` dari DESIGN.md |

- Di form builder, tool yang statusnya abu/merah: checkbox disabled +
  link "Konfigurasi di Settings →" (bukan cuma teks "missing env vars"
  seperti versi web — env sudah tidak ada).

---

## 5. Empty & Error States Baru

| Situasi | Perlakuan |
|---|---|
| API key belum diisi, user coba chat | Bukan error toast — chat area diganti kartu: "Hubungkan model AI dulu" + tombol langsung ke Settings → AI Provider |
| MCP server mati di tengah percakapan | Pesan sistem inline di chat (bukan modal): "Tool GitLab terputus — jawaban ini disusun tanpa tool tersebut" |
| Token expired terdeteksi saat tool call | Notifikasi non-blocking + dot sidebar berubah merah; chat tetap jalan untuk tool lain |

Prinsipnya: **kegagalan konfigurasi tidak boleh memblokir seluruh app**
— selalu tunjukkan jalan keluar satu klik ke Settings.

---

## 6. Konvensi Desktop Lain

- **Dark mode ikut OS** otomatis (`prefers-color-scheme` sudah di-cover
  DESIGN.md) — tambah opsi manual Light/Dark/System di Settings, simpan
  di config service.
- **Keyboard shortcut** minimum v1: `Cmd/Ctrl+N` percakapan baru,
  `Cmd/Ctrl+,` buka Settings (konvensi universal), `Cmd/Ctrl+1..9`
  lompat antar agent di sidebar (kalau nanti agent di-pin ke sidebar).
- **Menu aplikasi native** minimal (File/Edit/View/Help) — Electron
  butuh ini supaya copy-paste dan shortcut standar jalan, terutama macOS.
- Font: tetap system font stack dari DESIGN.md — di desktop ini bonus
  karena otomatis mengikuti rendering natural tiap OS (SF di macOS,
  Segoe di Windows, dsb.).

---

## 7. Ringkasan Implementasi

| Elemen | Fase di PLAN-desktop | Prioritas |
|---|---|---|
| Sidebar app shell + status dot AI | Fase A (bersamaan migrasi shell) | Tinggi |
| Pola field rahasia + Test connection 4-state | Fase B | Tinggi |
| Section Filesystem + native folder picker | Fase B | Tinggi |
| Onboarding wizard | Fase B (B.3) | Tinggi |
| Status tool 4-state (Settings + form builder) | Fase C (health check) | Sedang |
| Empty/error states chat | Fase B–C | Sedang |
| Keyboard shortcuts + menu native | Fase D (sebelum rilis) | Sedang |
| Opsi tema manual, pin agent ke sidebar | Fase E (backlog) | Rendah |

Semua token warna, animasi loading, dan micro-interaction dari DESIGN.md
dipakai apa adanya — tidak ada sistem visual kedua. Satu app, satu bahasa
desain, dua dokumen yang saling melengkapi.
