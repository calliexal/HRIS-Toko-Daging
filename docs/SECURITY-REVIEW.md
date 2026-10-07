# Review keamanan DagingPeople — 7 Oktober 2026

**Cakupan:** seluruh kode sumber API (`apps/api/src`, ±3.600 baris: autentikasi, otorisasi per endpoint, kriptografi,
kiosk, absensi, cuti, jadwal, payroll, data karyawan), titik rawan XSS dan redirect di web & aplikasi karyawan,
konfigurasi deploy, dan audit dependensi (`npm audit --omit=dev`).

**Metode:** baca kode manual, lalu setiap temuan yang bisa diuji dibuktikan terhadap API yang berjalan atau lewat
uji otomatis. Ini **bukan** uji penetrasi menyeluruh; sebelum go-live dengan data karyawan sungguhan, pertimbangkan
pentest oleh pihak ketiga.

**Hasil uji setelah perbaikan:** 59/59 uji API lulus (termasuk 2 uji baru untuk serangan paralel), 3/3 uji rate limit,
35/35 uji payroll engine, typecheck web + aplikasi karyawan + API bersih, build produksi web berhasil.

---

## Yang sudah baik

- **Otorisasi konsisten di lapisan service**, bukan di controller. Setiap method memanggil `requireRole` / `requireLocation`
  / `requireEmployee`; Kepala Toko dibatasi ke lokasinya, data gaji hanya HR/Finance/Owner, slip gaji hanya milik sendiri
  dan hanya periode terkunci.
- **Endpoint tertutup secara default**: endpoint tanpa deklarasi auth ditolak AuthGuard.
- **Peran dibaca ulang dari database setiap request**: menonaktifkan akun atau mencabut peran berlaku seketika.
- **Pemisahan tugas payroll**: HR menghitung dan mengajukan, hanya Owner yang menyetujui, kunci periode butuh konfirmasi
  yang diketik, dan trigger database membekukan payroll yang sudah disetujui.
- **Tidak bisa menyetujui pengajuan sendiri** (cuti, tugas luar, absen offline), dicek di daftar dan saat memutuskan.
- **Kriptografi benar**: scrypt untuk sandi & PIN, AES-256-GCM (IV acak, auth tag) untuk NIK & rekening, blind index HMAC
  untuk keunikan NIK, perbandingan konstan-waktu (`timingSafeEqual`), JWT HS256 dengan cek `exp`.
- **Anti enumerasi akun**: email tak dikenal dan sandi salah mendapat pesan dan waktu respons yang sama.
- **SQL selalu berparameter**; tidak ditemukan SQL injection.
- **Audit log hash-chain** untuk aksi sensitif, tanpa nominal gaji atau PII mentah di isinya.
- **Error 500 tidak membocorkan stack/SQL** ke klien.
- **Frontend**: tidak ada `dangerouslySetInnerHTML`/`innerHTML`/`eval`; redirect setelah login dilindungi dari open redirect.

---

## Temuan yang sudah diperbaiki

| # | Tingkat | Temuan | Perbaikan |
| --- | --- | --- | --- |
| 1 | **Tinggi** | **Batas 5x salah sandi bisa dilewati dengan request paralel.** Hitungan dibaca lalu ditulis ulang (read-modify-write), jadi request bersamaan membaca hitungan lama. Dibuktikan: 20 tebakan paralel → akun tidak terkunci, hitungan hanya 2. Penebak bisa mencoba sandi tanpa batas. | Jatah percobaan dipesan **atomik sebelum** sandi diperiksa (`UPDATE … SET failed_login_count = failed_login_count + 1 … RETURNING`). Setelah perbaikan: 20 tebakan paralel → hanya 5 diperiksa, 15 ditolak terkunci. Uji regresi di `test/core-hr.test.ts`. |
| 2 | **Tinggi** | **Batas 3x salah PIN kiosk bisa dilewati dengan cara yang sama.** PIN hanya 6 digit (1 juta kemungkinan), jadi batas percobaan adalah satu-satunya pelindung. | Pola atomik yang sama di `kiosk.service.ts`. Uji regresi di `test/attendance.test.ts`. |
| 3 | Sedang | **Tidak ada rate limit per IP, dan scrypt berjalan sinkron.** Satu scrypt membekukan seluruh server puluhan milidetik; banjir request login bisa melumpuhkan API untuk semua pengguna. | `verifySecret` kini asinkron (thread pool). Rate limit per IP: login 20/menit, PIN kiosk & lookup kode karyawan 60/menit → `429` + `Retry-After` (`src/http/rate-limit.ts`). `TRUST_PROXY` agar IP asli terbaca di balik proxy. |
| 4 | Sedang | **Tidak ada cara membuat akun atau mendaftarkan kiosk di produksi.** Hanya seed yang membuatnya, dan seed diblokir di produksi. | CLI admin `src/admin/cli.ts` (`npm run admin`): buat akun, reset sandi, nonaktifkan, daftarkan/putar token/nonaktifkan kiosk. Sandi & token acak, tampil sekali, hanya hash yang disimpan, setiap aksi diaudit. |
| 5 | Sedang | **Web diam-diam memakai data contoh bila `NEXT_PUBLIC_API_URL` lupa diisi**, lengkap dengan akun demo `Demo#2026` yang bisa dimasuki siapa saja. | Build produksi Vercel gagal bila variabel kosong atau `http://` (`apps/web/next.config.ts`). |
| 6 | Sedang | **Web tanpa CSP dan header keamanan.** Token sesi ada di `sessionStorage`, jadi satu celah XSS cukup untuk mencurinya. | CSP dengan nonce per request + `strict-dynamic`, `connect-src` hanya ke origin sendiri & API, `frame-ancestors 'none'`, `object-src 'none'`; plus HSTS, X-Frame-Options, Permissions-Policy, COOP (`apps/web/src/middleware.ts`). Diuji di mode produksi: semua halaman berjalan, tanpa pelanggaran CSP. |
| 7 | Rendah | **CSV injection di file bank Mandiri.** Nama berawalan `=` / `+` / `-` / `@` dieksekusi sebagai formula saat Finance membuka CSV di Excel. | Karakter awal formula dibuang di `bank-export.ts`. |
| 8 | Rendah | Konfigurasi produksi berbahaya tetap diterima (CORS `http://`, tiga kunci sama, `DATABASE_URL` kosong → database lokal). | API menolak start di `NODE_ENV=production` dengan konfigurasi tersebut (`src/common/config.ts`). |
| 9 | Rendah | Respons API berisi data gaji bisa di-cache; tanpa HSTS; header `X-Powered-By: Express` membocorkan stack. | `Cache-Control: no-store` di semua respons API, HSTS di produksi, `X-Powered-By` dimatikan. |
| 10 | Rendah | Body JWT rusak dengan tanda tangan sah membuat server error 500. | Ditangani sebagai token tidak sah (401). |

Perbaikan fungsional lain di sesi yang sama: API gagal start (injeksi `Reflector`), hydration error di `/masuk`, dan
halaman Payroll memakai periode demo yang ditulis mati.

---

## Temuan terbuka (perlu keputusan)

| # | Tingkat | Temuan | Rekomendasi |
| --- | --- | --- | --- |
| A | Sedang | **Tanpa 2FA untuk HR, Finance, dan Owner**, padahal akun ini bisa melihat gaji, NIK, dan mengekspor rekening seluruh karyawan. Kolom `app_user.totp_secret_ciphertext` sudah ada tetapi belum dipakai. | Wajibkan TOTP untuk peran pusat sebelum go-live. |
| B | Sedang | **Pengguna tidak bisa mengganti sandi sendiri**; tidak ada alur lupa sandi. Sandi awal dari CLI harus diserahkan manual. | Endpoint ganti sandi (wajib saat login pertama) dan alur reset lewat HR. |
| C | Sedang | **Lokasi palsu & jam perangkat dipercaya dari klien.** `isMock` dan jam saat offline dikirim aplikasi; server tidak bisa memverifikasinya. Sudah diketahui di README. | Plugin native `DeviceIntegrity` (Android `isMock()`, iOS `isSimulatedBySoftware`, `elapsedRealtime`), dan Play Integrity / App Attest untuk memastikan request dari aplikasi asli. |
| D | Rendah–Sedang | **QR dinamis gudang bisa diteruskan** dalam jendela 60 detik (difoto lalu dikirim ke rekan yang belum tiba). | Wajibkan juga GPS di dalam radius gudang untuk metode `app_qr`, atau perpendek jendela. |
| E | Rendah | **Kiosk menerima karyawan dari lokasi mana pun**; karyawan Kemang bisa absen di kiosk Gudang (tercatat di lokasi kiosk). | Putuskan: memang diizinkan (karyawan berpindah lokasi) atau batasi ke lokasi karyawan + lokasi yang dijadwalkan. |
| F | Rendah | Pemegang token kiosk bisa melihat nama & jabatan karyawan dengan menebak kode 0001–9999. | Kini dibatasi 60/menit/IP. Bila perlu, tampilkan nama tersamar (mis. "Joko P."). |
| G | Rendah | Token sesi admin di `sessionStorage` bisa dibaca JavaScript. | Sudah dimitigasi CSP. Opsi lebih kuat: cookie `HttpOnly; Secure; SameSite=Strict` (butuh perubahan API & proteksi CSRF). |
| H | Rendah | JWT tidak bisa dicabut saat logout (berlaku sampai 12 jam). Menonaktifkan akun tetap mencabut akses seketika. | Pertimbangkan TTL lebih pendek untuk peran pusat, atau daftar token dicabut. |
| I | Rendah | `next` membawa `postcss` versi rentan (GHSA-qx2v-qp2m-jg93 dkk.). PostCSS hanya dipakai saat build untuk CSS milik proyek sendiri, jadi tidak bisa dijangkau penyerang saat runtime. | Ikuti saat upgrade ke Next 16 (perubahan besar); jangan `npm audit fix --force` tanpa uji. |
| J | Info | Rate limit API disimpan di memori, berlaku per instance. | Bila lebih dari satu replika, pasang rate limit di gateway. |
| K | Info | `photoRef` dan lampiran cuti masih string bebas dari klien; endpoint unggah belum ada. | Saat dibuat: presigned URL, batasi tipe & ukuran file, nama objek dari server. |
| L | Info | Format file Mandiri MCM masih template. | Cocokkan dengan spesifikasi resmi dari RM Bank Mandiri sebelum dipakai membayar. |
