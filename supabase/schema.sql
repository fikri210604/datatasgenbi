-- Schema Supabase — Pendataan Tas GenBI
-- Jalankan di Supabase SQL Editor. Idempoten (aman dijalankan ulang).
-- Sumber: docs/PRD.md §8 & §9.

-- ============ 1. Tabel ============

create table if not exists import_batch (
  id         uuid primary key default gen_random_uuid(),
  label      text,
  total      int  not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists penerima (
  id                 uuid primary key default gen_random_uuid(),
  nama               text        not null,
  jurusan            text,
  status_pengambilan boolean     not null default false,
  waktu_pengambilan  timestamptz,
  import_batch_id    uuid        references import_batch(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  penerima_id uuid references penerima(id) on delete cascade,
  aksi        text not null,          -- 'ambil' | 'batal' | 'edit' | 'impor' | 'hapus'
  nilai_lama  jsonb,
  nilai_baru  jsonb,
  oleh        text,
  waktu       timestamptz not null default now()
);

-- ============ 2. Index ============

-- anti-duplikat: kombinasi nama + jurusan (case-insensitive)
create unique index if not exists ux_penerima_nama_jurusan
  on penerima (lower(btrim(nama)), lower(btrim(coalesce(jurusan, ''))));

create index if not exists idx_penerima_status on penerima (status_pengambilan);
create index if not exists idx_penerima_nama   on penerima (lower(nama));

-- ============ 3. Trigger updated_at ============

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_penerima_updated_at on penerima;
create trigger trg_penerima_updated_at
  before update on penerima
  for each row execute function set_updated_at();

-- ============ 4. RLS ============

alter table penerima     enable row level security;
alter table import_batch enable row level security;
alter table audit_log    enable row level security;

drop policy if exists "auth full access penerima"     on penerima;
drop policy if exists "auth full access import_batch" on import_batch;
drop policy if exists "auth full access audit_log"    on audit_log;

create policy "auth full access penerima"
  on penerima for all to authenticated using (true) with check (true);

create policy "auth full access import_batch"
  on import_batch for all to authenticated using (true) with check (true);

create policy "auth full access audit_log"
  on audit_log for all to authenticated using (true) with check (true);

-- Akses langsung tanpa login sesuai konfigurasi aplikasi.
-- Konsekuensi: siapa pun yang memiliki URL dapat mengelola data.
drop policy if exists "anon full access penerima"     on penerima;
drop policy if exists "anon full access import_batch" on import_batch;
drop policy if exists "anon full access audit_log"    on audit_log;

create policy "anon full access penerima"
  on penerima for all to anon using (true) with check (true);

create policy "anon full access import_batch"
  on import_batch for all to anon using (true) with check (true);

create policy "anon full access audit_log"
  on audit_log for all to anon using (true) with check (true);

-- ============ 5. RPC halaman publik (SECURITY DEFINER) ============

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

revoke all on function statistik_tas() from public;
revoke all on function cek_status_tas(text, text) from public;
grant execute on function statistik_tas()            to anon, authenticated;
grant execute on function cek_status_tas(text, text) to anon, authenticated;
