# DESIGN FRONTEND — AI API Gateway Admin Dashboard

| Field       | Detail                                      |
|-------------|---------------------------------------------|
| Version     | 1.0 — Draft                                 |
| Status      | Draft                                       |
| Author      | Product Manager Agent                       |
| Date        | 2026-08-28                                  |
| Terkait     | PRD-api-gateway.md, PLAN-api-gateway.md     |
| Stack       | Next.js 14 (App Router) + Tailwind CSS      |

---

## 1. Overview

Frontend ini adalah **Admin Dashboard** untuk mengelola AI API Gateway.
Target user: Admin teknis dan Product Manager internal.
Bukan public-facing — diakses via URL internal atau VPN.

### Halaman yang dibutuhkan

| Halaman          | Path              | Siapa yang pakai        |
|------------------|-------------------|-------------------------|
| Login            | `/login`          | Admin, PM               |
| Dashboard        | `/`               | Admin, PM               |
| API Keys         | `/keys`           | Admin                   |
| Detail Key       | `/keys/:id`       | Admin                   |
| Model Aliases    | `/models`         | Admin                   |
| Logs             | `/logs`           | Admin                   |

---

## 2. Design Tokens

```css
:root {
  /* --- Color Palette --- */
  --bg-base:        #0f1117;   /* halaman utama */
  --bg-surface:     #1a1d27;   /* card, sidebar */
  --bg-muted:       #141720;   /* input background */
  --border:         #2a2d3a;   /* garis pembatas */

  --text-primary:   #e8eaf0;
  --text-secondary: #8b8fa8;
  --text-muted:     #555870;

  --accent:         #6366f1;   /* indigo — brand color */
  --accent-hover:   #4f46e5;
  --accent-soft:    rgba(99, 102, 241, 0.12);

  --success:        #22c55e;
  --success-soft:   rgba(34, 197, 94, 0.12);
  --warning:        #f59e0b;
  --warning-soft:   rgba(245, 158, 11, 0.12);
  --danger:         #ef4444;
  --danger-soft:    rgba(239, 68, 68, 0.12);

  /* --- Typography --- */
  --font-sans:      'Inter', system-ui, sans-serif;
  --font-mono:      'JetBrains Mono', 'Fira Code', monospace;

  --text-xs:   11px;
  --text-sm:   13px;
  --text-base: 14px;
  --text-md:   16px;
  --text-lg:   20px;
  --text-xl:   24px;
  --text-2xl:  30px;

  /* --- Spacing --- */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;

  /* --- Radius --- */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  /* --- Shadow --- */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.4);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.5);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.6);
}
```

---

## 3. Layout Shell

Semua halaman (kecuali `/login`) menggunakan shell ini:

```
┌─────────────────────────────────────────────────────────┐
│  SIDEBAR (220px)  │           MAIN CONTENT               │
│                   │                                       │
│  ◆ AI Gateway     │  [Topbar: breadcrumb + user avatar]   │
│  ─────────────    │  ─────────────────────────────────    │
│  Dashboard        │                                       │
│  API Keys         │  [Page content]                       │
│  Model Aliases    │                                       │
│  Logs             │                                       │
│                   │                                       │
│  ──────────────   │                                       │
│  ● API Status     │                                       │
│  ⚙ Settings       │                                       │
└─────────────────────────────────────────────────────────┘
```

### Sidebar Spec

```css
.sidebar {
  width: 220px;
  min-height: 100vh;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 16px 8px;
  position: fixed;
  top: 0; left: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 20px;
  font-weight: 700;
  font-size: var(--text-md);
  color: var(--text-primary);
  letter-spacing: -0.3px;
}

.sidebar-logo span.dot {
  width: 8px; height: 8px;
  background: var(--accent);
  border-radius: 50%;
  display: inline-block;
}

.sidebar-nav { flex: 1; }

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
  text-decoration: none;
  margin-bottom: 2px;
}

.sidebar-item:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

.sidebar-item.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}

.sidebar-item svg {
  width: 16px; height: 16px;
  opacity: 0.7;
  flex-shrink: 0;
}

.sidebar-item.active svg { opacity: 1; }

.sidebar-footer {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* Status dot — gateway health indicator */
.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.status-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.online  { background: var(--success); }
.status-dot.offline { background: var(--danger); }
.status-dot.unknown { background: var(--text-muted); }

/* pulse animation untuk "checking" state */
.status-dot.checking {
  background: var(--accent);
  animation: pulse-dot 1.2s ease infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.8); }
}
```

### Topbar Spec

```
┌─────────────────────────────────────────────────────┐
│  Dashboard  /  API Keys            [avatar] Admin ▾  │
└─────────────────────────────────────────────────────┘
```

```css
.topbar {
  height: 56px;
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  position: sticky;
  top: 0;
  z-index: 10;
}

.topbar-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.topbar-breadcrumb span.current {
  color: var(--text-primary);
  font-weight: 500;
}

.topbar-user {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  transition: background 140ms;
}

.topbar-user:hover { background: var(--bg-surface); }

.avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: 600;
}
```

### Main Content Wrapper

```css
.main-wrapper {
  margin-left: 220px;   /* kompensasi sidebar fixed */
  min-height: 100vh;
  background: var(--bg-base);
}

.page-content {
  padding: var(--space-6);
  max-width: 1200px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--space-6);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.4px;
}

.page-subtitle {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: 4px;
}
```

---

## 4. Halaman Login (`/login`)

### Wireframe

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                   ◆  AI Gateway                     │
│              Admin Dashboard                        │
│                                                     │
│         ┌──────────────────────────────┐            │
│         │  Admin Token                 │            │
│         │  ┌────────────────────────┐  │            │
│         │  │ ••••••••••••••••       │👁 │            │
│         │  └────────────────────────┘  │            │
│         │                              │            │
│         │  [    Masuk ke Dashboard   ] │            │
│         │                              │            │
│         │  ⚠ Token tidak valid         │            │
│         └──────────────────────────────┘            │
│                                                     │
│         Akses terbatas — internal only              │
└─────────────────────────────────────────────────────┘
```

### Spec

- Layout: center vertikal dan horizontal, full viewport
- Card width: 380px, padding 32px
- Background: `--bg-base` dengan subtle grid pattern (opacity 3%)
- Logo: icon diamond (◆) + teks "AI Gateway" — **tidak menyebut NVIDIA**
- Field token: `type="password"` default, ada toggle show/hide (ikon mata)
- Error state: border merah + pesan inline di bawah field
- Button: full width, loading spinner saat proses autentikasi
- Setelah sukses: redirect ke `/` dengan session disimpan di httpOnly cookie

```css
.login-page {
  min-height: 100vh;
  background: var(--bg-base);
  display: flex;
  align-items: center;
  justify-content: center;
  background-image: radial-gradient(
    circle at 50% 50%,
    rgba(99,102,241,0.04) 0%,
    transparent 60%
  );
}

.login-card {
  width: 380px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 32px;
  box-shadow: var(--shadow-lg);
}

.login-logo {
  text-align: center;
  margin-bottom: 28px;
}

.login-logo .diamond {
  font-size: 28px;
  color: var(--accent);
  display: block;
  margin-bottom: 8px;
}

.login-logo h1 {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.login-logo p {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin: 4px 0 0;
}
```


---

## 5. Halaman Dashboard (`/`)

### Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard                                                   │
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────┐ │
│  │ Total Request│ │ Active Keys  │ │  Error Rate  │ │ P95│ │
│  │  24,381      │ │     12       │ │    1.2%      │ │142ms│ │
│  │ ↑ 8% vs kem. │ │              │ │ ↓ 0.3%       │ │    │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────┘ │
│                                                             │
│  ┌──────────────────────────────┐ ┌───────────────────────┐ │
│  │  Requests / hour (7 hari)    │ │  Top Keys by Usage    │ │
│  │  [line chart]                │ │  service-kasir  4,201 │ │
│  │                              │ │  mobile-app     3,892 │ │
│  │                              │ │  web-frontend   2,110 │ │
│  └──────────────────────────────┘ └───────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Recent Requests (last 20)                           │  │
│  │  timestamp   key          route        status  ms    │  │
│  │  07:44:01    svc-kasir    /v1/chat      200    234   │  │
│  │  07:44:00    mobile-app   /v1/embed     200    89    │  │
│  │  07:43:58    web-fe       /v1/chat      429    12    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Stat Cards Spec

```css
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.stat-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-5);
  transition: border-color 200ms;
}

.stat-card:hover { border-color: var(--accent); }

.stat-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  font-weight: 500;
  margin-bottom: var(--space-2);
}

.stat-value {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.8px;
  font-variant-numeric: tabular-nums;
}

.stat-delta {
  font-size: var(--text-xs);
  margin-top: var(--space-1);
  display: flex;
  align-items: center;
  gap: 3px;
}

.stat-delta.up   { color: var(--success); }
.stat-delta.down { color: var(--danger); }
.stat-delta.neutral { color: var(--text-muted); }
```

Stat cards yang ditampilkan:

| Card | Value | Delta | Warna delta |
|------|-------|-------|-------------|
| Total Requests (24h) | angka | % vs kemarin | hijau=naik |
| Active API Keys | angka | — | — |
| Error Rate (24h) | % | % vs kemarin | merah=naik |
| P95 Latency | ms | vs kemarin | merah=naik |

### Chart Area

- Library: **Recharts** (sudah umum di Next.js ecosystem)
- Chart kiri: `LineChart` — requests per jam, 7 hari terakhir
  - X-axis: jam (format `HH:mm`)
  - Y-axis: jumlah request
  - Tooltip: `{time}: {n} requests`
  - Warna line: `var(--accent)`
  - Area fill: `var(--accent-soft)`
- Chart kanan: `BarChart` horizontal — top 5 keys by usage
  - Warna bar: `var(--accent)`
  - Label: nama key + jumlah request

```css
.chart-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.chart-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-5);
}

.chart-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-4);
}
```

### Recent Requests Table

```css
.recent-table {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.recent-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.recent-table th {
  text-align: left;
  padding: 10px 16px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}

.recent-table td {
  padding: 10px 16px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.recent-table tr:last-child td { border-bottom: none; }

.recent-table tr:hover td {
  background: var(--bg-muted);
}

/* status badge */
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 100px;
  font-size: var(--text-xs);
  font-weight: 500;
  font-family: var(--font-mono);
}

.badge.success { background: var(--success-soft); color: var(--success); }
.badge.warning { background: var(--warning-soft); color: var(--warning); }
.badge.error   { background: var(--danger-soft);  color: var(--danger);  }
```

Status badge logic:
- `2xx` → `.badge.success`
- `4xx` → `.badge.warning`
- `5xx` → `.badge.error`

---

## 6. Halaman API Keys (`/keys`)

### Wireframe

```
┌─────────────────────────────────────────────────────────────┐
│  API Keys                          [+ Buat API Key Baru]    │
│  Kelola akses consumer ke gateway                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔍 Cari key...          [Semua ▾] [Semua Tier ▾]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Label          Tier      Requests  Last Used  Status │   │
│  │ ─────────────────────────────────────────────────── │   │
│  │ service-kasir  standard  4,201     2 mnt lalu ● Aktif│  │
│  │ mobile-app     premium   3,892     5 mnt lalu ● Aktif│  │
│  │ web-frontend   free        201     1 jam lalu ● Aktif│  │
│  │ old-service    free          0     30 hr lalu ○ Revoked│ │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Menampilkan 4 dari 4 keys                                  │
└─────────────────────────────────────────────────────────────┘
```

### Spec

**Filter bar:**
- Search input: cari by label, realtime filter (debounce 300ms)
- Dropdown status: Semua / Aktif / Revoked
- Dropdown tier: Semua Tier / Free / Standard / Premium

**Tabel kolom:**

| Kolom | Tipe | Keterangan |
|-------|------|------------|
| Label | teks | nama key, klik → `/keys/:id` |
| Tier | badge | free/standard/premium dengan warna |
| Requests (7d) | angka | jumlah request 7 hari |
| Last Used | relative time | "2 mnt lalu", "1 jam lalu" |
| Status | badge | Aktif (hijau) / Revoked (abu) |
| Actions | icon | ⋯ dropdown: Lihat Detail, Revoke |

**Tier badge warna:**

```css
.tier-badge {
  display: inline-flex;
  padding: 2px 8px;
  border-radius: 100px;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.tier-badge.free     { background: var(--bg-muted); color: var(--text-muted); }
.tier-badge.standard { background: var(--accent-soft); color: var(--accent); }
.tier-badge.premium  { background: var(--warning-soft); color: var(--warning); }
```

**Row revoked:**
- Opacity: 0.5
- Label dan angka: `color: var(--text-muted)`
- Status badge: background `var(--bg-muted)`, color `var(--text-muted)`

**Actions dropdown (`⋯`):**
```
┌─────────────────┐
│ 👁 Lihat Detail  │
│ ─────────────── │
│ 🚫 Revoke Key   │  ← merah, hanya muncul jika status Aktif
└─────────────────┘
```

- Revoke memunculkan **Confirmation Dialog** sebelum eksekusi
- Setelah revoke: row berubah ke state revoked tanpa reload halaman (optimistic update)

```css
.actions-dropdown {
  position: absolute;
  right: 0; top: calc(100% + 4px);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 4px;
  min-width: 160px;
  box-shadow: var(--shadow-md);
  z-index: 20;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 120ms;
}

.dropdown-item:hover { background: var(--bg-muted); color: var(--text-primary); }
.dropdown-item.danger { color: var(--danger); }
.dropdown-item.danger:hover { background: var(--danger-soft); }
```

**Confirmation Dialog (Revoke):**

```
┌──────────────────────────────────────┐
│  Revoke API Key                      │
│                                      │
│  Yakin ingin merevoke key             │
│  "service-kasir"?                    │
│                                      │
│  Key ini tidak bisa diaktifkan       │
│  kembali. Consumer yang memakai      │
│  key ini akan langsung 401.          │
│                                      │
│  [  Batal  ]  [  Ya, Revoke  ]       │
│                        ← merah       │
└──────────────────────────────────────┘
```


---

## 7. Modal Buat API Key Baru

Dipanggil dari tombol "+ Buat API Key Baru" di halaman `/keys`.

### Wireframe

```
┌──────────────────────────────────────────┐
│  Buat API Key Baru                    ✕  │
│                                          │
│  Label                                   │
│  ┌────────────────────────────────────┐  │
│  │ service-kasir                      │  │
│  └────────────────────────────────────┘  │
│  Nama layanan yang akan pakai key ini    │
│                                          │
│  Tier                                    │
│  ┌────────────────────────────────────┐  │
│  │ Standard                        ▾  │  │
│  └────────────────────────────────────┘  │
│  Free: 20 req/mnt · Standard: 60 req/mnt │
│  Premium: 300 req/mnt                    │
│                                          │
│  [    Batal    ]  [  Buat Key  ]         │
└──────────────────────────────────────────┘
```

**Setelah key berhasil dibuat — tampilkan one-time reveal:**

```
┌──────────────────────────────────────────┐
│  ✓ API Key Berhasil Dibuat            ✕  │
│                                          │
│  ⚠ Simpan key ini sekarang.              │
│  Key tidak akan ditampilkan lagi.        │
│                                          │
│  gw_a8f3k2m9x1q7w4e6r0t5y2u8i3o9p1     │
│  ┌──────────────────────────────────┐    │
│  │ gw_a8f3k2m9x1q7...              📋 │  │
│  └──────────────────────────────────┘   │
│                                          │
│  [      Saya sudah menyimpan key      ] │
└──────────────────────────────────────────┘
```

### Spec Modal

- Overlay: `rgba(0,0,0,0.6)` backdrop dengan blur `4px`
- Modal width: 480px, border-radius: `var(--radius-lg)`
- Animasi masuk: fade + scale dari `0.96` ke `1.0`, durasi 180ms
- Field label: required, max 50 karakter, hanya huruf kecil + dash
- Dropdown tier: Select custom (bukan native `<select>`)
- Tombol "Buat Key": disabled jika label kosong
- Loading state: spinner di dalam tombol, tombol disabled

**One-time reveal spec:**
- Background field key: `var(--bg-muted)`, font mono
- Tombol salin (📋): copy ke clipboard, ganti ikon ke ✓ selama 2 detik
- Warning box: background `var(--warning-soft)`, border `var(--warning)`, ikon ⚠
- Tombol "Saya sudah menyimpan key": menutup modal, trigger refresh tabel

```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  animation: fade-in 180ms ease-out;
}

.modal {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
  width: 480px;
  box-shadow: var(--shadow-lg);
  animation: scale-in 180ms ease-out;
}

@keyframes scale-in {
  from { transform: scale(0.96); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}

.modal-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

.modal-close:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

.key-reveal-box {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-primary);
  word-break: break-all;
}

.warning-banner {
  background: var(--warning-soft);
  border: 1px solid var(--warning);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-size: var(--text-sm);
  color: var(--warning);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
}
```

---

## 8. Halaman Detail API Key (`/keys/:id`)

### Wireframe

```
┌──────────────────────────────────────────────────────────┐
│  ← Kembali ke API Keys                                   │
│                                                          │
│  service-kasir                     ● Aktif  [Revoke Key] │
│  Dibuat 2026-08-01 · Tier: Standard                      │
│                                                          │
│  ┌───────────────┐ ┌───────────────┐ ┌────────────────┐ │
│  │ Total Requests│ │  Total Tokens │ │   Error Count  │ │
│  │   4,201       │ │  1,203,400    │ │      12        │ │
│  │ last 30 hari  │ │ last 30 hari  │ │  last 30 hari  │ │
│  └───────────────┘ └───────────────┘ └────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Requests / hari (30 hari)  [line chart]         │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Log Requests (key ini, last 50)                 │   │
│  │  timestamp    route       status  tokens   ms    │   │
│  │  ...                                             │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### Spec

- Breadcrumb "← Kembali ke API Keys" sebagai link navigation
- Header: nama key (besar) + badge status + tombol Revoke (merah, outline)
- Sub-header: tanggal dibuat + tier badge
- 3 stat cards: Total Requests, Total Tokens, Error Count — semua last 30 hari
- Chart: line chart request per hari, 30 hari, pakai Recharts `AreaChart`
- Tabel log: kolom timestamp, route, status badge, tokens, latency ms
- Tabel paginated: 20 baris per halaman, pagination di bawah

**Date range filter (di atas chart):**
```
[ Last 7 days ]  [ Last 30 days ]  [ Custom range ]
```
- Default: Last 30 days
- Custom range: date picker popup (pakai `react-day-picker`)

---

## 9. Halaman Model Aliases (`/models`)

### Wireframe

```
┌──────────────────────────────────────────────────────────┐
│  Model Aliases                    [+ Tambah Alias]       │
│  Mapping nama model internal ke provider                 │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Alias (Internal)   →  Model Provider   Actions  │   │
│  │  ─────────────────────────────────────────────── │   │
│  │  ai-chat-v1         →  [••••••••••••••]    ✎ 🗑  │   │
│  │  ai-embed-v1        →  [••••••••••••••]    ✎ 🗑  │   │
│  │  ai-vision-v1       →  [••••••••••••••]    ✎ 🗑  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ⓘ Kolom "Model Provider" disamarkan. Klik ✎ untuk edit. │
└──────────────────────────────────────────────────────────┘
```

### Spec

**Prinsip utama halaman ini:**
- Kolom "Model Provider" (nama model NVIDIA) **TIDAK ditampilkan plain text**
- Default: disamarkan dengan `••••••••` — mencegah siapapun yang lihat layar bisa membaca nama model vendor
- Tombol 👁 per-baris untuk reveal sementara (hanya baris itu, selama 5 detik lalu otomatis tersembunyi kembali)

**Tabel kolom:**

| Kolom | Tampilan |
|-------|----------|
| Alias | teks, font mono, `var(--accent)` |
| → | arrow separator |
| Model Provider | `••••••••••••` default, tombol 👁 reveal per-baris |
| Actions | ✎ Edit (buka inline edit), 🗑 Hapus (confirm dialog) |

**Inline Edit flow:**
1. Klik ✎ → baris berubah jadi editable: field alias + field model (terlihat plain text selama edit)
2. Tombol ✓ Simpan dan ✕ Batal muncul di kolom actions
3. Klik ✓ → PATCH request, baris kembali ke tampilan masked
4. Klik ✕ → batalkan, kembali ke tampilan semula

```css
.alias-table td.model-value {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-muted);
  letter-spacing: 2px; /* biar •••• terlihat rapi */
}

.alias-table td.model-value.revealed {
  color: var(--text-secondary);
  letter-spacing: normal;
}

.reveal-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  transition: color 120ms, background 120ms;
}

.reveal-btn:hover {
  background: var(--bg-muted);
  color: var(--text-secondary);
}

.alias-row-editing td {
  background: var(--bg-muted);
}

.alias-row-editing input {
  background: var(--bg-surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-primary);
  width: 100%;
  outline: none;
}
```


---

## 10. Halaman Logs (`/logs`)

### Wireframe

```
┌──────────────────────────────────────────────────────────┐
│  Logs                                    [⬇ Export CSV]  │
│  Real-time request log gateway                           │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 🔍 Cari route...  [Semua Key▾] [Semua Status▾]   │   │
│  │                   [Dari: ──────] [Sampai: ──────] │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │ Timestamp      Key          Route    Status  ms  │   │
│  │ ──────────────────────────────────────────────── │   │
│  │ 07:44:01.234   svc-kasir   /v1/chat  200    234  │   │
│  │ 07:44:00.891   mobile-app  /v1/embed 200     89  │   │
│  │ 07:43:58.102   web-fe      /v1/chat  429     12  │   │
│  │ 07:43:55.771   svc-kasir   /v1/chat  502    301  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ← 1  2  3  4  5 ... 24 →        Showing 1-20 of 480   │
└──────────────────────────────────────────────────────────┘
```

### Spec

**Filter bar:**
- Search route: filter by route prefix, debounce 400ms
- Dropdown key: Semua Key + daftar key aktif
- Dropdown status: Semua / 2xx / 4xx / 5xx
- Date range: 2 input date (dari–sampai), default hari ini

**Tabel kolom:**

| Kolom | Detail |
|-------|--------|
| Timestamp | format `HH:mm:ss.SSS`, font mono |
| Key | label key, klik → `/keys/:id` |
| Route | path endpoint, font mono |
| Status | badge (success/warning/error) |
| Latency | angka ms, font mono tabular |

**Row expand (klik baris):**
- Baris melebar ke bawah, tampilkan detail:
```
  ▼ 07:44:01.234 — /v1/chat
    Key ID    : uuid-xxx
    Method    : POST
    User-Agent: service-kasir/1.0
    Tokens    : 1,204 (prompt: 800, completion: 404)
    Upstream  : 198ms
    Gateway   : 36ms
```
- Background baris expand: `var(--bg-muted)`
- Animasi: slide-down 160ms ease

**Export CSV:**
- Tombol kanan atas, ekspor data sesuai filter aktif
- Max 10,000 baris per export
- Filename: `gateway-logs-{YYYY-MM-DD}.csv`

**Pagination:**
- 20 baris per halaman
- Tampilkan: `← prev  [1] [2] [3] ... [n]  next →`
- Halaman aktif: background `var(--accent-soft)`, text `var(--accent)`

```css
.logs-filter-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
}

.log-row-expanded {
  background: var(--bg-muted);
  border-top: 1px solid var(--border);
}

.log-detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
}

.log-detail-item label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 2px;
}

.log-detail-item span {
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border);
}

.pagination-info {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.pagination-controls {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.page-btn {
  min-width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

.page-btn:hover    { background: var(--bg-muted); }
.page-btn.active   { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.page-btn.disabled { opacity: 0.3; cursor: not-allowed; }
```


---

## 11. Reusable Components

### Button

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background 140ms, border-color 140ms, opacity 140ms;
  white-space: nowrap;
  border: 1px solid transparent;
  text-decoration: none;
}

/* Primary */
.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-primary:hover { background: var(--accent-hover); }

/* Secondary / Outline */
.btn-secondary {
  background: transparent;
  border-color: var(--border);
  color: var(--text-secondary);
}
.btn-secondary:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* Danger */
.btn-danger {
  background: transparent;
  border-color: var(--danger);
  color: var(--danger);
}
.btn-danger:hover { background: var(--danger-soft); }

/* Ghost */
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}
.btn-ghost:hover { background: var(--bg-muted); color: var(--text-primary); }

/* States */
.btn:disabled,
.btn[aria-disabled="true"] {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

.btn.loading {
  pointer-events: none;
  opacity: 0.7;
}

/* Loading spinner di dalam button */
.btn-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Size variants */
.btn-sm { padding: 5px 12px; font-size: var(--text-xs); }
.btn-lg { padding: 11px 22px; font-size: var(--text-md); }
```

### Input / Form Field

```css
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: var(--space-4);
}

.form-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.form-label .required {
  color: var(--danger);
  margin-left: 2px;
}

.form-input {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-family: var(--font-sans);
  transition: border-color 140ms, box-shadow 140ms;
  width: 100%;
  outline: none;
}

.form-input::placeholder { color: var(--text-muted); }

.form-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.form-input.error {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

.form-input.mono { font-family: var(--font-mono); }

.form-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.form-error {
  font-size: var(--text-xs);
  color: var(--danger);
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Password / secret field dengan toggle */
.input-wrapper {
  position: relative;
}

.input-wrapper .form-input {
  padding-right: 40px;
}

.input-toggle-btn {
  position: absolute;
  right: 10px; top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: color 120ms;
}

.input-toggle-btn:hover { color: var(--text-secondary); }
```

### Select Custom

```css
.select-wrapper {
  position: relative;
}

.select-trigger {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 9px 36px 9px 12px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: border-color 140ms;
  user-select: none;
}

.select-trigger:hover { border-color: var(--text-muted); }
.select-trigger.open  { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

.select-chevron {
  position: absolute;
  right: 12px; top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
  transition: transform 160ms;
}

.select-trigger.open .select-chevron { transform: translateY(-50%) rotate(180deg); }

.select-dropdown {
  position: absolute;
  top: calc(100% + 4px); left: 0; right: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 4px;
  box-shadow: var(--shadow-md);
  z-index: 30;
  animation: scale-in 140ms ease-out;
}

.select-option {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 100ms, color 100ms;
}

.select-option:hover   { background: var(--bg-muted); color: var(--text-primary); }
.select-option.selected {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}

.select-option-desc {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 2px;
}
```

---

## 12. Empty, Loading, dan Error States

### Empty State

```
┌────────────────────────────────────┐
│                                    │
│           🔑                       │
│    Belum ada API Key               │
│    Buat key pertama untuk          │
│    mulai menggunakan gateway.      │
│                                    │
│    [+ Buat API Key Pertama]        │
│                                    │
└────────────────────────────────────┘
```

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px var(--space-6);
  text-align: center;
  color: var(--text-muted);
}

.empty-state .icon {
  font-size: 36px;
  margin-bottom: var(--space-4);
  opacity: 0.5;
}

.empty-state h3 {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.empty-state p {
  font-size: var(--text-sm);
  color: var(--text-muted);
  max-width: 280px;
  line-height: 1.6;
  margin: 0 0 var(--space-5);
}
```

### Skeleton Loading

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg-muted) 25%,
    var(--bg-surface) 50%,
    var(--bg-muted) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s ease infinite;
  border-radius: var(--radius-sm);
}

@keyframes shimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}

/* Ukuran skeleton */
.skeleton-text-sm  { height: 12px; width: 80px; }
.skeleton-text     { height: 14px; }
.skeleton-title    { height: 24px; width: 200px; }
.skeleton-stat     { height: 40px; width: 120px; }
.skeleton-row      { height: 44px; width: 100%; margin-bottom: 1px; }
```

### Error State (fetch gagal)

```
┌────────────────────────────────────┐
│  ⚠ Gagal memuat data               │
│  Tidak bisa terhubung ke server.   │
│  [  Coba Lagi  ]                   │
└────────────────────────────────────┘
```

```css
.error-banner {
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.error-banner-text {
  font-size: var(--text-sm);
  color: var(--danger);
}

.error-banner-text strong { display: block; font-weight: 600; }
```

### Toast Notification

Muncul di kanan bawah, stack ke atas jika ada multiple.

```css
.toast-container {
  position: fixed;
  bottom: 24px; right: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
}

.toast {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  min-width: 280px;
  max-width: 380px;
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  animation: slide-up 200ms ease-out;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.toast.success { border-left: 3px solid var(--success); }
.toast.error   { border-left: 3px solid var(--danger);  }
.toast.warning { border-left: 3px solid var(--warning); }

@keyframes slide-up {
  from { transform: translateY(12px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

.toast-icon { flex-shrink: 0; margin-top: 1px; }
.toast-title { font-weight: 600; color: var(--text-primary); margin-bottom: 2px; }
.toast-close {
  margin-left: auto;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  padding: 2px;
}
```

Toast triggers:
- ✅ Key berhasil dibuat
- ✅ Key berhasil direvoke
- ✅ Alias berhasil disimpan
- ❌ Gagal muat data (dengan retry link)
- ✅ Key disalin ke clipboard


---

## 13. Responsive Behavior

Dashboard ini primarily **desktop** (admin tool internal). Tetap perlu responsive untuk tablet — bukan mobile-first.

### Breakpoints

```css
/* Tablet landscape */
@media (max-width: 1024px) {
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .chart-grid { grid-template-columns: 1fr; }
}

/* Tablet portrait */
@media (max-width: 768px) {
  .sidebar {
    width: 200px;
    transform: translateX(-200px);
    transition: transform 240ms ease;
  }

  .sidebar.open { transform: translateX(0); }

  .main-wrapper { margin-left: 0; }

  /* Topbar: tampilkan hamburger menu */
  .topbar-menu-btn { display: flex; }

  .stat-grid { grid-template-columns: 1fr 1fr; }
}

/* Mobile — fallback saja, bukan prioritas */
@media (max-width: 480px) {
  .stat-grid { grid-template-columns: 1fr; }
  .modal { width: calc(100vw - 32px); }
  .page-content { padding: var(--space-4); }
}
```

### Sidebar Mobile

Di tablet/mobile, sidebar menjadi drawer yang bisa di-toggle via hamburger button di topbar. Overlay gelap muncul di belakang sidebar saat terbuka.

```css
.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 39;
}

@media (max-width: 768px) {
  .sidebar { z-index: 40; }
  .sidebar-overlay.visible { display: block; }
}
```

---

## 14. Interaction Patterns

### Data Refresh

- Dashboard stat cards: auto-refresh setiap **30 detik** (polling via `setInterval`)
- Recent requests table: auto-refresh setiap **10 detik**
- Tampilkan indicator "Last updated: X detik lalu" di kanan atas tabel
- Tombol refresh manual (ikon ↻) di samping indicator

```css
.refresh-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.refresh-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: color 120ms, transform 200ms;
}

.refresh-btn:hover { color: var(--text-secondary); }
.refresh-btn.spinning { animation: spin 800ms linear infinite; }
```

### Optimistic Updates

Operasi berikut menggunakan optimistic update (UI berubah sebelum response server):
- **Revoke key**: row langsung set ke status revoked, rollback jika API error
- **Save alias**: baris langsung update, rollback + toast error jika gagal

### Keyboard Shortcuts

| Shortcut | Aksi |
|----------|------|
| `Escape` | Tutup modal / dropdown yang sedang terbuka |
| `Ctrl+K` | Fokus ke search bar (di halaman keys/logs) |
| `N` | Buka modal buat key baru (di halaman `/keys`) |

### Focus Management

- Saat modal terbuka: focus trap di dalam modal (pakai `focus-trap-react`)
- Saat modal tutup: return focus ke tombol yang membukanya
- Semua interactive element dapat dicapai via `Tab`

---

## 15. Data Fetching Strategy

Stack: **SWR** (stale-while-revalidate) untuk semua fetch di Next.js.

```ts
// hooks/useKeys.ts
import useSWR from 'swr'

const fetcher = (url: string) =>
  fetch(url, {
    headers: { 'Authorization': `Bearer ${getAdminToken()}` }
  }).then(r => {
    if (!r.ok) throw new Error(r.statusText)
    return r.json()
  })

export function useKeys(filter?: { status?: string; tier?: string }) {
  const params = new URLSearchParams(filter as any).toString()
  return useSWR(`/api/admin/keys?${params}`, fetcher, {
    refreshInterval: 0,       // manual refresh saja untuk list
    revalidateOnFocus: false,
  })
}

export function useDashboardStats() {
  return useSWR('/api/admin/stats', fetcher, {
    refreshInterval: 30_000,  // auto-refresh 30 detik
  })
}

export function useRecentRequests() {
  return useSWR('/api/admin/logs?limit=20', fetcher, {
    refreshInterval: 10_000,  // auto-refresh 10 detik
  })
}
```

### Admin Token Storage

- Token disimpan di **httpOnly cookie** (set oleh server saat login)
- Client TIDAK menyimpan token di localStorage/sessionStorage
- Next.js API route `/api/admin/*` menjadi proxy: baca cookie → forward ke gateway backend
- Ini mencegah token ADMIN terekspos ke browser console

```
Browser → Next.js API Route → Gateway Backend
         (baca cookie)        (pakai ADMIN_TOKEN)
```

---

## 16. Folder Struktur Frontend

```
app/
├── (auth)/
│   └── login/
│       └── page.tsx
├── (dashboard)/
│   ├── layout.tsx          ← Shell (sidebar + topbar)
│   ├── page.tsx            ← Dashboard /
│   ├── keys/
│   │   ├── page.tsx        ← API Keys list
│   │   └── [id]/
│   │       └── page.tsx    ← Detail key
│   ├── models/
│   │   └── page.tsx        ← Model aliases
│   └── logs/
│       └── page.tsx        ← Logs viewer
├── api/
│   └── admin/
│       ├── stats/route.ts
│       ├── keys/route.ts
│       ├── keys/[id]/route.ts
│       ├── logs/route.ts
│       └── models/route.ts
└── globals.css             ← Design tokens + base styles

components/
├── layout/
│   ├── Sidebar.tsx
│   └── Topbar.tsx
├── ui/
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Select.tsx
│   ├── Badge.tsx
│   ├── Modal.tsx
│   ├── Toast.tsx
│   ├── Skeleton.tsx
│   └── EmptyState.tsx
├── dashboard/
│   ├── StatCard.tsx
│   ├── RequestsChart.tsx
│   └── RecentTable.tsx
├── keys/
│   ├── KeysTable.tsx
│   ├── CreateKeyModal.tsx
│   └── RevokeConfirmDialog.tsx
├── models/
│   └── AliasTable.tsx
└── logs/
    ├── LogsTable.tsx
    └── LogsFilterBar.tsx

hooks/
├── useKeys.ts
├── useDashboardStats.ts
├── useRecentRequests.ts
├── useLogs.ts
└── useModels.ts

lib/
├── fetcher.ts
├── auth.ts             ← getAdminToken, checkSession
└── format.ts           ← formatDate, formatNumber, relativeTime
```

---

## 17. Tech Stack Summary

| Kebutuhan | Library | Versi |
|-----------|---------|-------|
| Framework | Next.js (App Router) | 14.x |
| Styling | Tailwind CSS | 3.x |
| Data fetching | SWR | 2.x |
| Charts | Recharts | 2.x |
| Date picker | react-day-picker | 8.x |
| Focus trap | focus-trap-react | 10.x |
| Icons | lucide-react | latest |
| Fonts | Inter + JetBrains Mono | via next/font |

---

## 18. Checklist Handoff ke Frontend Engineer

- [ ] Design tokens (Section 2) → masuk ke `globals.css` atau `tailwind.config.js`
- [ ] Layout shell (Section 3) → `components/layout/Sidebar.tsx` + `Topbar.tsx`
- [ ] Semua halaman (Section 4–10) → masing-masing `page.tsx`
- [ ] Reusable components (Section 11) → `components/ui/`
- [ ] Empty/loading/error states (Section 12) → semua page harus handle 3 state ini
- [ ] Admin token via httpOnly cookie (Section 15) → jangan pakai localStorage
- [ ] Model aliases: kolom provider wajib masked by default (Section 9)
- [ ] One-time key reveal: setelah modal ditutup, key TIDAK bisa ditampilkan lagi (Section 7)
- [ ] Konfirmasi revoke sebelum eksekusi (Section 6)
- [ ] Auto-refresh dashboard sesuai interval yang ditentukan (Section 14)

