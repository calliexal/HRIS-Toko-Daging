# DagingPeople API

Backend HRIS PT Daging Prima Nusantara. Arsitekturnya modular monolith NestJS di atas PostgreSQL 16, dengan job
terjadwal lewat pg-boss (antrean di Postgres yang sama, tanpa Redis). Perhitungan gaji ada di
`packages/payroll-engine`, sebuah library pure function yang tidak menyentuh database.

## Struktur

| Folder | Isi |
| --- | --- |
| `db/migrations` | `0001_init` (seluruh skema, view, trigger integritas), `0002_overtime_order`, `0003_payroll_ytd_import`, `0004_login_lockout` |
| `db/tests/schema.test.sql` | 30 uji skema: event absen append-only, audit hash-chain, payroll beku setelah disetujui, transisi status satu arah |
| `src/common` | `Db` (antarmuka SQL minimal), error domain, aktor dan peran, jam (bisa diganti saat uji), keamanan (scrypt, AES-256-GCM, HMAC blind index, JWT HS256) |
| `src/modules/*` | Satu folder per modul domain: `attendance`, `kiosk`, `scheduling`, `leave`, `approvals`, `payroll`, `core-hr`, `auth` |
| `src/app/container.ts` | Merakit semua service. Dipakai oleh NestJS dan server uji |
| `src/http` | Tabel handler per endpoint, schema zod, autentikasi, pemetaan error ke HTTP, server `node:http` untuk uji e2e |
| `src/nest` | `AppModule`, `AuthGuard` global (default tertutup), `ErrorFilter`, controller tipis yang dihasilkan dari `ROUTES` |
| `src/jobs/scheduler.ts` | pg-boss: `leave-escalation` (tiap jam) dan `deactivate-leavers` (harian 00.10 WIB) |
| `src/seed` | Data demo yang sama dengan mock frontend. Login semua akun demo: `Demo#2026` |
| `test` | Uji service dan e2e terhadap Postgres sungguhan (satu database terisolasi per file uji) |

Daftar endpoint ada di `packages/api/src/routes.ts`, dengan prefix `/api/v1`. Frontend (`createHttpClient`) dan
controller NestJS sama-sama membaca file ini, dan `test/routes.test.ts` memastikan keduanya tetap sinkron.

## Menjalankan

```bash
cp .env.example .env            # isi DATABASE_URL dan tiga kunci 32 byte (base64)
npm install
npm run migrate -w @dagingpeople/api-server
npm run seed -w @dagingpeople/api-server      # opsional, hanya untuk lokal/staging
npm run dev -w @dagingpeople/api-server       # http://localhost:4000/api/v1
```

Membuat kunci: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

| Variabel | Fungsi |
| --- | --- |
| `DATABASE_URL` | Koneksi Postgres 16 (wajib zona waktu server `Asia/Jakarta` atau UTC; semua query memakai `AT TIME ZONE` eksplisit) |
| `DATA_KEY` | Mengenkripsi NIK, nomor rekening, dan rahasia QR kiosk. Di produksi dibungkus KMS (envelope encryption), jangan disimpan polos di repo atau image |
| `INDEX_KEY` | HMAC untuk blind index NIK, hash token kiosk, dan hash kartu |
| `JWT_KEY` | Tanda tangan token sesi |
| `JWT_TTL_SECONDS` | Umur sesi, default 12 jam |
| `LEGAL_ENTITY_ID` | Badan hukum payroll v1, default `dpn` |
| `CORS_ORIGINS` | Daftar origin web admin dan aplikasi, dipisah koma |
| `RUN_JOBS` | `false` di replika tambahan agar job hanya jalan di satu instance |

## Uji

```bash
# Butuh Postgres lokal (PGHOST/PGPORT/PGUSER) dan psql di PATH.
npm test -w @dagingpeople/api-server         # bangun template DB (migrasi + seed), lalu semua uji service & e2e
npm run test:sql -w @dagingpeople/api-server # uji skema
npm test -w @dagingpeople/payroll-engine     # 35 uji engine (golden + 500 kasus acak)
```

Uji service tidak memakai mock database. Setiap file uji mendapat salinan template DB yang sudah dimigrasi dan
di-seed, dengan "hari ini" dikunci ke Rabu, 7 Okt 2026 pukul 05.52 WIB. Kasus yang dicakup:

- **Absensi**:
  - GPS dalam radius, idempoten per `clientUuid`, lokasi palsu ditolak tetapi tetap tercatat.
  - Di luar radius ditolak; tugas luar disetujui Kepala Toko.
  - Offline lebih dari 12 jam masuk review.
  - Koreksi absen hanya bisa diputuskan HR.
- **Kiosk**:
  - Token perangkat wajib.
  - Kartu: tap pertama masuk, tap kedua pulang.
  - PIN salah 3 kali mengunci 15 menit per karyawan.
  - QR dinamis gudang: sah, kedaluwarsa, dan palsu dibedakan.
- **Jadwal**: mengubah sel mengembalikan jadwal ke draf; peringatan kurang orang wajib dikonfirmasi sebelum terbit.
- **Cuti**:
  - Saldo ditahan saat masih pending; tanggal yang tumpang tindih ditolak.
  - Dampak ke jadwal tampil di inbox; sel cuti terkunci; hari Minggu tidak ikut terisi cuti.
  - Eskalasi ke HR setelah 48 jam.
- **Payroll September 2026**:
  - Input dari DB identik dengan golden case engine. THP Joko Rp5.805.910, sama dengan hitungan manual.
  - Hash input/output bisa di-replay.
  - Owner menolak lalu menyetujui.
  - Trigger membekukan item yang sudah disetujui.
  - Penguncian butuh konfirmasi yang diketik.
  - Total file Mandiri sama dengan total THP.
  - Slip hanya milik sendiri; YTD dibawa ke Oktober.
- **Data karyawan**:
  - Nomor DPN berurutan; NIK dan rekening tersimpan terenkripsi; NIK ganda ditolak.
  - Upah tersimpan berversi; audit tidak mencatat nominal.
  - PIN lemah ditolak.
  - Offboarding diproses oleh job harian.
  - Rantai hash audit utuh.
- **Login**: identitas pengguna ikut di respons; 5x sandi salah mengunci 15 menit (sandi benar pun ditolak selama terkunci);
  akun nonaktif mendapat pesan jelas; token yang diubah, kedaluwarsa, atau milik akun nonaktif ditolak.
- **HTTP e2e**: `createHttpClient` frontend memanggil server, lalu service dan Postgres. Mencakup 401/403/404/422,
  alur payroll lengkap, dan kiosk.

## Status verifikasi

| Bagian | Status |
| --- | --- |
| Payroll Engine | 35/35 lolos |
| Skema SQL (Postgres 16) | 30/30 lolos |
| Service dan HTTP e2e | 57/57 lolos, berjalan di Postgres 16 sungguhan |
| Typecheck (`tsc --strict`) | Lolos untuk semua kode di luar lapisan framework (`tsconfig.offline.json`) |
| Lapisan NestJS, `pg`, dan pg-boss (`src/nest`, `src/main.ts`, `src/common/pg-db.ts`, `src/jobs`, `src/db/migrate.ts`) | **Belum dijalankan.** npm registry diblokir di sandbox. Lapisan ini sengaja dibuat tipis: guard, filter, dan controller hanya memanggil `resolveAuth`, `toHttpError`, dan tabel handler yang sudah teruji e2e. Langkah pertama setelah `npm install` adalah `npm run typecheck` lalu smoke test `npm run dev` |

Perbedaan driver yang sudah diantisipasi:
- Executor uji (`psql`) menolak parameter yang tidak dipakai, sama seperti `pg`.
- Parameter JSONB selalu dikirim lewat `JSON.stringify`.
- Kolom BIGINT, NUMERIC, dan DATE di-parse dengan bentuk yang sama di kedua driver.

## Keputusan desain penting

- **Waktu absen dari server.** Event offline memakai jam monotonik perangkat; selisih lebih dari 12 jam masuk review.
- **Absensi append-only.** Koreksi disimpan sebagai baris terpisah, dan view `attendance_day_v` memberi prioritas
  pada koreksi yang disetujui.
- **Status payroll satu arah**, dijaga trigger:

  ```
  draft → attendance_locked → calculated → hr_review → owner_approval → approved → locked → exported
  ```

  Ada dua jalur balik: ditolak Owner kembali ke `hr_review`, dan hitung ulang dari `hr_review` lewat `calculated`.
- **Pengajuan payroll ditahan** jika ada THP negatif. Karyawan yang datanya kurang ditandai `needs_review` dan tidak
  menahan karyawan lain.
- **Tanggal bayar 28.** Jika jatuh di hari Minggu atau libur, dibayar di hari kerja sebelumnya (misalnya 27 Feb 2027).
- **Data gaji** hanya bisa dilihat HR, Finance, dan Owner. Kepala Toko dan karyawan mendapat 403. Slip karyawan
  hanya muncul untuk periode yang sudah dikunci.

## Temuan terbuka (perlu keputusan)

| # | Temuan | Default sementara |
| --- | --- | --- |
| 1 | Shift 8 jam × 6 hari = 42 jam efektif per minggu (dengan istirahat 1 jam), melebihi 40 jam (UU 13/2003 jo. PP 35/2021). Kelebihannya wajib dibayar lembur | Jadwal memberi peringatan; keputusan pola jam ada di HR/Legal |
| 2 | Spesifikasi file bulk payroll Mandiri MCM | Template CSV di `payroll/bank-export.ts`, wajib dicocokkan dengan RM Mandiri |
| 3 | Batas upah JP 2026 (Rp11.086.300 mulai Mar 2026) | Perlu dicek ulang dengan surat resmi BPJS TK |
| 4 | BPJS untuk harian lepas (Kesehatan dan JP) | Seed: hanya BPJS Ketenagakerjaan (JKK, JKM, JHT) |
| 5 | Aturan harian lepas ≥ 21 hari selama 3 bulan | Ditandai di payroll; pasal persisnya perlu verifikasi Legal |
| 6 | Rate-limit login per IP | **Lockout per akun sudah ada** (5x salah → 15 menit, migrasi 0004). Tetap pasang limit per IP di gateway/WAF (mis. 10 percobaan/menit/IP) |
| 7 | Kiosk bisa mencari karyawan semua lokasi lewat kode | Pertimbangkan membatasi ke lokasi kiosk (PDP), kecuali karyawan lintas lokasi |
| 8 | Notifikasi push/WA untuk pengingat dan eskalasi | Job sudah mencatat ke log; integrasinya menyusul |
| 9 | Plugin native `DeviceIntegrity` (deteksi lokasi palsu dan jam monotonik) | Antarmuka tersedia di aplikasi karyawan |
