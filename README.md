# DagingPeople

HRIS Rilis 1 PT Daging Prima Nusantara: aplikasi karyawan (Android & iOS), web admin, kiosk absensi, dan API.
Layar frontend berjalan di atas kontrak `HrisClient`. Klien yang tersedia ada dua: `createMockClient()` dengan data
contoh untuk demo, dan `createHttpClient()` yang terhubung ke API sungguhan. Komponen layar tidak perlu diubah
saat berpindah dari satu klien ke klien lainnya. Detail backend ada di [`apps/api/README.md`](apps/api/README.md).

Sumber: PRD v1.1, wireframe DagingPeople (14 layar), Design System DagingPeople.

## Isi

| Folder | Isi | Stack |
| --- | --- | --- |
| `apps/employee` | Aplikasi karyawan M1–M7 + Profil: beranda & absen, selfie + GPS, absen gudang via QR, hasil absen, jadwal, cuti, slip gaji | React 19 + Vite + Capacitor 7 |
| `apps/api` | Backend: NestJS modular monolith, PostgreSQL 16, pg-boss. Absensi, kiosk, jadwal, cuti, persetujuan, payroll, ekspor Mandiri, data karyawan | NestJS + Postgres |
| `packages/payroll-engine` | Perhitungan gaji sebagai pure function: PPh 21 TER/Pasal 17, BPJS, lembur PP 35/2021, proporsional, RuleSet berversi | TypeScript |
| `apps/web` | Web admin W1–W4 (`/kehadiran`, `/jadwal`, `/persetujuan`, `/payroll`) dan kiosk K1–K3 (`/kiosk/outlet`, `/kiosk/outlet/pin`, `/kiosk/gudang`) | Next.js 15 App Router |
| `packages/tokens` | Token warna/spasi/radius dari Design System → `src/tokens.css` (tema terang & gelap) | — |
| `packages/ui` | Komponen dasar: Button, StatusChip, field berlabel, Card, StatTile, Banner, EmptyState, Icon, AppLink | React |
| `packages/api` | Tipe domain, kontrak `HrisClient`, klien mock & HTTP, daftar endpoint `ROUTES`, format rupiah/jam/tanggal, `useResource` | TypeScript |
| `tools` | `build-demo.mjs` (demo statis semua layar), `smoke-demo.mjs` (screenshot + cek error konsol) | esbuild, Playwright |
| `docs/CONVENTIONS.md` | Aturan tim: token, status, ukuran sentuh, bahasa, aksesibilitas | — |
| `docs/DEPLOY.md` | Deploy produksi: Vercel (web), Docker (API), Postgres, akun HR pertama, checklist go-live | — |
| `docs/SECURITY-REVIEW.md` | Hasil review keamanan: temuan yang sudah diperbaiki dan yang masih terbuka | — |

## Mulai

```bash
npm install
npm run tokens            # bangkitkan tokens.css dari tokens.json
npm run dev:web           # http://localhost:3000 → web admin & kiosk
npm run dev:employee      # http://localhost:5173 → aplikasi karyawan di browser
npm run typecheck
```

Aplikasi native:

```bash
cd apps/employee
npx cap add android && npx cap add ios   # sekali saja
npm run cap:sync
npx cap open android                     # atau: npx cap open ios
```

Demo statis (sama dengan preview yang dibagikan):

```bash
npm run demo              # → demo-dist/index.html
npx serve demo-dist
```

## Deploy

Ikuti [`docs/DEPLOY.md`](docs/DEPLOY.md). Ringkasnya: web di Vercel, API sebagai container (`apps/api/Dockerfile`) di
Railway/Render/Fly, Postgres terkelola di region Jakarta. Akun produksi dibuat dengan CLI admin
(`npm run admin -w @dagingpeople/api-server`), bukan seed. Baca juga [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md).

## Login

| Aplikasi | Layar | Akses | Token disimpan di |
| --- | --- | --- | --- |
| Web admin | `/masuk` (demo: `web.html#/masuk`) | Kepala Toko, HR, Finance, Owner. Akun karyawan diarahkan ke aplikasi HP | `sessionStorage` (hilang saat tab ditutup) |
| Aplikasi karyawan | Layar pertama sebelum Beranda | Akun yang terhubung ke data karyawan (termasuk Kepala Toko) | Keychain/Keystore lewat plugin `SecureStorage`; browser: `sessionStorage` |

Isi `NEXT_PUBLIC_API_URL` (web) atau `VITE_API_URL` (aplikasi) untuk memakai API sungguhan; kosong = data contoh.
Akun contoh: `hr@`, `owner@`, `finance@`, `hendra@` (Kepala Toko), `joko@dagingprima.co.id`, sandi `Demo#2026`.
Absen offline terikat ke karyawan pemiliknya: bila HP dipakai bergantian, absen A tidak pernah terkirim dengan sesi B.

## Mencoba kondisi lapangan

Di aplikasi karyawan, buka **Profil → Simulasi kondisi lapangan** lalu nyalakan "Di luar radius", "Lokasi palsu",
atau "Mode offline". Kiosk PIN contoh: nomor `0042`, PIN `123456` (3x salah mengunci akun 15 menit).

## Status verifikasi

Sudah diuji di sandbox:
- Seluruh 16 rute dibundel dengan esbuild dan dirender di Chromium tanpa error konsol (`tools/smoke-demo.mjs`),
  di 390px, 1024×768 (kiosk), dan 1440px.
- Alur utama lewat Playwright: absen masuk, di luar radius → tugas luar, lokasi palsu ditolak, antrean offline,
  QR gudang kedaluwarsa/valid, cuti dengan validasi, filter kehadiran, ubah & publikasi jadwal, tolak/setujui pengajuan,
  kirim payroll untuk persetujuan, PIN salah 3x lalu terkunci.

Belum bisa diuji (npm registry diblokir di sandbox, jadi dependensi framework tidak terpasang):
- `next build`, `vite build`, `cap sync`, dan `npm run typecheck` dengan `@types/react` asli. Jalankan ini lebih dulu.
- Plugin Capacitor di perangkat nyata (kamera, GPS, pemindai barcode) dan paket `qrcode` asli di kiosk gudang
  (demo memakai pola pengganti).

## Pekerjaan lanjutan

| Area | Yang dibutuhkan | Pemilik |
| --- | --- | --- |
| Deteksi lokasi palsu & jam monotonik | Plugin native `DeviceIntegrity` (Android `Location.isMock()`, iOS `isSimulatedBySoftware`, `elapsedRealtime`). Interface sudah ada di `apps/employee/src/device/capacitor.ts` | Tim native |
| Penyimpanan token native | Plugin Capacitor `SecureStorage` (iOS Keychain, Android Keystore) sesuai antarmuka di `apps/employee/src/device/secureStorage.ts`. Selama belum ada, token hanya di memori (aman, tetapi login ulang tiap aplikasi dibuka) | Tim native |
| Token perangkat kiosk | Layar setup kiosk (HR memasukkan token perangkat sekali, disimpan di tablet) lalu `createHttpClient({ kioskToken, kioskId })` | FE + HR |
| Endpoint yang belum ada | Unggah lampiran cuti dan foto selfie (presigned URL ke object storage), laporan slip ke HR | Backend + FE |
| R1.1 | Tukar shift, jadwal drag-and-drop, notifikasi WhatsApp, navigasi minggu & "Salin minggu lalu" | FE |
| Pemindai QR di web iOS | `BarcodeDetector` tidak ada di Safari; aplikasi native memakai ML Kit, kiosk sebaiknya memakai tablet Android/Chrome | FE |
