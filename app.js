/* Pendataan Tas GenBI — panel admin
   Data: Nama + Jurusan. Vanilla JS + Supabase (fallback mode demo via localStorage) */

const CFG = window.APP_CONFIG || {};
const CONFIGURED = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
const DEMO_KEY = 'genbi_demo_v2';
const PETUGAS_KEY = 'genbi_petugas';

const $ = (id) => document.getElementById(id);

const state = {
  rows: [],
  user: null,
  filter: { q: '', status: '' },
  editId: null,
  confirm: null,
  importRows: [],
  auditLogs: [],
  auditFilter: { q: '', aksi: '' },
};

let sb = null;

/* ---------------- utils ---------------- */

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const normKey = (nama, jurusan) => `${clean(nama).toLowerCase()}|${clean(jurusan).toLowerCase()}`;

const dateFmt = (iso) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const tanggal = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  const jam = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace('.', ':');
  return `${tanggal}, ${jam} WIB`;
};

function toast(message, opts = {}) {
  const wrap = $('toastWrap');
  const el = document.createElement('div');
  const tone = opts.type === 'error' ? 'bg-red-600' : opts.type === 'warn' ? 'bg-bi-golddark' : 'bg-bi-navy';
  el.className = `fade-in flex items-center gap-3 rounded-xl ${tone} px-4 py-3 text-sm text-white shadow-lg`;
  const span = document.createElement('span');
  span.className = 'flex-1';
  span.textContent = message;
  el.appendChild(span);
  if (opts.actionLabel) {
    const b = document.createElement('button');
    b.className = 'shrink-0 rounded-lg bg-white/20 px-3 py-1 font-semibold hover:bg-white/30';
    b.textContent = opts.actionLabel;
    b.onclick = () => { cleanup(); opts.onAction && opts.onAction(); };
    el.appendChild(b);
  }
  wrap.appendChild(el);
  const timer = setTimeout(cleanup, opts.duration || (opts.actionLabel ? 10000 : 4000));
  function cleanup() { clearTimeout(timer); el.remove(); }
}

/* ---------------- backend ---------------- */

const Backend = {
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Email atau kata sandi salah.');
  },
  async signOut() { if (CONFIGURED) await sb.auth.signOut(); },
  async currentUser() {
    if (!CONFIGURED) return { email: 'demo@genbi' };
    const { data } = await sb.auth.getUser();
    return data ? data.user : null;
  },
  async list() {
    if (!CONFIGURED) return demoRead();
    const { data, error } = await sb.from('penerima').select('*').order('nama', { ascending: true });
    if (error) throw new Error('Gagal memuat data.');
    return data || [];
  },
  async insert(row) {
    if (!CONFIGURED) return demoInsert(row);
    const { data, error } = await sb.from('penerima').insert(row).select().single();
    if (error) throw mapDbError(error);
    return data;
  },
  async update(id, patch) {
    if (!CONFIGURED) return demoUpdate(id, patch);
    const { data, error } = await sb.from('penerima').update(patch).eq('id', id).select().single();
    if (error) throw mapDbError(error);
    return data;
  },
  async remove(id) {
    if (!CONFIGURED) return demoRemove(id);
    const { error } = await sb.from('penerima').delete().eq('id', id);
    if (error) throw new Error('Gagal menghapus data.');
  },
  async markAmbil(id, oleh) {
    const now = new Date().toISOString();
    if (!CONFIGURED) return demoMarkAmbil(id, oleh, now);
    const { data, error } = await sb.from('penerima')
      .update({ status_pengambilan: true, waktu_pengambilan: now, updated_at: now })
      .eq('id', id).eq('status_pengambilan', false).select();
    if (error) throw new Error('Gagal menyimpan pengambilan.');
    if (!data || data.length === 0) return null;
    await Backend.addAudit({ penerima_id: id, aksi: 'ambil', nilai_baru: { status_pengambilan: true, waktu_pengambilan: now }, oleh });
    return data[0];
  },
  async markBatal(id, oleh) {
    const now = new Date().toISOString();
    if (!CONFIGURED) return demoMarkBatal(id, oleh, now);
    const { data, error } = await sb.from('penerima')
      .update({ status_pengambilan: false, waktu_pengambilan: null, updated_at: now })
      .eq('id', id).select();
    if (error) throw new Error('Gagal membatalkan pengambilan.');
    if (data && data[0]) {
      await Backend.addAudit({ penerima_id: id, aksi: 'batal', nilai_baru: { status_pengambilan: false, waktu_pengambilan: null }, oleh });
    }
    return data ? data[0] : null;
  },
  async addAudit(entry) {
    if (!CONFIGURED) return demoAudit(entry);
    const { error } = await sb.from('audit_log').insert(entry);
    if (error) console.warn('audit gagal', error.message);
  },
  async listAudit() {
    if (!CONFIGURED) return demoAuditRead();
    const { data, error } = await sb
      .from('audit_log')
      .select('*, penerima(nama, jurusan)')
      .order('waktu', { ascending: false })
      .limit(250);
    if (error) {
      console.warn('audit list error', error.message);
      throw new Error('Gagal memuat audit log.');
    }
    return (data || []).map((row) => {
      const p = row.penerima || (row.penerima_id ? state.rows.find((r) => r.id === row.penerima_id) : null);
      return {
        ...row,
        nama: (p && p.nama) || (row.nilai_baru && row.nilai_baru.nama) || (row.nilai_lama && row.nilai_lama.nama) || '',
        jurusan: (p && p.jurusan) || (row.nilai_baru && row.nilai_baru.jurusan) || (row.nilai_lama && row.nilai_lama.jurusan) || '',
      };
    });
  },
  async insertBatch(rows, label, oleh) {
    if (!CONFIGURED) return demoInsertBatch(rows);
    const { data: batch, error: e1 } = await sb.from('import_batch')
      .insert({ label, total: rows.length, created_by: oleh }).select().single();
    if (e1) throw new Error('Gagal membuat batch import.');
    const now = new Date().toISOString();
    const payload = rows.map((r) => ({ ...r, import_batch_id: batch.id, created_at: now, updated_at: now }));
    const { data, error } = await sb.from('penerima').insert(payload).select();
    if (error) throw mapDbError(error);
    await Backend.addAudit({ penerima_id: null, aksi: 'impor', nilai_baru: { batch: batch.id, jumlah: rows.length }, oleh });
    return data ? data.length : 0;
  },
};

function mapDbError(error) {
  const msg = String((error && error.message) || '').toLowerCase();
  if (msg.includes('duplicate') || msg.includes('unique')) return new Error('Data (nama + jurusan) sudah terdaftar.');
  if (msg.includes('permission') || msg.includes('policy')) return new Error('Akses ditolak. Periksa RLS dan login.');
  return new Error('Terjadi kesalahan saat menyimpan data.');
}

/* ---------------- backend demo (localStorage) ---------------- */

function demoRead() {
  let raw = localStorage.getItem(DEMO_KEY);
  if (!raw) { raw = JSON.stringify(seedDemo()); localStorage.setItem(DEMO_KEY, raw); }
  try { return JSON.parse(raw); } catch { return []; }
}
function demoWrite(rows) { localStorage.setItem(DEMO_KEY, JSON.stringify(rows)); }
const uid = () => 'demo-' + Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();

function seedDemo() {
  const seed = [
    ['Ahmad Fikri Hanif', 'Ilmu Komputer', true],
    ['Rizky Arya Pratama', 'Ilmu Komputer', false],
    ['Siti Aisyah Nabila', 'Manajemen', true],
    ['Muhammad Fulan', 'Ilmu Pemerintahan', false],
    ['Dewi Lestari', 'Pendidikan Biologi', true],
    ['Bayu Setiawan', 'Teknik Elektro', false],
    ['Nadia Rahmawati', 'Akuntansi', true],
    ['Fajar Nugroho', 'Fisika', false],
    ['Intan Permatasari', 'Pendidikan Matematika', false],
    ['Hendra Wijaya', 'Teknik Mesin', true],
  ];
  return seed.map(([nama, jurusan, sudah]) => ({
    id: uid(), nama, jurusan,
    status_pengambilan: sudah, waktu_pengambilan: sudah ? nowIso() : null,
    created_at: nowIso(), updated_at: nowIso(),
  }));
}
function seedDemoAudit() {
  const t = Date.now();
  const m = (min) => new Date(t - min * 60 * 1000).toISOString();
  return [
    { id: uid(), waktu: m(15), penerima_id: null, aksi: 'ambil', nama: 'Ahmad Fikri Hanif', jurusan: 'Ilmu Komputer', nilai_baru: { status_pengambilan: true }, oleh: 'Rani (Meja 1)' },
    { id: uid(), waktu: m(28), penerima_id: null, aksi: 'ambil', nama: 'Siti Aisyah Nabila', jurusan: 'Manajemen', nilai_baru: { status_pengambilan: true }, oleh: 'Rani (Meja 1)' },
    { id: uid(), waktu: m(45), penerima_id: null, aksi: 'ambil', nama: 'Hendra Wijaya', jurusan: 'Teknik Mesin', nilai_baru: { status_pengambilan: true }, oleh: 'Budi (Meja 2)' },
    { id: uid(), waktu: m(60), penerima_id: null, aksi: 'ambil', nama: 'Dewi Lestari', jurusan: 'Pendidikan Biologi', nilai_baru: { status_pengambilan: true }, oleh: 'Rani (Meja 1)' },
    { id: uid(), waktu: m(75), penerima_id: null, aksi: 'ambil', nama: 'Nadia Rahmawati', jurusan: 'Akuntansi', nilai_baru: { status_pengambilan: true }, oleh: 'Budi (Meja 2)' },
    { id: uid(), waktu: m(120), penerima_id: null, aksi: 'impor', nama: '', jurusan: '', nilai_baru: { jumlah: 10 }, oleh: 'Panitia GenBI' },
  ];
}

function demoAuditRead() {
  const key = 'genbi_audit_v1';
  let raw = localStorage.getItem(key);
  if (!raw) {
    const seed = seedDemoAudit();
    localStorage.setItem(key, JSON.stringify(seed));
    return seed;
  }
  try { return JSON.parse(raw); } catch { return []; }
}

function demoInsert(row) {
  const rows = demoRead();
  if (rows.some((r) => normKey(r.nama, r.jurusan) === normKey(row.nama, row.jurusan))) throw new Error('Data (nama + jurusan) sudah terdaftar.');
  const full = { id: uid(), created_at: nowIso(), updated_at: nowIso(), ...row };
  rows.push(full); demoWrite(rows);
  demoAudit({ penerima_id: full.id, aksi: 'tambah', nilai_baru: full, oleh: getPetugas() });
  return full;
}
function demoUpdate(id, patch) {
  const rows = demoRead();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) throw new Error('Data tidak ditemukan.');
  if (patch.nama && rows.some((r) => r.id !== id && normKey(r.nama, r.jurusan) === normKey(patch.nama, patch.jurusan))) throw new Error('Data (nama + jurusan) sudah terdaftar.');
  const oldVal = rows[i];
  rows[i] = { ...rows[i], ...patch, updated_at: nowIso() };
  demoWrite(rows);
  demoAudit({
    penerima_id: id,
    aksi: 'edit',
    nilai_lama: { nama: oldVal.nama, jurusan: oldVal.jurusan, status_pengambilan: oldVal.status_pengambilan },
    nilai_baru: patch,
    oleh: getPetugas(),
  });
  return rows[i];
}
function demoRemove(id) { demoWrite(demoRead().filter((r) => r.id !== id)); }
function demoMarkAmbil(id, oleh, now) {
  const rows = demoRead();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0 || rows[i].status_pengambilan) return null;
  rows[i] = { ...rows[i], status_pengambilan: true, waktu_pengambilan: now, updated_at: now };
  demoWrite(rows);
  demoAudit({ penerima_id: id, aksi: 'ambil', nilai_baru: { status_pengambilan: true, waktu_pengambilan: now }, oleh });
  return rows[i];
}
function demoMarkBatal(id, oleh, now) {
  const rows = demoRead();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return null;
  rows[i] = { ...rows[i], status_pengambilan: false, waktu_pengambilan: null, updated_at: now };
  demoWrite(rows);
  demoAudit({ penerima_id: id, aksi: 'batal', nilai_baru: { status_pengambilan: false, waktu_pengambilan: null }, oleh });
  return rows[i];
}
function demoAudit(entry) {
  try {
    const key = 'genbi_audit_v1';
    const arr = demoAuditRead();
    const rows = demoRead();
    const p = entry.penerima_id ? rows.find((r) => r.id === entry.penerima_id) : null;
    const item = {
      id: uid(),
      waktu: nowIso(),
      penerima_id: entry.penerima_id || null,
      aksi: entry.aksi,
      nilai_lama: entry.nilai_lama || null,
      nilai_baru: entry.nilai_baru || null,
      oleh: entry.oleh || getPetugas() || 'Petugas',
      nama: (p && p.nama) || (entry.nilai_baru && entry.nilai_baru.nama) || (entry.nilai_lama && entry.nilai_lama.nama) || '',
      jurusan: (p && p.jurusan) || (entry.nilai_baru && entry.nilai_baru.jurusan) || (entry.nilai_lama && entry.nilai_lama.jurusan) || '',
    };
    arr.unshift(item);
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 500)));
  } catch { /* abaikan */ }
}
function demoInsertBatch(rows) {
  const data = demoRead();
  let n = 0;
  rows.forEach((r) => {
    if (data.some((d) => normKey(d.nama, d.jurusan) === normKey(r.nama, r.jurusan))) return;
    data.push({ id: uid(), created_at: nowIso(), updated_at: nowIso(), ...r });
    n++;
  });
  demoWrite(data);
  demoAudit({ aksi: 'impor', nilai_baru: { jumlah: n }, oleh: getPetugas() });
  return n;
}

/* ---------------- import parser ---------------- */

const SYN = {
  no: ['no', 'nomor', 'nomor urut', '#'],
  nama: ['nama', 'name', 'nama lengkap', 'nama mahasiswa', 'penerima'],
  jurusan: ['jurusan', 'prodi', 'program studi', 'program', 'departemen', 'fakultas jurusan'],
};

function findCol(cells, key) {
  const syns = SYN[key];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i].toLowerCase().trim();
    if (!c) continue;
    for (const s of syns) if (c === s || (s.length > 3 && c.includes(s))) return i;
  }
  return -1;
}

function parsePaste(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  if (!lines.length) return [];

  const split = (l) => l.split('\t').map((c) => c.trim());
  const firstCells = split(lines[0]);
  const headerRow = /nama|jurusan|prodi|fakultas|nim|npm/i.test(lines[0]);
  let map;

  if (headerRow) {
    map = { no: findCol(firstCells, 'no'), nama: findCol(firstCells, 'nama'), jurusan: findCol(firstCells, 'jurusan') };
  } else {
    const firstIsNo = firstCells.length >= 2 && /^\d{1,3}$/.test(firstCells[0]) && firstCells.length >= 3;
    const off = firstIsNo ? 1 : 0;
    map = { no: firstIsNo ? 0 : -1, nama: off, jurusan: off + 1 };
  }

  const body = headerRow ? lines.slice(1) : lines;
  const existing = new Set(state.rows.map((r) => normKey(r.nama, r.jurusan)));
  const seen = new Set();

  return body.map((line, idx) => {
    const c = split(line);
    const pick = (k) => (map[k] >= 0 && c[map[k]] !== undefined ? c[map[k]] : '');
    const nama = pick('nama');
    const jurusan = pick('jurusan');
    const errors = [];
    if (!nama) errors.push('Nama kosong');

    const key = normKey(nama, jurusan);
    let status = 'valid';
    if (errors.length) status = 'invalid';
    else if (existing.has(key)) status = 'duplikat';
    else if (seen.has(key)) status = 'duplikat';
    if (nama) seen.add(key);

    return { baris: idx + 1, nama, jurusan, status, errors };
  });
}

/* ---------------- rendering ---------------- */

function renderStats() {
  const total = state.rows.length;
  const sudah = state.rows.filter((r) => r.status_pengambilan).length;
  const belum = total - sudah;
  const pct = total ? Math.round((sudah / total) * 1000) / 10 : 0;
  $('statTotal').textContent = total;
  $('statSudah').textContent = sudah;
  $('statBelum').textContent = belum;
  $('statProgressText').textContent = `${sudah} dari ${total} orang`;
  $('statProgressBar').style.width = pct + '%';
  $('statPercent').textContent = pct + '%';
}

function filteredRows() {
  const q = state.filter.q.trim().toLowerCase();
  return state.rows.filter((r) => {
    if (state.filter.status === 'sudah' && !r.status_pengambilan) return false;
    if (state.filter.status === 'belum' && r.status_pengambilan) return false;
    if (!q) return true;
    return r.nama.toLowerCase().includes(q) || String(r.jurusan || '').toLowerCase().includes(q);
  });
}

const statusPill = (r) => r.status_pengambilan
  ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-bi-green/10 px-2.5 py-1 text-xs font-semibold text-bi-green"><span class="h-1.5 w-1.5 rounded-full bg-bi-green"></span>Sudah</span>`
  : `<span class="inline-flex items-center gap-1.5 rounded-full bg-bi-gold/15 px-2.5 py-1 text-xs font-semibold text-bi-golddark"><span class="h-1.5 w-1.5 rounded-full bg-bi-gold"></span>Belum</span>`;

function renderList() {
  const rows = filteredRows();
  $('tableCount').textContent = `${rows.length} dari ${state.rows.length} data`;
  $('emptyState').hidden = rows.length !== 0;

  $('tableBody').innerHTML = rows.map((r, i) => `
    <tr class="hover:bg-bi-ice/60">
      <td class="px-4 py-3 text-slate-400">${i + 1}</td>
      <td class="px-4 py-3 font-semibold text-bi-navy">${escapeHtml(r.nama)}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(r.jurusan || '-')}</td>
      <td class="px-4 py-3">${statusPill(r)}${r.waktu_pengambilan ? `<span class="mt-1 block text-[11px] text-slate-400">${dateFmt(r.waktu_pengambilan)}</span>` : ''}</td>
      <td class="px-4 py-3">
        <div class="flex justify-end gap-1.5">
          <button data-action="edit" data-id="${r.id}" class="rounded-lg border border-bi-line px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-bi-ice">Edit</button>
          <button data-action="${r.status_pengambilan ? 'batal' : 'ambil'}" data-id="${r.id}"
            class="rounded-lg px-3 py-1.5 text-xs font-semibold text-white ${r.status_pengambilan ? 'bg-slate-500 hover:opacity-90' : 'bg-bi-green hover:opacity-90'}">
            ${r.status_pengambilan ? 'Batalkan' : 'Tandai Diambil'}
          </button>
        </div>
      </td>
    </tr>`).join('');

  $('cardList').innerHTML = rows.map((r) => `
    <div class="rounded-2xl bg-white ring-1 ring-bi-line p-4 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate font-bold text-bi-navy">${escapeHtml(r.nama)}</p>
          <p class="truncate text-xs text-slate-500">${escapeHtml(r.jurusan || 'Tanpa jurusan')}</p>
        </div>
        ${statusPill(r)}
      </div>
      <div class="mt-3 text-xs"><span class="text-slate-400">Waktu</span><p class="font-semibold text-bi-navy">${r.waktu_pengambilan ? dateFmt(r.waktu_pengambilan) : '-'}</p></div>
      <div class="mt-3 flex gap-2">
        <button data-action="edit" data-id="${r.id}" class="flex-1 rounded-lg border border-bi-line px-3 py-2 text-xs font-semibold text-slate-600">Edit</button>
        <button data-action="${r.status_pengambilan ? 'batal' : 'ambil'}" data-id="${r.id}"
          class="flex-1 rounded-lg px-3 py-2 text-xs font-semibold text-white ${r.status_pengambilan ? 'bg-slate-500' : 'bg-bi-green'}">
          ${r.status_pengambilan ? 'Batalkan' : 'Tandai Diambil'}
        </button>
      </div>
    </div>`).join('');
}

function renderAll() { renderStats(); renderList(); }

/* ---------------- data ops ---------------- */

async function loadData() { state.rows = await Backend.list(); renderAll(); }
const getPetugas = () => localStorage.getItem(PETUGAS_KEY) || '';

async function doAmbil(id) {
  const row = state.rows.find((r) => r.id === id);
  if (!row) return;
  try {
    const updated = await Backend.markAmbil(id, getPetugas());
    if (!updated) { toast('Sudah diambil oleh petugas lain.', { type: 'warn' }); await loadData(); return; }
    await loadData();
    const msg = `${row.nama} · ${dateFmt(updated.waktu_pengambilan)}`;
    toast('Pengambilan berhasil. ' + msg, { actionLabel: 'Batalkan', onAction: () => doBatal(id) });
  } catch (err) { toast(err.message, { type: 'error' }); }
}

async function doBatal(id) {
  const row = state.rows.find((r) => r.id === id);
  await Backend.markBatal(id, getPetugas());
  await loadData();
  toast(`Dibatalkan: ${row ? row.nama : 'data'}.`);
}

function openPenerima(id) {
  state.editId = id || null;
  const row = id ? state.rows.find((r) => r.id === id) : null;
  $('modalPenerimaTitle').textContent = row ? 'Edit Penerima' : 'Tambah Penerima';
  $('fId').value = row ? row.id : '';
  $('fNama').value = row ? row.nama : '';
  $('fJurusan').value = row ? (row.jurusan || '') : '';
  $('fSudah').checked = row ? !!row.status_pengambilan : false;
  $('penerimaError').hidden = true;
  showModal('modalPenerima');
  setTimeout(() => $('fNama').focus(), 50);
}

async function savePenerima(e) {
  e.preventDefault();
  const errEl = $('penerimaError');
  errEl.hidden = true;
  const nama = clean($('fNama').value);
  const jurusan = clean($('fJurusan').value);
  if (!nama) { errEl.textContent = 'Nama wajib diisi.'; errEl.hidden = false; return; }

  const sudah = $('fSudah').checked;
  const now = new Date().toISOString();
  const patch = { nama, jurusan, status_pengambilan: sudah, waktu_pengambilan: sudah ? now : null, updated_at: now };
  const btn = $('btnPenerimaSave');
  btn.disabled = true;
  try {
    if (state.editId) {
      const oldRow = state.rows.find((r) => r.id === state.editId);
      await Backend.update(state.editId, patch);
      await Backend.addAudit({
        penerima_id: state.editId,
        aksi: 'edit',
        nilai_lama: oldRow ? { nama: oldRow.nama, jurusan: oldRow.jurusan, status_pengambilan: oldRow.status_pengambilan } : null,
        nilai_baru: patch,
        oleh: getPetugas(),
      });
      toast('Data diperbarui.');
    } else {
      patch.created_at = now;
      const created = await Backend.insert(patch);
      await Backend.addAudit({
        penerima_id: created.id,
        aksi: 'tambah',
        nilai_baru: patch,
        oleh: getPetugas(),
      });
      toast('Data ditambahkan.');
    }
    hideModal('modalPenerima');
    await loadData();
  } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
  finally { btn.disabled = false; }
}

function exportExcel() {
  const rows = filteredRows();
  if (!rows.length) return toast('Tidak ada data untuk diexport.', { type: 'warn' });
  if (!window.XLSX) {
    toast('Library Excel belum termuat. Periksa koneksi lalu coba lagi.', { type: 'error' });
    return;
  }
  const head = ['No', 'Nama', 'Jurusan', 'Status', 'Waktu Pengambilan'];
  const body = rows.map((r, i) => [
    i + 1,
    r.nama,
    r.jurusan || '',
    r.status_pengambilan ? 'Sudah' : 'Belum',
    r.waktu_pengambilan ? dateFmt(r.waktu_pengambilan) : '',
  ]);
  const ws = window.XLSX.utils.aoa_to_sheet([head, ...body]);
  ws['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 25 }, { wch: 10 }, { wch: 24 }];
  ws['!autofilter'] = { ref: ws['!ref'] };
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Penerima');
  window.XLSX.writeFile(wb, `tas-genbi-${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast(`${rows.length} data diexport ke Excel.`);
}

/* ---------------- import UI ---------------- */

function resetImport() {
  state.importRows = [];
  $('importTextarea').value = '';
  $('importStep1').hidden = false;
  $('importStep2').hidden = true;
  $('btnPreviewImport').hidden = false;
  $('btnCommitImport').hidden = true;
  $('importError').hidden = true;
}

function previewImport() {
  const rows = parsePaste($('importTextarea').value);
  const errEl = $('importError');
  if (!rows.length) { errEl.textContent = 'Tidak ada baris yang bisa dibaca. Pastikan kolom dipisah TAB.'; errEl.hidden = false; return; }
  errEl.hidden = true;
  state.importRows = rows;

  const valid = rows.filter((r) => r.status === 'valid').length;
  const dup = rows.filter((r) => r.status === 'duplikat').length;
  const invalid = rows.filter((r) => r.status === 'invalid').length;

  $('importSummary').innerHTML = [
    ['Valid', valid, 'bg-bi-green/10 text-bi-green'],
    ['Duplikat', dup, 'bg-bi-gold/20 text-bi-golddark'],
    ['Bermasalah', invalid, 'bg-red-100 text-red-600'],
  ].map(([label, n, cls]) => `<span class="rounded-full ${cls} px-3 py-1.5 text-xs font-bold">${label}: ${n}</span>`).join('');

  const badge = (r) => r.status === 'valid'
    ? `<span class="rounded-full bg-bi-green/10 px-2 py-0.5 font-semibold text-bi-green">Valid</span>`
    : r.status === 'duplikat'
      ? `<span class="rounded-full bg-bi-gold/20 px-2 py-0.5 font-semibold text-bi-golddark">Duplikat</span>`
      : `<span class="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-600">${escapeHtml(r.errors.join(', '))}</span>`;

  $('importPreviewBody').innerHTML = rows.map((r) => `
    <tr class="${r.status === 'valid' ? '' : 'bg-slate-50'}">
      <td class="px-3 py-2 text-slate-400">${r.baris}</td>
      <td class="px-3 py-2 font-semibold text-bi-navy">${escapeHtml(r.nama || '-')}</td>
      <td class="px-3 py-2">${escapeHtml(r.jurusan || '-')}</td>
      <td class="px-3 py-2">${badge(r)}</td>
    </tr>`).join('');

  const commit = $('btnCommitImport');
  commit.textContent = `Import ${valid} Data`;
  commit.disabled = valid === 0;
  $('importStep1').hidden = true;
  $('importStep2').hidden = false;
  $('btnPreviewImport').hidden = true;
  commit.hidden = false;
}

async function commitImport() {
  const valid = state.importRows.filter((r) => r.status === 'valid');
  if (!valid.length) return;
  const btn = $('btnCommitImport');
  btn.disabled = true;
  try {
    const n = await Backend.insertBatch(
      valid.map((r) => ({ nama: r.nama, jurusan: r.jurusan, status_pengambilan: false, waktu_pengambilan: null })),
      `Import ${new Date().toLocaleString('id-ID')}`, getPetugas()
    );
    hideModal('modalImport');
    resetImport();
    await loadData();
    toast(`${n} data berhasil diimport.`);
  } catch (err) { toast(err.message, { type: 'error' }); }
  finally { btn.disabled = false; }
}

/* ---------------- fast mode ---------------- */

function fastSearch() {
  const q = $('fastInput').value.trim();
  const box = $('fastResult');
  if (!q) { box.innerHTML = ''; return; }
  const matches = state.rows.filter((r) => r.nama.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (!matches.length) {
    box.innerHTML = `<div class="rounded-2xl bg-white p-6 text-center ring-1 ring-bi-line"><p class="font-semibold text-slate-600">Tidak ditemukan</p><p class="mt-1 text-sm text-slate-400">Cek kembali ejaan nama.</p></div>`;
    return;
  }
  if (matches.length === 1) { renderFastResult(matches[0].id); return; }
  box.innerHTML = matches.map((r) => `
    <button data-fast="${r.id}" class="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left ring-1 ring-bi-line hover:ring-bi-blue">
      <span><span class="block font-semibold text-bi-navy">${escapeHtml(r.nama)}</span><span class="text-xs text-slate-500">${escapeHtml(r.jurusan || 'Tanpa jurusan')}</span></span>
      ${statusPill(r)}
    </button>`).join('');
}

function renderFastResult(id) {
  const r = state.rows.find((x) => x.id === id);
  const box = $('fastResult');
  if (!r) { box.innerHTML = ''; return; }
  const sudah = r.status_pengambilan;
  box.innerHTML = `
    <div class="fade-in overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-bi-line">
      <div class="h-1.5 ${sudah ? 'bg-bi-green' : 'bg-bi-gold'}"></div>
      <div class="p-6 text-center">
        <p class="text-xs font-semibold uppercase tracking-widest text-slate-400">Penerima</p>
        <h3 class="mt-1 text-xl font-extrabold text-bi-navy">${escapeHtml(r.nama)}</h3>
        <p class="mt-1 text-sm text-slate-500">${escapeHtml(r.jurusan || 'Tanpa jurusan')}</p>
        <div class="mt-4">
          ${sudah
            ? `<p class="font-bold text-bi-green">✓ SUDAH DIAMBIL</p><p class="mt-1 text-sm text-slate-500">${dateFmt(r.waktu_pengambilan)}</p>`
            : `<p class="font-bold text-bi-golddark">○ BELUM DIAMBIL</p>`}
        </div>
        <div class="mt-5">
          ${sudah
            ? `<button data-action="batal" data-id="${r.id}" class="w-full rounded-xl border border-bi-line px-4 py-3.5 font-bold text-slate-600 hover:bg-bi-ice">Batalkan Pengambilan</button>`
            : `<button data-action="ambil" data-id="${r.id}" class="w-full rounded-xl bg-bi-green px-4 py-3.5 text-lg font-extrabold text-white hover:opacity-90">✓ KONFIRMASI PENGAMBILAN</button>`}
        </div>
      </div>
    </div>`;
}

/* ---------------- modal & confirm ---------------- */

const showModal = (id) => { $(id).hidden = false; };
const hideModal = (id) => { $(id).hidden = true; };

function askConfirm({ title, text, danger, onYes }) {
  state.confirm = onYes;
  $('confirmTitle').textContent = title;
  $('confirmText').textContent = text || '';
  const icon = $('confirmIcon');
  icon.textContent = danger ? '!' : '✓';
  icon.className = `mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl ${danger ? 'bg-red-100 text-red-600' : 'bg-bi-gold/20 text-bi-golddark'}`;
  const yes = $('btnConfirmYes');
  yes.className = `flex-1 rounded-xl px-4 py-2.5 font-semibold text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-bi-navy hover:bg-bi-blue'}`;
  showModal('modalConfirm');
}

function handleAction(action, id) {
  const row = state.rows.find((r) => r.id === id);
  if (!row) return;
  if (action === 'edit') return openPenerima(id);
  if (action === 'ambil') return askConfirm({ title: 'Konfirmasi Pengambilan', text: `${row.nama} — tandai sudah mengambil tas?`, onYes: () => doAmbil(id) });
  if (action === 'batal') return askConfirm({ title: 'Batalkan Pengambilan', text: `${row.nama} akan ditandai belum mengambil tas.`, danger: true, onYes: () => doBatal(id) });
}

/* ---------------- audit log ---------------- */

function auditBadge(aksi) {
  switch (aksi) {
    case 'ambil':
      return `<span class="inline-flex items-center gap-1.5 rounded-full bg-bi-green/10 px-2.5 py-1 text-xs font-semibold text-bi-green"><span class="h-1.5 w-1.5 rounded-full bg-bi-green"></span>Ambil Tas</span>`;
    case 'batal':
      return `<span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700"><span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>Batal Ambil</span>`;
    case 'edit':
      return `<span class="inline-flex items-center gap-1.5 rounded-full bg-bi-blue/10 px-2.5 py-1 text-xs font-semibold text-bi-blue"><span class="h-1.5 w-1.5 rounded-full bg-bi-blue"></span>Edit Data</span>`;
    case 'impor':
      return `<span class="inline-flex items-center gap-1.5 rounded-full bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-700"><span class="h-1.5 w-1.5 rounded-full bg-purple-500"></span>Import Massal</span>`;
    case 'tambah':
      return `<span class="inline-flex items-center gap-1.5 rounded-full bg-bi-sky/15 px-2.5 py-1 text-xs font-semibold text-bi-navy"><span class="h-1.5 w-1.5 rounded-full bg-bi-sky"></span>Tambah Data</span>`;
    case 'hapus':
      return `<span class="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-600"><span class="h-1.5 w-1.5 rounded-full bg-red-600"></span>Hapus Data</span>`;
    default:
      return `<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">${escapeHtml(aksi)}</span>`;
  }
}

function auditDetailText(log) {
  if (log.aksi === 'ambil') return 'Tas berhasil diserahkan ke penerima.';
  if (log.aksi === 'batal') return 'Status pengambilan dibatalkan.';
  if (log.aksi === 'impor') {
    const j = log.nilai_baru && log.nilai_baru.jumlah;
    return j ? `Import massal sebanyak ${j} data penerima beasiswa.` : 'Import data penerima beasiswa.';
  }
  if (log.aksi === 'tambah') return 'Data penerima baru ditambahkan manual.';
  if (log.aksi === 'edit') {
    if (log.nilai_baru && log.nilai_lama) {
      const changes = [];
      if (log.nilai_baru.nama !== log.nilai_lama.nama) changes.push('nama diubah');
      if (log.nilai_baru.jurusan !== log.nilai_lama.jurusan) changes.push('jurusan diubah');
      if (log.nilai_baru.status_pengambilan !== log.nilai_lama.status_pengambilan) {
        changes.push(log.nilai_baru.status_pengambilan ? 'status: diambil' : 'status: dibatalkan');
      }
      if (changes.length) return `Perubahan: ${changes.join(', ')}.`;
    }
    return 'Pembaruan data penerima.';
  }
  return 'Aktivitas sistem tercatat.';
}

function renderAuditStats() {
  const total = state.auditLogs.length;
  const ambil = state.auditLogs.filter((l) => l.aksi === 'ambil').length;
  const batal = state.auditLogs.filter((l) => l.aksi === 'batal').length;
  const lain = total - ambil - batal;

  if ($('statAuditTotal')) $('statAuditTotal').textContent = total;
  if ($('statAuditAmbil')) $('statAuditAmbil').textContent = ambil;
  if ($('statAuditBatal')) $('statAuditBatal').textContent = batal;
  if ($('statAuditLain')) $('statAuditLain').textContent = lain;
}

function filteredAuditLogs() {
  const q = state.auditFilter.q.trim().toLowerCase();
  const aksi = state.auditFilter.aksi;

  return state.auditLogs.filter((log) => {
    if (aksi && log.aksi !== aksi) return false;
    if (!q) return true;
    const nama = String(log.nama || '').toLowerCase();
    const jurusan = String(log.jurusan || '').toLowerCase();
    const oleh = String(log.oleh || '').toLowerCase();
    const act = String(log.aksi || '').toLowerCase();
    const detail = auditDetailText(log).toLowerCase();
    return nama.includes(q) || jurusan.includes(q) || oleh.includes(q) || act.includes(q) || detail.includes(q);
  });
}

function renderAuditLogs() {
  renderAuditStats();
  const rows = filteredAuditLogs();
  if ($('auditCount')) $('auditCount').textContent = `Menampilkan ${rows.length} dari ${state.auditLogs.length} log`;
  if ($('auditEmptyState')) $('auditEmptyState').hidden = rows.length !== 0;

  if ($('auditTableBody')) {
    $('auditTableBody').innerHTML = rows.map((l) => {
      const recipientName = l.nama ? escapeHtml(l.nama) : (l.aksi === 'impor' ? '<span class="text-slate-400 italic">Batch Import</span>' : '<span class="text-slate-400 italic">-</span>');
      const recipientJurusan = l.jurusan ? `<span class="block text-xs text-slate-500">${escapeHtml(l.jurusan)}</span>` : '';
      const olehPetugas = l.oleh ? escapeHtml(l.oleh) : '<span class="text-slate-400 italic">Sistem</span>';
      return `
        <tr class="hover:bg-bi-ice/50 transition">
          <td class="px-4 py-3 whitespace-nowrap text-xs font-medium text-slate-500">${dateFmt(l.waktu)}</td>
          <td class="px-4 py-3 whitespace-nowrap">${auditBadge(l.aksi)}</td>
          <td class="px-4 py-3">
            <span class="font-semibold text-bi-navy">${recipientName}</span>
            ${recipientJurusan}
          </td>
          <td class="px-4 py-3 whitespace-nowrap">
            <span class="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
              <span class="h-1.5 w-1.5 rounded-full bg-bi-gold"></span>${olehPetugas}
            </span>
          </td>
          <td class="px-4 py-3 text-xs text-slate-600">${escapeHtml(auditDetailText(l))}</td>
        </tr>`;
    }).join('');
  }

  if ($('auditCardList')) {
    $('auditCardList').innerHTML = rows.map((l) => {
      const recipientName = l.nama ? escapeHtml(l.nama) : (l.aksi === 'impor' ? 'Batch Import Data' : '-');
      const recipientJurusan = l.jurusan ? `<p class="truncate text-xs text-slate-500">${escapeHtml(l.jurusan)}</p>` : '';
      const olehPetugas = l.oleh ? escapeHtml(l.oleh) : 'Sistem';
      return `
        <div class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-bi-line">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <span class="font-bold text-bi-navy">${recipientName}</span>
              ${recipientJurusan}
            </div>
            ${auditBadge(l.aksi)}
          </div>
          <p class="mt-2 text-xs text-slate-600">${escapeHtml(auditDetailText(l))}</p>
          <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[11px] text-slate-400">
            <span class="font-medium text-slate-600">Oleh: <strong class="text-bi-navy">${olehPetugas}</strong></span>
            <span>${dateFmt(l.waktu)}</span>
          </div>
        </div>`;
    }).join('');
  }
}

async function loadAuditLogs(showSpinner = true) {
  if (showSpinner && $('auditLoading')) $('auditLoading').hidden = false;
  try {
    state.auditLogs = await Backend.listAudit();
    renderAuditLogs();
  } catch (err) {
    toast(err.message || 'Gagal memuat riwayat log.', { type: 'error' });
  } finally {
    if ($('auditLoading')) $('auditLoading').hidden = true;
  }
}

function switchTab(tab) {
  $('viewDashboard').hidden = tab !== 'dashboard';
  $('viewFast').hidden = tab !== 'fast';
  $('viewAudit').hidden = tab !== 'audit';
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.className = `tab-btn rounded-t-lg px-4 py-2.5 text-sm font-semibold border-b-2 ${active ? 'border-bi-gold text-white' : 'border-transparent text-white/60 hover:text-white'}`;
  });
  if (tab === 'fast') setTimeout(() => $('fastInput').focus(), 50);
  if (tab === 'audit') loadAuditLogs();
}

/* ---------------- boot ---------------- */

const showLoading = (v) => { $('screenLoading').hidden = !v; };

async function enterApp() {
  $('screenApp').hidden = false;
  $('screenLoading').hidden = true;
  $('navPetugasName').textContent = getPetugas() || 'Atur petugas';
  $('navPetugasName').parentElement.classList.toggle('bg-red-500/30', !getPetugas());
  if (!getPetugas()) showModal('modalPetugas');
  try { await loadData(); } catch (err) { toast(err.message, { type: 'error' }); }
}

async function boot() {
  if (CONFIGURED) {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }
  await enterApp();
}

/* ---------------- events ---------------- */

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => hideModal(b.dataset.close)));

  $('searchInput').addEventListener('input', (e) => { state.filter.q = e.target.value; renderList(); });
  $('filterStatus').addEventListener('change', (e) => { state.filter.status = e.target.value; renderList(); });

  $('btnTambah').addEventListener('click', () => openPenerima(null));
  $('btnExport').addEventListener('click', exportExcel);
  $('btnImport').addEventListener('click', () => { resetImport(); showModal('modalImport'); });
  $('btnPreviewImport').addEventListener('click', previewImport);
  $('btnCommitImport').addEventListener('click', commitImport);
  $('formPenerima').addEventListener('submit', savePenerima);

  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) { handleAction(btn.dataset.action, btn.dataset.id); return; }
    const fast = e.target.closest('[data-fast]');
    if (fast) { renderFastResult(fast.dataset.fast); }
  });

  $('btnConfirmNo').addEventListener('click', () => { hideModal('modalConfirm'); state.confirm = null; });
  $('btnConfirmYes').addEventListener('click', async () => {
    const fn = state.confirm;
    hideModal('modalConfirm');
    state.confirm = null;
    if (fn) await fn();
  });

  $('fastSearchBtn').addEventListener('click', fastSearch);
  $('fastInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fastSearch(); } });

  // Audit Log events
  $('auditSearchInput').addEventListener('input', (e) => {
    state.auditFilter.q = e.target.value;
    renderAuditLogs();
  });
  $('auditFilterAksi').addEventListener('change', (e) => {
    state.auditFilter.aksi = e.target.value;
    renderAuditLogs();
  });
  $('btnRefreshAudit').addEventListener('click', () => {
    loadAuditLogs(true);
    toast('Audit log diperbarui.');
  });

  const openPetugas = () => { $('inputPetugas').value = getPetugas(); showModal('modalPetugas'); };
  $('navPetugas').addEventListener('click', openPetugas);
  $('navPetugasMobile').addEventListener('click', openPetugas);
  $('formPetugas').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('inputPetugas').value.trim();
    if (!name) return;
    localStorage.setItem(PETUGAS_KEY, name);
    $('navPetugasName').textContent = name;
    $('navPetugasName').parentElement.classList.remove('bg-red-500/30');
    hideModal('modalPetugas');
    toast(`Petugas: ${name}`);
  });
}

bindEvents();
boot();
