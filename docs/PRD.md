# PRD — Pendataan Penerima Beasiswa GenBI & Pengambilan Tas

- **Versi:** 1.2
- **Tanggal:** 21 September 2026
- **Status:** Draft untuk disetujui
- **Pemilik produk:** Panitia GenBI
- **Platform:** Web statis (mobile-first), dibuka dari HP panitia saat pembagian tas

---

## 1. Ringkasan

Aplikasi web sederhana untuk dua kebutuhan:

1. **Master data penerima Beasiswa Bank Indonesia (GenBI)** — **Nama** dan **Jurusan**.
2. **Pendataan pengambilan tas** — menandai siapa yang sudah/belum menerima tas, lengkap dengan waktu pengambilan.

Ada **dua antarmuka**:

- **Panel admin** (login) — kelola data, import massal, tandai pengambilan, rekap.
- **Halaman publik** (read-only, tanpa login, dibagikan lewat link) — rekap live dan **cek status mandiri**.

Karena data penerima biasanya sudah ada di Excel/Google Sheets, **import massal via copy-paste menjadi fitur utama**, bukan form satu-per-satu.

Prinsip desain: **sesederhana mungkin**. HTML + Tailwind (CDN) + Vanilla JS + Supabase. Tanpa framework/backend/ORM.

> **Catatan penting:** hanya ada 2 field data (Nama, Jurusan), **tanpa NPM/identitas unik**. Konsekuensi: dua orang dengan **nama + jurusan sama** dianggap satu entri (tidak bisa dibedakan). Ini diterima sesuai keputusan pemilik produk.

---

## 2. Latar belakang & masalah

| Masalah | Dampak |
| --- | --- |
| Data penerima tersebar di Excel/Sheets | Sulit tahu siapa yang belum ambil tas |
| Input satu per satu lambat | Tidak realistis untuk 100–500 orang |
| Pembagian tas menumpuk antrean | Panitia scroll tabel untuk cari 1 nama → lambat |
| Penerima tidak tahu status sendiri | Banyak bertanya ke panitia |
| Salah tekan "sudah ambil" tak bisa dikembalikan | Data tidak akurat |
| Import ulang bikin data ganda | Rekap kacau |
| Data pribadi penerima beasiswa terbuka | Risiko privasi |

---

## 3. Tujuan & Non-tujuan

### Tujuan
- G0. Panitia mengimpor data massal dari Excel/Sheets dengan aman (preview + validasi + deteksi duplikat).
- G1. Panitia mencari peserta dengan **nama** dalam hitungan detik saat antrean berjalan.
- G2. Menandai pengambilan tas 1 klik, dan bisa **dibatalkan** jika salah.
- G3. Rekap real-time: total, sudah ambil, belum ambil, progress.
- G4. Penerima bisa **cek status tas-nya sendiri** dari link yang dibagikan, dan statusnya ter-update live.
- G5. Data pribadi penerima tidak dapat diakses publik (daftar nama tidak terekspos).

### Non-tujuan (v1)
- Manajemen stok / inventori gudang.
- Multi-event / multi-jenis barang (hanya tas).
- Role kompleks (cukup 1 akun admin bersama).
- Aplikasi mobile native.
- Notifikasi WhatsApp/email.
- Realtime push instan (v1 pakai polling ~10 detik).

---

## 4. Persona

| Persona | Kebutuhan utama |
| --- | --- |
| **Admin/Panitia data** | Import massal, koreksi data, export laporan |
| **Petugas pembagian** | Mode cari nama cepat + tandai ambil, dari HP |
| **Koordinator** | Lihat progress |
| **Penerima (user publik)** | Cek status tas sendiri dari link, tanpa login |

---

## 5. Metrik keberhasilan

- M1. Import 150 baris selesai < 2 menit, tanpa duplikat.
- M2. Cari nama → hasil muncul < 1 detik.
- M3. Tandai pengambilan ≤ 3 tap di HP.
- M4. 0 insiden data ganda (nama+jurusan unik).
- M5. 100% permintaan `anon` ke tabel ditolak RLS (hanya boleh lewat RPC terbatas).
- M6. Halaman publik menampilkan status terbaru ≤ 15 detik dari perubahan.

---

## 6. Scope

### MVP (Fase 1)
- Autentikasi admin (Supabase Auth, email/password).
- Dashboard: total, sudah, belum, progress.
- Tabel daftar penerima: cari (nama/jurusan), filter status.
- Tambah/edit/hapus data (form modal: Nama, Jurusan).
- Tandai "sudah ambil" + batalkan dengan konfirmasi.
- **Import massal copy-paste**: Paste → Parse → Validasi → Deteksi duplikat → Preview → Import.
- **Mode Ambil Cepat** (khusus HP) berbasis nama.
- **Halaman publik live** — rekap progres + cek mandiri, auto-refresh ~10 detik.
- Export CSV.
- RLS: hanya user terautentikasi yang boleh mengakses tabel.

### Fase 2 (nice-to-have)
- Upload `.xlsx` / `.csv` langsung.
- Pemetaan kolom manual.
- Rollback import per batch.
- QR/barcode (catatan: tanpa identitas unik, QR perlu ditambah field ID).
- Audit log tampilan riwayat.
- Supabase Realtime push.
- PWA + mode offline.

---

## 7. Alur pengguna

### 7.1 Dashboard (admin)
```
👕 Pendataan Tas GenBI                        [ Petugas: Rani ]  [ Keluar ]
[ Dashboard ] [ Ambil Cepat ]

Total Penerima | Sudah Ambil | Belum Ambil
      150      |     97      |     53
█████████████████░░░░░░░  64.7%
97 dari 150 orang

[🔍 Cari nama atau jurusan…] [Semua Status ▼]  [+ Tambah] [Import Massal] [Export CSV]
```

### 7.2 Import massal
1. Panitia copy baris dari Excel/Sheets (kolom dipisah TAB, baris dipisah newline).
2. Tempel di textarea "Import Massal".
3. Klik **Preview Data**.
4. Sistem parse: deteksi & lewati baris header (`No`, `Nama`, `Jurusan`, `Prodi`, …). Mapping kolom: `Nama`, `Jurusan`.
5. Hasil validasi:
   - ✅ valid — siap diimport
   - ⚠️ bermasalah — Nama kosong
   - 🔴 duplikat — kombinasi Nama+Jurusan sudah ada di DB **atau** ganda di dalam paste
6. Klik **Import N Data** → insert + catat `import_batch_id`.
7. Ringkasan: berhasil X, dilewati Y, gagal Z.

**Aturan validasi:** `nama` wajib; `jurusan` opsional. Normalisasi: rapikan spasi ganda, trim, bandingkan case-insensitive.

### 7.3 Mode Ambil Cepat (Fast Mode)
```
👕 AMBIL TAS
[ Ketik nama peserta… ]  [ Cari ]

→ (bila >1 nama mirip, tampil daftar untuk dipilih)
  AHMAD FIKRI HANIF · Ilmu Komputer
  Status: BELUM DIAMBIL
  [ ✓ KONFIRMASI PENGAMBILAN ]

→ ✓ PENGAMBILAN BERHASIL · 21 Sep 2026, 10:31 WIB  [ Batalkan ]
```

- Pencarian berbasis nama (case-insensitive, sebagian).
- Bila lebih dari satu kandidat → tampil daftar untuk dipilih.
- **Anti double-input:** update dengan syarat `status_pengambilan = false`; jika 0 baris terupdate → "Sudah diambil oleh petugas lain".

### 7.4 Tambah / Edit manual
Modal: **Nama** (wajib), **Jurusan**, checkbox "Sudah mengambil tas".
- Checkbox dicentang → `status_pengambilan = true`, `waktu_pengambilan = now()`.
- Tidak dicentang → `status_pengambilan = false`, `waktu_pengambilan = null`.

### 7.5 Tabel daftar (admin)
- Desktop: tabel (No, Nama, Jurusan, Status, Aksi).
- Mobile: card per penerima (Nama, Jurusan, Waktu, tombol aksi).
- "Belum" → **Tandai Diambil** (konfirmasi). "Sudah" → waktu + **Batalkan** (konfirmasi).

### 7.6 Identitas Petugas (akun admin bersama)
- Saat membuka panel, petugas mengisi **Nama Petugas**, disimpan di `localStorage` perangkat.
- Dipakai mengisi kolom `oleh` di `audit_log`. Bisa diganti lewat chip di header.

### 7.7 Halaman Publik (live, tanpa login)
```
👕 Progres Pembagian Tas GenBI
Diperbarui pukul 10:31 WIB   [ ⟳ Muat ulang ]   (auto tiap ~10 dtk)

Total | Sudah | Belum
 150  |  97   |  53
█████████████████░░░░░░░  64.7%

────── Cek Status Tas Kamu ──────
[ Nama ]  [ Jurusan ]  [ CEK ]
→ Ahmad Fikri Hanif — ✓ SUDAH DIAMBIL (21 Sep 2026, 10:31 WIB)
```

- Hanya menampilkan **agregat** dan **hasil cek sendiri**. **Tidak** menampilkan daftar nama penerima lain.
- User mengetik **Nama + Jurusan**-nya untuk melihat status (bukan NPM, karena tidak ada).
- Live update: auto-refresh ~10 detik, berhenti saat tab tidak aktif, tombol refresh manual + label waktu.
- Tanpa login. Akses data lewat **RPC terbatas** (§9).

---

## 8. Data model (Supabase / PostgreSQL)

### 8.1 `penerima`
```sql
create table penerima (
  id                 uuid primary key default gen_random_uuid(),
  nama               text        not null,
  jurusan            text,
  status_pengambilan boolean     not null default false,
  waktu_pengambilan  timestamptz,
  import_batch_id    uuid        references import_batch(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- anti-duplikat: kombinasi nama + jurusan (case-insensitive)
create unique index ux_penerima_nama_jurusan
  on penerima (lower(btrim(nama)), lower(btrim(coalesce(jurusan, ''))));
```

### 8.2 `import_batch`
```sql
create table import_batch (
  id         uuid primary key default gen_random_uuid(),
  label      text,
  total      int  not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);
```

### 8.3 `audit_log`
```sql
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  penerima_id uuid references penerima(id) on delete cascade,
  aksi        text not null,          -- 'ambil' | 'batal' | 'edit' | 'impor' | 'hapus'
  nilai_lama  jsonb,
  nilai_baru  jsonb,
  oleh        text,
  waktu       timestamptz not null default now()
);
```

### 8.4 Index pencarian
```sql
create index idx_penerima_status on penerima (status_pengambilan);
create index idx_penerima_nama   on penerima (lower(nama));
```

### 8.5 RPC untuk halaman publik (SECURITY DEFINER)
```sql
create or replace function statistik_tas()
returns table (total bigint, sudah bigint, belum bigint)
language sql security definer set search_path = public
as $$
  select count(*),
         count(*) filter (where status_pengambilan),
         count(*) filter (where not status_pengambilan)
  from penerima;
$$;

create or replace function cek_status_tas(p_nama text, p_jurusan text default '')
returns table (nama text, jurusan text, status_pengambilan boolean, waktu_pengambilan timestamptz)
language sql security definer set search_path = public
as $$
  select nama, jurusan, status_pengambilan, waktu_pengambilan
  from penerima
  where lower(btrim(nama)) = lower(btrim(p_nama))
    and lower(btrim(coalesce(jurusan,''))) = lower(btrim(coalesce(p_jurusan,'')))
  limit 1;
$$;

grant execute on function statistik_tas()                to anon, authenticated;
grant execute on function cek_status_tas(text, text)     to anon, authenticated;
```

### 8.6 Catatan model
- **Status boolean**, bukan string.
- **Unik berdasarkan Nama + Jurusan** (bukan NPM, karena tidak ada).
- `waktu_pengambilan` hanya terisi jika `status_pengambilan = true`.
- `audit_log` append-only; `oleh` diisi label petugas perangkat.
- Halaman publik **tidak pernah** menyentuh tabel `penerima` langsung.

---

## 9. Keamanan & privasi (WAJIB)

1. **Jangan pernah** menaruh `service_role` key di HTML/JS browser. Hanya `anon` key.
2. **RLS aktif** di `penerima`, `import_batch`, `audit_log`.
3. Hanya role `authenticated` yang boleh `select/insert/update/delete` tabel. `anon` = **tidak boleh apa-apa**.
4. Halaman publik hanya lewat RPC `security definer` (`statistik_tas`, `cek_status_tas`). Tidak ada endpoint membaca seluruh daftar.
5. Link publik dibagikan **terbatas ke grup GenBI** (penerima tas), bukan publik bebas; pasang `noindex`.
6. Login admin pakai Supabase Auth. Jangan gerbang passphrase palsu.
7. `config.js`/`.env` tidak di-commit. Ada `.gitignore` + `config.example.js`.
8. Export CSV hanya untuk pengguna terautentikasi.

### Contoh RLS
```sql
alter table penerima     enable row level security;
alter table import_batch enable row level security;
alter table audit_log    enable row level security;

create policy "auth full access penerima"
  on penerima for all to authenticated using (true) with check (true);
-- ulangi untuk import_batch & audit_log
-- anon: tanpa policy tabel => tidak bisa akses; hanya RPC
```

---

## 10. Non-functional requirements

| Aspek | Target |
| --- | --- |
| Responsif | Mobile-first; tabel → card di < 640px |
| Performa | Cari/filter < 1s untuk ≤ 1000 baris |
| Live update | Halaman publik auto-refresh ~10s, jeda saat tab tidak aktif |
| Timezone | Simpan UTC, tampilkan `Asia/Jakarta` (WIB) |
| Error handling | Pesan Bahasa Indonesia, tanpa dump error Supabase |
| Aksesibilitas | Kontras cukup, target tap ≥ 44px, form berlabel |
| Bahasa UI | Bahasa Indonesia |

---

## 11. Stack & struktur file

**Stack:** HTML + Tailwind (CDN) + Vanilla JS + Supabase JS v2 (CDN).

```
projekasal/
├── index.html          # panel admin
├── app.js              # logika admin
├── publik.html         # (rencana) halaman publik live
├── publik.js           # (rencana) logika publik
├── config.example.js   # contoh kredensial
├── .gitignore
├── docs/PRD.md
├── README.md
└── AGENTS.md
```

---

## 12. Acceptance criteria (ringkas)

- [ ] AC1. Admin login; user tanpa login tidak bisa melihat data tabel.
- [ ] AC2. Import paste memuat data dengan preview & validasi.
- [ ] AC3. Duplikat (nama+jurusan, di DB maupun dalam paste) terdeteksi & dilewati.
- [ ] AC4. Baris tanpa nama ditandai, tidak ikut terimport.
- [ ] AC5. Cari nama/jurusan menampilkan hasil < 1 detik.
- [ ] AC6. Tandai ambil menyimpan `status_pengambilan=true` + `waktu_pengambilan`.
- [ ] AC7. Batalkan mengembalikan ke belum ambil + catat audit.
- [ ] AC8. Dua perangkat menandai orang sama → tidak dobel, ada peringatan.
- [ ] AC9. Dashboard menampilkan total/sudah/belum + progress.
- [ ] AC10. Nyaman di HP (card) dan desktop (tabel).
- [ ] AC11. Export CSV sesuai filter aktif.
- [ ] AC12. Tidak ada `service_role` key di repo; RLS aktif.
- [ ] AC13. Halaman publik menampilkan rekap progres & cek status via Nama+Jurusan.
- [ ] AC14. Halaman publik **tidak** membocorkan daftar nama penerima lain.
- [ ] AC15. Halaman publik ter-update ≤ 15 detik & berhenti polling saat tab tidak aktif.

---

## 13. Asumsi & keputusan

- **K1 (diputuskan).** Data hanya **Nama + Jurusan** (tanpa NPM, fakultas, prodi, angkatan, ukuran).
- **K2 (diputuskan).** Satu **akun admin bersama**; identitas individu lewat label petugas perangkat.
- **K3 (diputuskan).** Link publik dibagikan ke **grup GenBI** (penerima tas), tetap sensitif.
- A4. Perlu QR scan? (butuh menambah field identitas unik — bertentangan dengan K1)
- A5. Perlu mode offline? (Fase 2/PWA)

---

## 14. Risiko

| Risiko | Mitigasi |
| --- | --- |
| Nama+jurusan sama → ambigu | Disadari & diterima (K1); tampilkan daftar bila kandidat >1 |
| Cek status publik tanpa identitas unik | User memilih kandidat yang cocok; hanya 1 baris per request |
| Link publik tersebar | `noindex`, tanpa daftar nama |
| Sinyal jelek | Tombol disable + retry; PWA (Fase 2) |
| Salah tandai | Tombol Batalkan + audit + undo toast |
| Import salah format | Preview + validasi sebelum commit |

---

## 15. Roadmap

1. **Fase 1 (MVP):** Auth, schema + RLS + RPC, dashboard, tabel+filter, CRUD, tandai/batalkan, import paste, fast mode, halaman publik (polling), export CSV.
2. **Fase 2:** upload xlsx/csv, mapping kolom, rollback batch, audit log UI, Realtime push, PWA offline.
