# Panduan developer

Layar frontend berjalan di atas kontrak `HrisClient`. Ada dua implementasi: `createMockClient()` dengan data contoh,
dan `createHttpClient()` yang terhubung ke API. Komponen layar tidak berubah saat berpindah klien. Detail backend ada
di [`apps/api/README.md`](../apps/api/README.md), deploy di [`DEPLOY.md`](DEPLOY.md).

## Struktur repo

| Folder | Isi | Stack |
| --- | --- | --- |
| `apps/employee` | Aplikasi karyawan: beranda & absen, selfie + GPS, absen gudang via QR, jadwal, cuti, slip gaji | React 19, Vite, Capacitor 7 |
| `apps/web` | Web admin (`/kehadiran`, `/jadwal`, `/persetujuan`, `/payroll`) dan kiosk (`/kiosk/outlet`, `/kiosk/outlet/pin`, `/kiosk/gudang`) | Next.js 15 App Router |
| `apps/api` | Backend modular monolith: absensi, kiosk, jadwal, cuti, persetujuan, payroll, ekspor Mandiri, data karyawan | NestJS, PostgreSQL, pg-boss |
| `packages/payroll-engine` | Perhitungan gaji sebagai pure function: PPh 21 TER/Pasal 17, BPJS, lembur PP 35/2021, RuleSet berversi | TypeScript |
| `packages/api` | Tipe domain, kontrak `HrisClient`, klien mock & HTTP, daftar endpoint `ROUTES`, format rupiah/jam/tanggal | TypeScript |
| `packages/ui` | Komponen dasar: Button, StatusChip, field berlabel, Card, StatTile, Banner, EmptyState, Icon | React |
| `packages/tokens` | Token warna, spasi, dan radius dari design system → `src/tokens.css` (tema terang & gelap) | |
| `docs/CONVENTIONS.md` | Aturan tim: token, status, ukuran sentuh, bahasa, aksesibilitas | |

## Menjalankan di lokal

Butuh Node 20+ dan PostgreSQL 16+.

```bash
npm install
npm run tokens            # bangkitkan tokens.css dari tokens.json
npm run dev:web           # http://localhost:3000, web admin & kiosk
npm run dev:employee      # http://localhost:5173, aplikasi karyawan di browser
npm run typecheck
```

Tanpa `NEXT_PUBLIC_API_URL` (web) atau `VITE_API_URL` (aplikasi), keduanya memakai data contoh. Untuk API sungguhan:

```bash
cp apps/api/.env.example apps/api/.env      # isi DATABASE_URL dan tiga kunci 32 byte
npm run migrate -w @dagingpeople/api-server
npm run seed -w @dagingpeople/api-server          # data demo
npm run seed:payroll -w @dagingpeople/api-server  # payroll September 2026 sampai Review HR
npm run dev:api                                   # http://localhost:4000/api/v1
```

Lalu isi `apps/web/.env.local` dengan `NEXT_PUBLIC_API_URL=http://localhost:4000`.

Aplikasi native:

```bash
cd apps/employee
npx cap add android && npx cap add ios   # sekali saja
npm run cap:sync
npx cap open android                     # atau: npx cap open ios
```

## Uji

```bash
npm run test:engine   # 35 uji payroll engine: golden case + 500 input acak
npm run test:api      # 62 uji service & e2e terhadap Postgres sungguhan (butuh psql di PATH)
npm test -w @dagingpeople/api
```

## Login

| Aplikasi | Akses | Token disimpan di |
| --- | --- | --- |
| Web admin (`/masuk`) | Kepala Toko, HR, Finance, Owner. Akun karyawan diarahkan ke aplikasi HP | `sessionStorage`, hilang saat tab ditutup |
| Aplikasi karyawan | Akun yang terhubung ke data karyawan, termasuk Kepala Toko | Keychain/Keystore lewat plugin `SecureStorage`; di browser `sessionStorage` |

Akun demo: `hr@`, `owner@`, `finance@`, `hendra@` (Kepala Toko), `joko@dagingprima.co.id`, sandi `Demo#2026`.
Absen offline terikat ke karyawan pemiliknya. Bila HP dipakai bergantian, absen A tidak pernah terkirim dengan sesi B.

## Mencoba kondisi lapangan

Di aplikasi karyawan, buka Profil → Simulasi kondisi lapangan, lalu nyalakan "Di luar radius", "Lokasi palsu",
atau "Mode offline". Kiosk PIN contoh: nomor `0042`, PIN `123456`. Tiga kali salah mengunci akun 15 menit.

## Pekerjaan lanjutan

| Area | Yang dibutuhkan |
| --- | --- |
| Deteksi lokasi palsu & jam monotonik | Plugin native `DeviceIntegrity` (Android `Location.isMock()`, iOS `isSimulatedBySoftware`, `elapsedRealtime`). Interface ada di `apps/employee/src/device/capacitor.ts` |
| Penyimpanan token native | Plugin `SecureStorage` (iOS Keychain, Android Keystore) sesuai `apps/employee/src/device/secureStorage.ts`. Selama belum ada, token hanya di memori |
| Token perangkat kiosk | Layar setup kiosk: HR memasukkan token perangkat sekali, disimpan di tablet |
| Alur payroll di web | Tombol Kunci absensi, persetujuan Owner, kunci periode, dan unduh file Mandiri |
| Endpoint belum ada | Unggah lampiran cuti dan foto selfie lewat presigned URL, ganti sandi, 2FA untuk peran pusat |
| R1.1 | Tukar shift, jadwal drag-and-drop, notifikasi WhatsApp, navigasi minggu & "Salin minggu lalu" |
| Pemindai QR di web iOS | `BarcodeDetector` tidak ada di Safari. Aplikasi native memakai ML Kit; kiosk sebaiknya tablet Android + Chrome |
