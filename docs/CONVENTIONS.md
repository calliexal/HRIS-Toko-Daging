# Konvensi Front-end DagingPeople

Dokumen ini wajib dibaca sebelum menulis kode di `apps/`. Sumber kebenaran:
PRD v1.1 (bagian 0, 6, 7), wireframe DagingPeople (14 layar), dan Design System DagingPeople.

## Struktur

```
packages/tokens   token warna/spasi/radius → src/tokens.css (CSS variables, tema terang & gelap)
packages/ui       komponen dasar: Button, ButtonLink, IconButton, StatusChip, TextField, SelectField,
                  TextAreaField, Card, StatTile, Banner, EmptyState, Skeleton, DemoBadge, Icon, AppLink
packages/api      tipe domain, HrisClient, createMockClient(), format (rupiah/jam/tanggal), ApiProvider/useApi/useResource
apps/employee     aplikasi karyawan: React + Vite + Capacitor (Android & iOS)
apps/web          Next.js App Router: web admin (/kehadiran, /jadwal, /persetujuan, /payroll) dan kiosk (/kiosk/...)
tools/            build-demo.mjs (bundel demo statis), smoke-demo.mjs (screenshot + cek error)
```

## Aturan

1. **Warna hanya lewat token CSS** (`var(--brand)`, `var(--success-tint)`, …). Tidak ada hex di `apps/`.
2. **Status selalu kata + ikon**: pakai `<StatusChip tone=…>` dan `attendanceStatusMeta()` dari `@dagingpeople/api`.
3. **Satu tombol `primary` per layar.** Aksi lain `secondary`/`ghost`.
4. **Sentuh**: kontrol di aplikasi karyawan ≥ 48px; kiosk ≥ 64px (tuts PIN 88px); tabel admin boleh `dense` 36px.
5. **Teks UI bahasa Indonesia sederhana**, label tombol diawali kata kerja ("Absen Masuk", "Ajukan Cuti", "Setujui Cuti").
   Jam `05.58`, tanggal `Rab, 7 Okt 2026`, uang `Rp4.850.000` → selalu lewat helper di `@dagingpeople/api` (`formatClock`, `formatDateShort`, `formatRupiah`).
   Angka (jam, rupiah, hitungan) pakai `font-variant-numeric: tabular-nums` (kelas `dp-num` atau `t-clock`/`t-amount-lg`).
6. **Pesan error tidak menyalahkan pengguna dan selalu memberi jalan keluar.**
7. **Aksesibilitas**: elemen interaktif asli (`button`, `a`, `input` + `label`), fokus terlihat (sudah di styles.css),
   ikon-saja wajib `aria-label` (pakai `IconButton`), pengumuman hasil aksi via `Banner role="alert"` atau `aria-live`.
8. **Data hanya lewat `useApi()`** (klien mock sekarang, HTTP nanti). Jangan impor fixture langsung ke komponen.
   Tampilkan `<DemoBadge show={api.isMock} />` di header tiap layar utama.
9. **Pemuatan**: < 1 detik tanpa spinner; lebih lama pakai `Skeleton`. Tombol aksi memakai prop `loading`.
10. **Komponen fitur framework-agnostic**: kode di `apps/web/src/features/**` TIDAK boleh mengimpor `next/*`
    (build demo akan gagal). Navigasi pakai `<AppLink>` / `<ButtonLink>`; Next.js menyuntikkan `next/link` lewat `LinkProvider`.
11. **CSS**: satu stylesheet global per permukaan (`apps/employee/src/styles/app.css`, `apps/web/src/styles/admin.css`,
    `apps/web/src/styles/kiosk.css`), kelas dengan prefiks (`emp-`, `adm-`, `ksk-`). Layout fluid; admin harus tetap
    terpakai di lebar 375px (sidebar menumpuk, tabel scroll horizontal di dalam kotaknya sendiri).
12. **TypeScript strict**, `const` arrow function, named export, tanpa `any`.

## Verifikasi (wajib sebelum menyatakan selesai)

```
DEMO_NODE_PATH=/opt/npm-tools/node_modules:/opt/node-tools/node_modules node tools/build-demo.mjs
DEMO_NODE_PATH=/opt/npm-tools/node_modules:/opt/node-tools/node_modules node tools/smoke-demo.mjs <folder-screenshot> "employee.html#/beranda@390x844" ...
```
Lalu buka PNG hasil screenshot dengan tool Read dan periksa tampilannya dibandingkan wireframe.
(Di sandbox ini npm registry diblokir; React 19, esbuild, dan Playwright tersedia di path di atas.
Next.js/Vite/Capacitor tidak bisa dipasang, jadi file khusus framework ditulis dengan teliti tanpa bisa dijalankan.)
