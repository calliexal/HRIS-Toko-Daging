# Deploy DagingPeople

Susunan yang disarankan:

| Bagian | Tempat | Alasan |
| --- | --- | --- |
| Web admin + kiosk (`apps/web`) | **Vercel** | Next.js. Web hanya tampilan; tidak menyimpan data karyawan. |
| API (`apps/api`) | **Railway, Render, Fly.io, atau VPS** (lewat `apps/api/Dockerfile`) | Server harus terus menyala: job pg-boss (eskalasi cuti tiap jam, nonaktifkan karyawan keluar tiap 00.10 WIB) tidak jalan di serverless Vercel. |
| PostgreSQL 16+ | Postgres terkelola, **region Jakarta** (AWS `ap-southeast-3`, GCP `asia-southeast2`) | Berisi NIK, rekening, dan gaji (data pribadi menurut UU PDP 27/2022). |

Urutan deploy: database → API → buat akun HR pertama → web → kiosk.

---

## 1. Database

1. Buat database Postgres 16+ dan catat connection string-nya (`postgres://user:sandi@host:5432/db?sslmode=require`).
2. Set zona waktu database ke WIB (atau biarkan UTC; semua query memakai `AT TIME ZONE` eksplisit):
   ```sql
   ALTER DATABASE namadb SET timezone TO 'Asia/Jakarta';
   ```
3. Aktifkan backup otomatis harian di penyedia database.

## 2. API

### Kunci rahasia (sekali, untuk produksi)

Bangkitkan **tiga kunci berbeda**. Jangan pakai kunci dari `.env` lokal.

```bash
node -e "for (const k of ['DATA_KEY','INDEX_KEY','JWT_KEY']) console.log(k + '=' + require('crypto').randomBytes(32).toString('base64'))"
```

> **Backup `DATA_KEY` di dua tempat aman** (mis. password manager perusahaan + brankas offline).
> Kunci ini mengenkripsi NIK, nomor rekening, dan rahasia QR kiosk. Bila hilang, data itu tidak bisa dibaca lagi selamanya.
> Bila bocor, anggap NIK & rekening ikut bocor.

### Environment variables

| Variabel | Nilai produksi |
| --- | --- |
| `NODE_ENV` | `production` (wajib: mengaktifkan HSTS, pemeriksaan konfigurasi, dan memblokir seed demo) |
| `DATABASE_URL` | connection string langkah 1 |
| `DATA_KEY`, `INDEX_KEY`, `JWT_KEY` | tiga kunci di atas |
| `CORS_ORIGINS` | domain web, mis. `https://hr.dagingprima.co.id,capacitor://localhost,https://localhost` (dua terakhir untuk aplikasi Android/iOS). Hanya `https://`/`capacitor://`; API menolak start bila ada `http://`. |
| `TRUST_PROXY` | `1` di Railway/Render/Fly (ada satu proxy di depan API). `0` bila API langsung menghadap internet. |
| `JWT_TTL_SECONDS` | `43200` (12 jam) |
| `LEGAL_ENTITY_ID` | `dpn` |
| `RUN_JOBS` | `true` di satu instance saja; `false` di replika tambahan |
| `PORT` | biasanya diisi otomatis oleh platform |

### Build & jalankan

Image dibangun dari **root repo**:

```bash
docker build -f apps/api/Dockerfile -t dagingpeople-api .
```

- **Railway**: New Service → GitHub repo → Settings → Build: Dockerfile path `apps/api/Dockerfile`, root `/`.
  Pre-deploy command: `node --import tsx src/db/migrate.ts`.
- **Render**: New Web Service → Docker → Dockerfile path `./apps/api/Dockerfile`, Docker context `.`.
  Pre-deploy command: `node --import tsx src/db/migrate.ts`.
- **Fly.io**: `fly launch --dockerfile apps/api/Dockerfile`, lalu `release_command = "node --import tsx src/db/migrate.ts"` di `fly.toml`.

Migrasi aman dijalankan berulang (hanya menerapkan yang belum ada). **Jangan jalankan `seed` di produksi**; perintah itu memang ditolak bila `NODE_ENV=production`.

Cek: `https://api.domain-anda/api/v1/me` harus menjawab `401` (berarti API hidup dan autentikasi aktif).

### Rate limit di gateway

API sudah membatasi login (20/menit/IP) dan PIN kiosk (60/menit/IP) di memori. Batas itu per instance; bila API
dijalankan lebih dari satu replika, pasang juga rate limit di gateway (Cloudflare WAF rate limiting, atau fitur platform).

## 3. Data awal (lokasi, shift, akun)

Lokasi dan template shift adalah data biasa, masukkan lewat SQL (pgAdmin / psql):

```sql
INSERT INTO legal_entity (id, name, npwp) VALUES ('dpn', 'PT Daging Prima Nusantara', '<npwp>');

-- radius_m 20–1000. region_code = kunci wilayah upah di RuleSet payroll (packages/payroll-engine/src/rulesets.ts),
-- mis. 'DKI_JAKARTA'. jkk_risk sesuai tingkat risiko BPJS JKK: very_low | low | medium | high | very_high.
INSERT INTO location (id, legal_entity_id, name, type, lat, lng, radius_m, region_code, jkk_risk) VALUES
  ('kemang', 'dpn', 'Outlet Kemang', 'outlet', -6.260700, 106.813700, 100, 'DKI_JAKARTA', 'low');

-- Kode shift: P (Pagi), S (Siang), SB (Subuh).
INSERT INTO shift_template (location_id, code, name, start_time, end_time, min_staff) VALUES
  ('kemang', 'P', 'Pagi', '06:00', '14:00', 3),
  ('kemang', 'S', 'Siang', '13:00', '21:00', 2);

-- Libur nasional & cuti bersama setahun (memengaruhi hitungan hari cuti, jadwal, dan payroll).
INSERT INTO holiday (date, name) VALUES ('2026-12-25', 'Hari Raya Natal'), ('2027-01-01', 'Tahun Baru Masehi');
```

Wilayah di luar yang sudah ada di RuleSet payroll perlu ditambahkan dulu ke `rulesets.ts` (UMK dan aturan wilayahnya).

Akun dan perangkat kiosk dibuat lewat CLI admin (sandi & token dibangkitkan acak, hash saja yang disimpan).
Jalankan di shell platform (Railway: `railway run`, Render: Shell, Fly: `fly ssh console`), dari folder `apps/api`:

```bash
node --import tsx src/admin/cli.ts user:create --email hr@dagingprima.co.id --role hr
node --import tsx src/admin/cli.ts user:create --email owner@dagingprima.co.id --role owner
node --import tsx src/admin/cli.ts user:create --email finance@dagingprima.co.id --role finance
```

Di lokal cukup `npm run admin -w @dagingpeople/api-server -- <perintah>`. Perintah lain:

| Perintah | Kegunaan |
| --- | --- |
| `user:create --email … --role store_manager --employee <id> --locations kemang` | Kepala Toko |
| `user:create --email … --role employee --employee <id>` | Akun aplikasi karyawan (karyawan dibuat dulu lewat `POST /employees`) |
| `user:reset-password --email …` | Sandi baru + buka kunci login |
| `user:deactivate --email …` | Cabut akses seketika |
| `kiosk:create --id kiosk-kemang-1 --location kemang --name "Kiosk Kasir Kemang" --mode card` | Daftarkan tablet kiosk (`card` atau `dynamic_qr`) |
| `kiosk:rotate-token --id …` / `kiosk:deactivate --id …` | Tablet hilang atau token bocor |

Sandi awal tampil **sekali**. Serahkan langsung ke pemiliknya lewat jalur aman (bukan grup chat).

## 4. Web di Vercel

1. Vercel → Add New Project → pilih repo.
2. **Root Directory**: `apps/web`. Framework terdeteksi Next.js; biarkan install command bawaan (Vercel memasang
   workspace npm dari root repo).
3. Environment Variables (Production **dan** Preview):

   | Variabel | Nilai |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `https://api.domain-anda` (tanpa `/api/v1`) |

   Variabel ini dibaca saat build. Setelah diubah, **Redeploy**. Build produksi sengaja gagal bila variabel ini kosong
   atau `http://`, supaya web tidak pernah tayang dengan data contoh dan akun demo.
4. Settings → Domains: pasang domain tetap (mis. `hr.dagingprima.co.id`) dan masukkan domain yang sama ke `CORS_ORIGINS` API.
5. Settings → Deployment Protection: aktifkan **Vercel Authentication** untuk Preview. URL preview acak tidak lolos CORS
   API, dan sebaiknya tidak bisa dibuka publik.

Header keamanan (CSP ber-nonce, HSTS, X-Frame-Options, Permissions-Policy) sudah dipasang oleh `apps/web/src/middleware.ts`
dan `apps/web/next.config.ts`.

## 5. Kiosk

1. Buat perangkat dengan `kiosk:create` (langkah 3) dan catat token-nya.
2. Layar setup kiosk (memasukkan token ke tablet) **belum ada**; lihat "Pekerjaan lanjutan" di README.
   Sampai layar itu dibuat, kiosk produksi belum bisa dipakai.
3. Pakai tablet Android + Chrome (pemindai QR/kartu butuh `BarcodeDetector`, tidak tersedia di Safari iOS).

## 6. Aplikasi karyawan (Android/iOS)

Build rilis wajib diisi `VITE_API_URL=https://api.domain-anda`. Tanpa itu aplikasi memakai data contoh.
Plugin native `SecureStorage` dan `DeviceIntegrity` masih harus dibuat tim native sebelum rilis ke toko aplikasi.

---

## Checklist go-live

- [ ] Database di region Jakarta, backup harian aktif
- [ ] Tiga kunci produksi baru, `DATA_KEY` dibackup di dua tempat aman
- [ ] `NODE_ENV=production`, `TRUST_PROXY` sesuai platform, `CORS_ORIGINS` hanya domain https
- [ ] Migrasi jalan sebagai pre-deploy command; seed **tidak** dijalankan
- [ ] `GET /api/v1/me` → 401; login HR berhasil dari domain web
- [ ] Akun demo (`*@dagingprima.co.id` / `Demo#2026`) **tidak ada** di database produksi
- [ ] `NEXT_PUBLIC_API_URL` https diisi di Vercel, domain tetap terpasang, preview dilindungi
- [ ] Format file Mandiri MCM sudah dicocokkan dengan spesifikasi resmi dari RM Bank Mandiri (`apps/api/src/modules/payroll/bank-export.ts`)
- [ ] Hasil payroll satu periode dibandingkan dengan hitungan manual sebelum dipakai membayar
- [ ] Temuan terbuka di `docs/SECURITY-REVIEW.md` sudah diputuskan (diperbaiki atau diterima)

---

## Lampiran: instance demo untuk calon pembeli

Instance demo memakai database terpisah yang diisi data contoh. **Jangan pernah memasukkan data karyawan asli ke instance demo**:
akun demo (`*@dagingprima.co.id` / `Demo#2026`) tercantum di repo, jadi siapa pun bisa masuk.

1. Database baru → jalankan migrasi, lalu dari mesin lokal dengan `DATABASE_URL` mengarah ke database demo dan kunci yang sama dengan API demo:
   ```bash
   NODE_ENV=development npm run seed -w @dagingpeople/api-server
   NODE_ENV=development npm run seed:payroll -w @dagingpeople/api-server
   ```
   `seed:payroll` menyiapkan payroll September 2026 (absensi, lembur, Budi mangkir sehari) sampai tahap Review HR;
   THP Joko Rp5.805.910 sama dengan hitungan manual. Halaman Payroll menampilkan periode belum selesai yang paling lama.
2. Di Vercel tambahkan `NEXT_PUBLIC_DEMO_KIOSK_TOKENS` =
   `{"kiosk-kemang-1":"dev-token-kiosk-kemang-1","kiosk-gudang-1":"dev-token-kiosk-gudang-1"}` agar halaman kiosk
   tersambung ke API. Variabel ini terkirim ke peramban: **hanya untuk token demo**, jangan untuk token kiosk produksi.
3. Untuk mengembalikan demo ke kondisi awal: kosongkan database demo (buat ulang), lalu ulangi langkah 1.
