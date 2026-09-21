# AGENTS.md

Panduan untuk AI coding agent yang bekerja di repo ini. Baca sebelum mengubah kode.

## Project Overview

Web statis (mobile-first) untuk **pendataan penerima Beasiswa Bank Indonesia (GenBI)** dan **pengambilan tas**. Fitur inti: import massal dari Excel/Sheets, pencarian nama cepat, tandai/batalkan pengambilan, rekap, dan **halaman publik live** untuk cek status mandiri.

- **PRD:** `docs/PRD.md` — sumber kebenaran fitur. Baca dulu bila mengerjakan fitur baru.
- **Bahasa UI:** Bahasa Indonesia. Semua label, pesan error, dan tombol berbahasa Indonesia.
- Ada **dua antarmuka**: panel admin (login) di `index.html`, dan halaman publik (tanpa login) di `publik.html`.

## Tech Stack

- HTML + **Tailwind CSS via CDN** (`https://cdn.tailwindcss.com`)
- **Vanilla JavaScript** (tanpa framework/build step)
- **Supabase JS v2 via CDN** (`@supabase/supabase-js@2`)
- Database: Supabase PostgreSQL

Jangan menambahkan React, Vue, Next.js, Node backend, bundler, atau ORM. PRD secara eksplisit melarang ini.

## Commands

Belum ada build/test tooling. Untuk menjalankan lokal, buka lewat static server (bukan `file://`, agar Supabase callback bekerja), mis.:

```powershell
python -m http.server 5500
# atau
npx serve .
```

- Panel admin: `http://localhost:5500/index.html`
- Halaman publik: `http://localhost:5500/publik.html`

Jika kelak ada script npm/lint/test, perbarui bagian ini.

## File Layout

```
index.html    # panel admin: dashboard, tabel, modal, fast mode, import
app.js        # logika admin: init supabase, fetch, render, CRUD, import parser
publik.html   # halaman publik: rekap progres + cek status via Nama
publik.js     # logika publik: polling RPC, render, kontrol visibility
config.js     # (opsional) kredensial Supabase — JANGAN commit nilai asli
docs/PRD.md   # spesifikasi produk
```

- Pisahkan logika admin dan publik. Jangan menaruh logika publik di `app.js` atau sebaliknya.
- Jangan menaruh logika bisnis di file `.html` selain wiring event tipis.

## Konvensi Kode

- Gunakan `const`/`let`, arrow function, `async/await`. Modul ES (`type="module"`) bila memungkinkan.
- Nama variabel/fungsi: `camelCase` untuk JS, `snake_case` untuk kolom DB.
- Render via fungsi terpisah (`renderTable()`, `renderStats()`), jangan campur DOM manipulation di dalam handler fetch.
- Escape HTML saat menyisipkan data user ke DOM (cegah XSS). Hindari `innerHTML` dengan data mentah.
- Tidak ada `console.log` yang tertinggal di alur produksi.
- Bahasa komentar: minimal. Hanya komentar yang menjelaskan "kenapa", bukan "apa".

## Domain Rules (WAJIB)

- Barang yang didata adalah **tas** (bukan baju). Istilah UI: "Ambil Tas", "Pengambilan Tas", dsb.
- Data penerima hanya **Nama** dan **Jurusan**. Jangan menambah NPM/fakultas/prodi/angkatan/ukuran tanpa memperbarui PRD.
- `status_pengambilan` adalah **boolean** (`true`/`false`), bukan string `"sudah"`/`"belum"`.
- **Anti-duplikat = kombinasi Nama + Jurusan.** Normalisasi sebelum simpan/cari: rapikan spasi ganda, trim, bandingkan case-insensitive. Berlaku juga di parser import.
- Saat menandai ambil: set `status_pengambilan = true` dan `waktu_pengambilan = now()`.
- Saat membatalkan: set `status_pengambilan = false` dan `waktu_pengambilan = null`.
- **Anti double-input:** saat menandai ambil, update dengan kondisi `status_pengambilan = false`. Jika 0 baris terupdate, tampilkan "Sudah diambil oleh petugas lain" (jangan diamkan).
- Simpan waktu dalam UTC, tampilkan ke user di `Asia/Jakarta` (WIB).
- Perubahan status/edit/hapus **wajib** dicatat ke `audit_log`.
- Akun admin dipakai **bersama**. Isi kolom `oleh` di `audit_log` dari **label petugas perangkat** (nama yang diisi petugas, disimpan di `localStorage`), bukan dari `auth.uid`. Jangan mengandalkan identitas akun untuk audit.

## Halaman Publik (live)

- Link dibagikan terbatas ke **grup GenBI (penerima tas)**, bukan publik bebas. Tetap diperlakukan sebagai halaman sensitif.

- Hanya menampilkan **agregat** (total/sudah/belum/progress) dan **hasil cek Nama+Jurusan milik sendiri**. **JANGAN** menampilkan daftar nama penerima lain.
- **Tidak** boleh `select` tabel `penerima` dari halaman publik. Gunakan RPC `statistik_tas()` dan `cek_status_tas(p_nama, p_jurusan)` (SECURITY DEFINER, di-grant ke `anon`).
- Live update memakai **polling ~10 detik**. Hentikan polling saat tab tidak aktif (`document.visibilitychange`) untuk hemat kuota, dan sediakan tombol refresh manual.
- Tampilkan label waktu update terakhir ("Diperbarui pukul HH:mm WIB").
- Tambahkan `<meta name="robots" content="noindex">` di `publik.html`.

## Supabase Rules (KEAMANAN)

- **JANGAN PERNAH** menaruh `service_role` key di HTML/JS browser. Hanya `anon` key.
- Jangan hardcode kredensial di `app.js`/`publik.js`/`*.html`. Pakai `config.js` (di `.gitignore`) atau variabel runtime. Sediakan `.env.example`.
- **RLS wajib aktif** di `penerima`, `import_batch`, `audit_log`. Hanya role `authenticated` yang punya akses tabel. `anon` tidak boleh `select` tabel apa pun.
- Satu-satunya jalur akses `anon` adalah RPC `statistik_tas()` dan `cek_status_tas(text, text)`. Jika menambah RPC publik, pastikan `security definer` + `set search_path` dan hanya mengembalikan field aman.
- Aplikasi admin harus mendukung login (Supabase Auth). Jangan buat gerbang passphrase palsu.
- Semua error Supabase yang ditampilkan ke user sudah disanitasi (Bahasa Indonesia), bukan dump error mentah.

## Import Massal (alur baku)

Selalu gunakan urutan: **Paste → Parse → Validasi → Deteksi duplikat → Preview → Commit**. Jangan pernah insert langsung dari paste.

- Parser memisah baris dengan newline dan kolom dengan TAB (hasil copy dari Excel/Sheets).
- Deteksi & lewati baris header (`No`, `Nama`, `Jurusan`, ...).
- Duplikat = kombinasi Nama+Jurusan sudah ada di DB **atau** ganda di dalam paste itu sendiri.
- Baris tanpa Nama ditandai tidak valid dan tidak ikut tercommit.
- Catat `import_batch_id` untuk setiap baris yang diinsert.

## Definition of Done

- [ ] Sesuai `docs/PRD.md` dan acceptance criteria terkait.
- [ ] Tidak ada kredensial/rahasia yang ter-commit.
- [ ] RLS aktif; halaman publik hanya lewat RPC aman (tidak baca tabel).
- [ ] Diuji di viewport mobile (< 640px) dan desktop.
- [ ] Data user selalu ter-escape (anti-XSS).
- [ ] Waktu ditampilkan dalam WIB.
- [ ] Polling publik berhenti saat tab tidak aktif.

## Jangan Dilakukan

- Menambah framework/bundler/backend tanpa persetujuan.
- Membuat tabel/kolom di luar data model PRD tanpa memperbarui PRD.
- Menyimpan status sebagai string.
- Menonaktifkan atau melewati RLS.
- Mengekspos daftar nama penerima lewat halaman publik.
- Commit kunci `service_role` atau file `.env` berisi rahasia.
