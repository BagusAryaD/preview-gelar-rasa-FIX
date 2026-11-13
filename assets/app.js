/* NAPAS static preview — data-driven, no numbers typed in the markup. */
'use strict';

const C = {
  navy: '#182048',
  navy2: '#2A3568',
  navy3: '#3B4784',
  yellow: '#E3A008',
  yellowSoft: '#FFF3BF',
  teal: '#0F9D8A',
  tealSoft: '#DFF6F1',
  moss: '#6B9B2E',
  mossSoft: '#EEF5DC',
  cream: '#F1F6FD',
  paper: '#FFFFFF',
  ink: '#131A38',
  muted: '#5B6484',
  muted2: '#7A82A0',
  terra: '#D9663F',
  terraSoft: '#FBE8E1',
  red: '#B3261E',
  redSoft: '#F8E1DE',
  line: 'rgba(24,32,72,.10)',
  lineSoft: 'rgba(24,32,72,.065)',
  grid: 'rgba(24,32,72,.075)',
  grey: '#A8B0C2',
  grey2: '#C3CAD9',
};

// Year colours for monthly trend lines: two slate tones + a contrasting 2026.
const YEAR_COLORS = { 2024: '#B4BCCD', 2025: '#5E6A93', 2026: '#D9663F' };

const CAT_COLORS = {
  Baik: '#0F9D8A',
  Sedang: '#6B9B2E',
  'Tidak Sehat': '#E3A008',
  'Sangat Tidak Sehat': '#D9663F',
  Berbahaya: '#B3261E',
};

const STATUS_ORDER = ['Baik', 'Perhatian', 'Terbatas', 'Tidak memadai', 'Gagal'];
const QC_PLAIN = {
  VALID: 'Lolos pemeriksaan',
  SUSPECT: 'Perlu pemeriksaan',
  MISSING: 'Tidak ada data',
  NONAKTIF: 'Sensor nonaktif',
  ERROR: 'Gangguan sensor',
};
const QC_COLOR = { VALID: '#0F9D8A', SUSPECT: '#E3A008', MISSING: '#A8B0C2', NONAKTIF: '#7B6BB0', ERROR: '#C0453C' };
function qcLabel(k) { return QC_PLAIN[k] || k; }
const OUTCOME_LABELS = {
  resp: 'Respirasi',
  resp_admissions_under5: 'Balita',
  resp_admissions_over60: 'Lansia',
  asthma_emergency_cases: 'Asma',
  copd_admissions: 'PPOK',
  cvd: 'Kardiovaskular',
  death: 'Kematian',
};

const state = {
  page: 'ringkasan',
  island: 'Semua',
  station: null,
  date: '2026-10-14',
  range: 'tahun',
  tab: {},
  lagOutcome: 'resp',
  compare: [],
  compareA: null,
  compareB: null,
  provMetric: 'actual',
  healthTable: 'stasiun',
  tableSort: 'mean',
  tableSearch: '',
  networkSort: 'usable',
  detail: null,
  origin: null,
  pendingScroll: 0,
};

const DATA = {};
let charts = [];
let maps = [];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const nf1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function fmt(v, d = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  if (d === 0) return nf0.format(Number(v));
  if (d === 2) return nf2.format(Number(v));
  return nf1.format(Number(v));
}
function fmtInt(v) { return fmt(v, 0); }
function fmtDateISO(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}
function unitLabel(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '—') return '—';
  if (s === 'ug/m3') return 'µg/m³';
  if (s === 'ppm') return 'ppm';
  return s;
}
function average(values) {
  const clean = (values || []).filter((v) => v != null && !Number.isNaN(Number(v)));
  if (!clean.length) return null;
  return clean.reduce((a, v) => a + Number(v), 0) / clean.length;
}
function fmtRatio(v) { return fmt(v, 1).replace('-', '−'); }
function fmtR(v) { return nf3.format(Number(v)).replace('-', '−'); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function statusSlug(s) { return String(s || '').toLowerCase().replace(/\s+/g, '-'); }
function statusBadge(s) { return `<span class="badge ${statusSlug(s)}"><span class="dot"></span>${esc(s)}</span>`; }
function pmColor(v) {
  if (v === null || v === undefined) return '#C3CAD9';
  if (v <= 15) return C.teal;
  if (v <= 55) return C.moss;
  if (v <= 100) return C.yellow;
  if (v <= 200) return C.terra;
  return C.red;
}
function completenessColor(v) {
  if (v === null || v === undefined) return '#C3CAD9';
  if (v >= 95) return C.teal;
  if (v >= 80) return C.yellow;
  return C.terra;
}
function catColor(c) { return CAT_COLORS[c] || '#C3CAD9'; }

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 1800);
}


/* ------------------------------------------------------------------ boot */
async function boot() {
  if (!window.echarts || !window.maplibregl) {
    $('#page').innerHTML = `<div class="empty"><div>Library chart belum termuat.</div><div class="card-sub">Periksa koneksi CDN, lalu muat ulang.</div></div>`;
    return;
  }
  const files = ['meta', 'overview', 'stations', 'time', 'sources', 'health', 'hospitals', 'network', 'method', 'hourly', 'hourly_stations', 'pollutants', 'health_daily'];
  try {
    const payloads = await Promise.all(files.map((f) => fetch(`data/${f}.json`).then((r) => {
      if (!r.ok) throw new Error(`${f}.json ${r.status}`);
      return r.json();
    })));
    files.forEach((f, i) => { DATA[f] = payloads[i]; });
  } catch (err) {
    $('#page').innerHTML = `<div class="empty"><div>Data preview gagal dimuat.</div><div class="card-sub">${esc(err.message)}</div></div>`;
    return;
  }
  DATA.stationsById = new Map(DATA.stations.stations.map((s) => [s.id, s]));
  DATA.islands = Array.from(new Set(DATA.stations.stations.map((s) => s.island)));
  const per = DATA.meta && DATA.meta.periods;
  if (per && per.data_start_iso) DATE_MIN = per.data_start_iso;
  if (per && per.data_end_iso) DATE_MAX = per.data_end_iso;
  DATA.hospitalsById = new Map((DATA.hospitals.hospitals || []).map((h) => [h.id, h]));
  DATA.hospitalsByStation = new Map((DATA.hospitals.hospitals || []).map((h) => [h.station, h]));
  DATA.provincesByName = new Map((DATA.hospitals.provinces || []).map((p) => [p.province, p]));
  DATA.stationDayIndex = {};
  Object.entries(DATA.time.station_daily || {}).forEach(([id, rows]) => {
    const m = new Map();
    rows.forEach((r) => m.set(r[0], r[1]));
    DATA.stationDayIndex[id] = m;
  });
  parseUrl();
  initShell();
  applyRange();
  render();
  fit();
  window.addEventListener('resize', () => {
    fit();
    requestAnimationFrame(() => {
      charts.forEach((c) => { try { c.resize(); } catch (_) {} });
      maps.forEach((m) => { try { m.resize(); } catch (_) {} });
    });
  });
}

function fit() {
  const app = $('#app');
  if (app) app.style.transform = '';
}

/* ------------------------------------------------------------ range engine */
const EXCLUDED_STATIONS = new Set(['JMB-02', 'MER-01']);
const RANGE_KEYS = ['hari', 'bulan', 'tahun', 'semua'];
const RANGE_NAMES = { hari: 'Hari', bulan: 'Bulan', tahun: 'Tahun', semua: 'Semua' };
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
let DATE_MIN = '2024-01-01';
let DATE_MAX = '2026-10-14';

function clampDate(iso) {
  if (!iso) return DATE_MAX;
  return iso < DATE_MIN ? DATE_MIN : (iso > DATE_MAX ? DATE_MAX : iso);
}

function boundsFor(range, date) {
  const d = clampDate(date);
  if (range === 'hari') return [d, d];
  if (range === 'bulan') return [`${d.slice(0, 7)}-01`, d];
  if (range === 'tahun') return [`${d.slice(0, 4)}-01-01`, d];
  return [DATE_MIN, d];
}

function rangeBounds() {
  return boundsFor(state.range, state.date);
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

function dayMonth(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTH_ABBR[Number(m) - 1]}`;
}

function rangeText(from, to) {
  if (from === to) return shortDate(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${dayMonth(from)}–${shortDate(to)}`;
  return `${shortDate(from)} – ${shortDate(to)}`;
}

/* Jumlah hari inklusif antara dua tanggal ISO (dihitung, bukan ditulis manual). */
function daySpan(from, to) {
  const utc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86400000) + 1;
}

/* Label rentang ringkas untuk badge kartu: "14 Okt 2026" · "Okt 2026" · "2026" · "2024–2026". */
function viewRangeShort() {
  const [from, to] = rangeBounds();
  if (from === to) return shortDate(to);
  const fy = from.slice(0, 4);
  const ty = to.slice(0, 4);
  if (fy === ty) {
    if (from.slice(5) === '01-01') return ty;
    return `${MONTH_ABBR[Number(from.slice(5, 7)) - 1]} ${ty}`;
  }
  return `${fy}–${ty}`;
}

function rangeLabel() {
  const [from, to] = rangeBounds();
  return rangeText(from, to);
}

/* Keterangan periode di samping judul plot.
   'range' → mengikuti rentang filter · 'full' → seluruh periode data · 'day' → tanggal acuan.
   Nilai lain dipakai apa adanya (teks literal, mis. jendela khusus sebuah grafik). */
function periodText(kind) {
  if (kind === 'range') return DATA.view.label;
  if (kind === 'full') return `${DATE_MIN.slice(0, 4)}–${DATE_MAX.slice(0, 4)} penuh`;
  if (kind === 'day') return shortDate(state.date);
  return kind || '';
}

/* Geser tanggal ISO sejumlah hari (jendela grafik harian ± hari). */
function shiftIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* Jendela rata-rata jaringan: N hari terakhir dataset (N dari days_2026 di JSON). */
function networkMeanPeriod() {
  const days = Math.max(0, ...(DATA.network.stations || []).map((s) => s.days_2026 || 0));
  if (!days) return '';
  return rangeText(shiftIso(DATE_MAX, -(days - 1)), DATE_MAX);
}

/* Penjelas tiap opsi rentang — jendela konkret dihitung dari tanggal acuan. */
const RANGE_TIPS = {
  hari: 'Satu hari penuh pada tanggal acuan.',
  bulan: 'Dari tanggal 1 bulan berjalan sampai tanggal acuan.',
  tahun: 'Dari 1 Januari tahun berjalan sampai tanggal acuan.',
  semua: 'Seluruh periode data yang tersedia, tanpa batas tahun.',
};

function rangeTipHtml(key) {
  const [from, to] = boundsFor(key, state.date);
  const days = daySpan(from, to);
  return `<div class="tip-title">Rentang · ${esc(RANGE_NAMES[key])}</div>`
    + '<div class="tip-rows">'
    + `<div class="tip-row"><span>Periode</span><b>${esc(rangeText(from, to))}</b></div>`
    + `<div class="tip-row"><span>Hari</span><b>${fmtInt(days)} hari</b></div>`
    + '</div>'
    + `<div class="tip-note">${esc(RANGE_TIPS[key])}</div>`;
}

function shiftSpan(from, to, year) {
  const shift = (iso) => {
    const md = iso.slice(5);
    const month = Number(md.slice(0, 2));
    const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(Number(md.slice(3, 5)), dim);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  return [shift(from), shift(to)];
}

function catOf(v) {
  if (v == null) return null;
  if (v <= 15.5) return 'Baik';
  if (v <= 55.4) return 'Sedang';
  if (v <= 150.4) return 'Tidak Sehat';
  if (v <= 250.4) return 'Sangat Tidak Sehat';
  return 'Berbahaya';
}

function compOf(vals) {
  const counts = {};
  CAT_ORDER.forEach((k) => { counts[k] = 0; });
  vals.forEach((v) => { const c = catOf(v); if (c) counts[c] += 1; });
  const n = vals.length || 1;
  const out = {};
  CAT_ORDER.forEach((k) => { out[k] = vals.length ? round1(counts[k] / n * 100) : 0; });
  return out;
}

function dominantCat(comp) {
  let best = null;
  CAT_ORDER.forEach((k) => { if (comp && comp[k] > 0 && (best === null || comp[k] > comp[best])) best = k; });
  return best || 'Tanpa data';
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

function stationRange(id, from, to) {
  const rows = (DATA.time.station_daily || {})[id] || [];
  const vals = [];
  for (const r of rows) if (r[0] >= from && r[0] <= to) vals.push(r[1]);
  return vals;
}

function statsFrom(vals, stationCount) {
  if (!vals.length) {
    return { mean: null, days: 0, stations: 0, above55_pct: null, above55_n: 0, severe_n: 0, p95: null, max: null, comp: null };
  }
  const sorted = vals.slice().sort((a, b) => a - b);
  let sum = 0;
  let a55 = 0;
  let sev = 0;
  for (const v of vals) { sum += v; if (v > 55) a55 += 1; if (v > 150.4) sev += 1; }
  return {
    mean: round1(sum / vals.length),
    days: vals.length,
    stations: stationCount,
    above55_pct: round1(a55 / vals.length * 100),
    above55_n: a55,
    severe_n: sev,
    p95: round1(quantile(sorted, 0.95)),
    max: round1(sorted[sorted.length - 1]),
    comp: compOf(vals),
  };
}

function scopeStationIds() {
  return DATA.stations.stations.filter((s) => !EXCLUDED_STATIONS.has(s.id)).map((s) => s.id);
}

function statsForStations(ids, from, to) {
  const per = {};
  const all = [];
  for (const id of ids) {
    const v = stationRange(id, from, to);
    if (!v.length) continue;
    per[id] = statsFrom(v, 1);
    for (const x of v) all.push(x);
  }
  return { all: statsFrom(all, Object.keys(per).length), per };
}

function dayValue(id, iso) {
  const m = DATA.stationDayIndex && DATA.stationDayIndex[id];
  if (!m) return null;
  const v = m.get(iso);
  return v == null ? null : v;
}

function dayCategory(id, iso) {
  const v = dayValue(id, iso);
  return v == null ? 'Tanpa data' : catOf(v);
}

function healthHospitalIds() {
  return (DATA.hospitals.hospitals || [])
    .filter((h) => state.island === 'Semua' || h.island === state.island)
    .filter((h) => !state.station || h.station === state.station)
    .map((h) => h.id);
}

function sumHealth(ids, from, to) {
  const keys = (DATA.health_daily && DATA.health_daily.keys) || [];
  const totals = {};
  keys.forEach((k) => { totals[k] = 0; });
  const days = new Set();
  ids.forEach((id) => {
    const rows = (DATA.health_daily.hospitals || {})[id] || [];
    rows.forEach((r) => {
      if (r[0] < from || r[0] > to) return;
      days.add(r[0]);
      for (let i = 0; i < keys.length; i += 1) totals[keys[i]] += r[i + 1] || 0;
    });
  });
  return { days: days.size, actual: totals };
}

function healthYearsFor(ids, from, to) {
  return [2024, 2025, 2026].map((y) => {
    const [f, t] = shiftSpan(from, to, y);
    const s = sumHealth(ids, f, t);
    return { year: y, days: s.days, actual: s.actual };
  });
}

function applyHealthRange(from, to) {
  const keys = (DATA.health_daily && DATA.health_daily.keys) || [];
  const ids = healthHospitalIds();
  DATA.health.scopeYears = healthYearsFor(ids, from, to);
  DATA.health.years = DATA.health.scopeYears;
  DATA.health.span = sumHealth(ids, from, to);
  const byIsland = {};
  DATA.islands.forEach((isl) => {
    const iids = (DATA.hospitals.hospitals || []).filter((h) => h.island === isl).map((h) => h.id);
    byIsland[isl] = healthYearsFor(iids, from, to);
  });
  DATA.health.byIsland = byIsland;

  const stations = [];
  DATA.stations.stations.forEach((s) => {
    const hids = (DATA.hospitals.hospitals || []).filter((h) => h.station === s.id).map((h) => h.id);
    if (!hids.length) return;
    const base = (DATA.health.stations || []).find((r) => r.station === s.id) || {};
    const cur = sumHealth(hids, from, to);
    const resp = cur.actual.resp || 0;
    const u5 = cur.actual.resp_admissions_under5 || 0;
    const o60 = cur.actual.resp_admissions_over60 || 0;
    stations.push({
      station: s.id,
      island: s.island,
      days: cur.days,
      resp_actual: resp,
      resp_under5_actual: u5,
      resp_over60_actual: o60,
      under5_share: resp ? round1(u5 / resp * 100) : null,
      over60_share: resp ? round1(o60 / resp * 100) : null,
      lag0: base.lag0 || {},
      lag0_resp: base.lag0_resp,
      episode_days: (DATA.view.byStation[s.id] || {}).above55_n || 0,
      usable_pct: base.usable_pct,
      status: base.status,
      outcomes: Object.fromEntries(keys.map((k) => [k, cur.actual[k] || 0])),
    });
  });
  stations.sort((a, b) => b.resp_actual - a.resp_actual);
  DATA.health.stations = stations;
}

function applyHospitalRange(from, to) {
  const keys = (DATA.health_daily && DATA.health_daily.keys) || [];
  (DATA.hospitals.hospitals || []).forEach((h) => {
    const s = sumHealth([h.id], from, to);
    h.actual = s.actual;
    h.days = s.days;
    h.per100beds = h.beds ? round1(s.actual.resp / h.beds * 100) : null;
  });
  const daysSeen = (DATA.hospitals.hospitals || []).reduce((a, h) => Math.max(a, h.days || 0), 0);
  if (DATA.hospitals.meta) {
    DATA.hospitals.meta.days = daysSeen;
    DATA.hospitals.meta.window = DATA.view.label;
  }
  const byProv = new Map();
  (DATA.hospitals.hospitals || []).forEach((h) => {
    const p = byProv.get(h.province) || {
      province: h.province,
      hospitals: 0,
      beds: 0,
      island: h.island,
      actual: Object.fromEntries(keys.map((k) => [k, 0])),
    };
    p.hospitals += 1;
    p.beds += h.beds || 0;
    keys.forEach((k) => { p.actual[k] += h.actual[k] || 0; });
    byProv.set(h.province, p);
  });
  const provinces = Array.from(byProv.values()).map((p) => ({
    ...p,
    beds: Math.round(p.beds),
    per100beds: p.beds ? round1(p.actual.resp / p.beds * 100) : null,
  }));
  provinces.sort((a, b) => b.actual.resp - a.actual.resp);
  DATA.hospitals.provinces = provinces;
  DATA.provincesByName = new Map(provinces.map((p) => [p.province, p]));
  const byIsland = {};
  provinces.forEach((p) => {
    const agg = byIsland[p.island] || { island: p.island, hospitals: 0, beds: 0, actual: Object.fromEntries(keys.map((k) => [k, 0])) };
    agg.hospitals += p.hospitals;
    agg.beds += p.beds;
    keys.forEach((k) => { agg.actual[k] += p.actual[k]; });
    byIsland[p.island] = agg;
  });
  DATA.hospitals.provinces_by_island = Object.values(byIsland).map((p) => ({
    ...p,
    per100beds: p.beds ? round1(p.actual.resp / p.beds * 100) : null,
  }));
}

function applyWeekdayRange(from, to) {
  const rows = [];
  const islandRows = {};
  const split = (src, f, t) => {
    const wd = [];
    const we = [];
    src.forEach((r) => {
      if (r[0] < f || r[0] > t) return;
      const dow = new Date(`${r[0]}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) we.push(r[1]); else wd.push(r[1]);
    });
    return {
      weekday: wd.length ? round1(average(wd)) : null,
      weekend: we.length ? round1(average(we)) : null,
    };
  };
  [2024, 2025, 2026].forEach((y) => {
    const [f, t] = shiftSpan(from, to, y);
    rows.push({ year: y, ...split(DATA.time.daily || [], f, t) });
    DATA.islands.forEach((isl) => {
      (islandRows[isl] = islandRows[isl] || []).push({
        year: y,
        island: isl,
        ...split((DATA.time.daily_island || {})[isl] || [], f, t),
      });
    });
  });
  DATA.time.weekday = rows;
  DATA.time.weekday_island = Object.values(islandRows).flat();
}

function applySourceRange(from, to) {
  const keys = (DATA.pollutants && DATA.pollutants.keys) || [];
  const sums = {};
  const counts = {};
  const perStation = {};
  keys.forEach((k) => { sums[k] = 0; counts[k] = 0; });
  DATA.stations.stations.forEach((s) => {
    if (EXCLUDED_STATIONS.has(s.id)) return;
    const rows = (DATA.pollutants.stations || {})[s.id] || [];
    const acc = {};
    keys.forEach((k) => { acc[k] = { s: 0, n: 0 }; });
    rows.forEach((r) => {
      if (r[0] < from || r[0] > to) return;
      for (let i = 0; i < keys.length; i += 1) {
        const v = r[i + 1];
        if (v == null) continue;
        acc[keys[i]].s += v;
        acc[keys[i]].n += 1;
        sums[keys[i]] += v;
        counts[keys[i]] += 1;
      }
    });
    perStation[s.id] = acc;
  });
  const valueOf = (k) => (counts[k] ? round1(sums[k] / counts[k]) : null);
  DATA.sources.pollutants = (DATA.sources.pollutants || []).map((p) => (
    p.key === 'pm25'
      ? { ...p, value: DATA.view.stats.mean, n: DATA.view.stats.days }
      : { ...p, value: valueOf(p.key), n: counts[p.key] || 0 }
  ));
  DATA.sources.meteo = (DATA.sources.meteo || []).map((p) => ({ ...p, value: valueOf(p.key), n: counts[p.key] || 0 }));

  const islandAgg = (isl) => {
    const acc = {};
    keys.forEach((k) => { acc[k] = { s: 0, n: 0 }; });
    DATA.stations.stations.forEach((s) => {
      if (s.island !== isl || !perStation[s.id]) return;
      keys.forEach((k) => { acc[k].s += perStation[s.id][k].s; acc[k].n += perStation[s.id][k].n; });
    });
    return acc;
  };
  DATA.sources.pollutants_by_island = Object.fromEntries(DATA.islands.map((isl) => {
    const acc = islandAgg(isl);
    const islDays = (DATA.view.byIsland[isl] || {}).days || 0;
    return [isl, (DATA.sources.pollutants || []).map((p) => ({
      key: p.key,
      label: p.label,
      unit: p.unit,
      value: p.key === 'pm25' ? ((DATA.view.byIsland[isl] || {}).mean ?? null) : (acc[p.key] && acc[p.key].n ? round1(acc[p.key].s / acc[p.key].n) : null),
      n: p.key === 'pm25' ? islDays : (acc[p.key] ? acc[p.key].n : 0),
    }))];
  }));

  const updateScatter = (rows) => (rows || []).map((r) => {
    const st = DATA.view.byStation[r.station];
    if (!st) return { ...r, pm25: null };
    return { ...r, pm25: st.mean, days: st.days, episode_days: st.above55_n };
  }).filter((r) => r.pm25 != null);
  DATA.sources.all = updateScatter(DATA.sources.all);
  DATA.sources.only2026 = updateScatter(DATA.sources.only2026);
}

/* ------------------------------------------------------- kurva 24 jam (µg/m³) */
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

/* Nama lokasi baku — dipakai semua plot 24 jam supaya istilahnya seragam. */
function scopeLabel() {
  if (state.station) return state.station;
  return state.island === 'Semua' ? 'Nasional' : state.island;
}

/* Nama kelas lokasi dalam bahasa Indonesia (legenda, tooltip, rincian). */
const CLASS_LABELS = {
  'Traffic/Roadside': 'Koridor jalan',
  'Peatland/Forest': 'Lahan gambut',
  Industrial: 'Industri',
  'Urban Background': 'Latar perkotaan',
  'Clean/Regional': 'Luar kota',
};
function classLabel(cls) { return CLASS_LABELS[cls] || cls; }

/* Rata-rata per jam pada rentang aktif + rata-rata harian (µg/m³).
   mat = larik [tanggal][24 jam]; tanggal disejajarkan lewat dates. */
function hourMeans(dates, mat, from, to) {
  const sums = new Array(24).fill(0);
  const counts = new Array(24).fill(0);
  let total = 0;
  let totalN = 0;
  for (let i = 0; i < dates.length; i += 1) {
    if (dates[i] < from || dates[i] > to) continue;
    const row = mat[i];
    if (!row) continue;
    for (let h = 0; h < 24; h += 1) {
      const v = row[h];
      if (v == null) continue;
      sums[h] += v;
      counts[h] += 1;
      total += v;
      totalN += 1;
    }
  }
  return {
    means: sums.map((s, h) => (counts[h] ? round1(s / counts[h]) : null)),
    counts,
    daily: totalN ? round1(total / totalN) : null,
  };
}

/* Matriks jam cakupan terpilih: stasiun bila dipilih, kalau tidak pulau/nasional. */
function hourlyScopeMatrix() {
  const hs = DATA.hourly_stations || {};
  if (state.station && hs.stations && hs.stations[state.station]) {
    return { dates: hs.dates || [], mat: hs.stations[state.station] };
  }
  const h = DATA.hourly || {};
  const key = state.island === 'Semua' ? 'Nasional' : state.island;
  return { dates: h.dates || [], mat: (h.scopes || {})[key] || null };
}

/* Kurva 24 jam cakupan terpilih pada rentang aktif (mode Hari = tanggal itu). */
function diurnalCurve() {
  const [from, to] = rangeBounds();
  const { dates, mat } = hourlyScopeMatrix();
  const out = mat
    ? hourMeans(dates, mat, from, to)
    : { means: new Array(24).fill(null), counts: new Array(24).fill(0), daily: null };
  return { ...out, label: scopeLabel(), from, to };
}

/* Kurva 24 jam tiap kelas lokasi pada pulau aktif (tidak tersedia per stasiun). */
function diurnalClassCurves() {
  const [from, to] = rangeBounds();
  const h = DATA.hourly || {};
  const key = state.island === 'Semua' ? 'Nasional' : state.island;
  const per = (h.class_scopes || {})[key] || {};
  const dates = h.dates || [];
  return Object.keys(per).map((cls) => {
    const r = hourMeans(dates, per[cls], from, to);
    return { cls, label: classLabel(cls), vals: r.means, daily: r.daily };
  }).filter((s) => s.vals.some((v) => v != null));
}

function applyRange() {
  const [from, to] = rangeBounds();
  state.date = clampDate(state.date);
  const ids = scopeStationIds();
  const { all, per } = statsForStations(ids, from, to);

  const islandIds = {};
  DATA.stations.stations.forEach((s) => {
    if (EXCLUDED_STATIONS.has(s.id)) return;
    (islandIds[s.island] = islandIds[s.island] || []).push(s.id);
  });
  const byIsland = {};
  Object.keys(islandIds).forEach((isl) => {
    const v = islandIds[isl].flatMap((id) => stationRange(id, from, to));
    byIsland[isl] = statsFrom(v, islandIds[isl].filter((id) => stationRange(id, from, to).length).length);
  });

  DATA.overview.stats_window = { all, by_island: byIsland, by_station: per };
  DATA.overview.island26 = Object.keys(byIsland)
    .map((isl) => ({ island: isl, mean: byIsland[isl].mean, max: byIsland[isl].max, days: byIsland[isl].days, stations: byIsland[isl].stations }))
    .sort((a, b) => (b.mean || 0) - (a.mean || 0));
  DATA.overview.ispu_haze26_pct = Object.fromEntries(Object.keys(byIsland).map((isl) => [isl, byIsland[isl].comp]));
  DATA.overview.ispu_station_pct = Object.fromEntries(Object.keys(per).map((id) => [id, per[id].comp]));
  DATA.overview.top26 = ids.filter((id) => per[id]).map((id) => {
    const s = DATA.stationsById.get(id);
    return { station: id, island: s.island, site_class: s.site_class, mean: per[id].mean, p95: per[id].p95, max: per[id].max, days: per[id].days };
  }).sort((a, b) => b.mean - a.mean);

  const prev = shiftSpan(from, to, 2024);
  const prevStats = state.range === 'semua' || to < '2025-01-01'
    ? { mean: null }
    : statsForStations(ids, prev[0], prev[1]).all;
  const ratio = prevStats.mean ? all.mean / prevStats.mean : null;

  DATA.view = { from, to, label: rangeText(from, to), name: RANGE_NAMES[state.range], stats: all, byIsland, byStation: per, ratio, date: state.date };
  DATA.overview.kpis = [{
    id: 'national',
    value: all.mean,
    ratio,
    note: `${rangeText(from, to)} · ${fmtInt(all.days)} hari-stasiun · ${all.stations} stasiun`,
  }];

  DATA.stations.stations.forEach((s) => {
    const st = per[s.id] || null;
    s.mean_2026 = st ? st.mean : null;
    s.p95_2026 = st ? st.p95 : null;
    s.max_2026 = st ? st.max : null;
    s.days_2026 = st ? st.days : 0;
    s.ispu_dominant = st ? dominantCat(st.comp) : 'Tanpa data';
    s.ispu_share = st ? st.comp[s.ispu_dominant] : null;
    s.day_value = dayValue(s.id, state.date);
    s.day_category = s.day_value == null ? 'Tanpa data' : catOf(s.day_value);
  });

  applyHealthRange(from, to);
  applyHospitalRange(from, to);
  applyWeekdayRange(from, to);
  applySourceRange(from, to);
}

function syncRangeUi() {
  const input = $('#filter-date');
  if (input) {
    input.min = DATE_MIN;
    input.max = DATE_MAX;
    input.value = state.date;
  }
  $$('#range-seg button').forEach((b) => {
    const on = b.dataset.range === state.range;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.setAttribute('data-tip-html', rangeTipHtml(b.dataset.range));
  });
}

function parseUrl() {
  const p = new URLSearchParams(location.search);
  const page = p.get('page');
  if (['ringkasan', 'waktu', 'wilayah', 'sumber', 'kesehatan', 'jaringan', 'metodologi'].includes(page)) state.page = page;
  const island = p.get('island');
  if (island && (island === 'Semua' || DATA.islands.includes(island))) state.island = island;
  const station = p.get('station');
  if (station && DATA.stationsById.has(station)) state.station = station;
  const date = p.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) state.date = clampDate(date);
  const range = p.get('range');
  if (RANGE_KEYS.includes(range)) state.range = range;
  const tab = p.get('tab');
  if (tab) state.tab[state.page] = tab;
  const src = p.get('source');
}

function updateUrl() {
  const p = new URLSearchParams();
  if (state.page !== 'ringkasan') p.set('page', state.page);
  if (state.island !== 'Semua') p.set('island', state.island);
  if (state.station) p.set('station', state.station);
  if (state.date !== '2026-10-14') p.set('date', state.date);
  if (state.range !== 'tahun') p.set('range', state.range);
  const t = state.tab[state.page];
  if (t) p.set('tab', t);
  const q = p.toString();
  history.replaceState(history.state, '', q ? `?${q}` : location.pathname);
}

/* ------------------------------------------------------------------ shell */
function initShell() {
  const islandSel = $('#filter-island');
  islandSel.innerHTML = ['Semua', ...DATA.islands].map((x) => `<option value="${esc(x)}">${x === 'Semua' ? 'Semua pulau' : esc(x)}</option>`).join('');
  islandSel.value = state.island;

  const stationSel = $('#filter-station');
  stationSel.innerHTML = '<option value="">Semua stasiun</option>' + DATA.stations.stations
    .slice().sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => `<option value="${esc(s.id)}">${esc(s.id)} · ${esc(s.city)}</option>`).join('');
  stationSel.value = state.station || '';

  islandSel.addEventListener('change', () => {
    state.island = islandSel.value;
    if (state.station) {
      const st = DATA.stationsById.get(state.station);
      if (st && state.island !== 'Semua' && st.island !== state.island) state.station = null;
    }
    applyRange();
    render();
  });
  stationSel.addEventListener('change', () => {
    state.station = stationSel.value || null;
    if (!state.station && state.page === 'ringkasan') state.origin = null;
    applyRange();
    render();
  });
  const dateInput = $('#filter-date');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      const next = clampDate(dateInput.value);
      if (!next) return;
      state.date = next;
      applyRange();
      render();
    });
  }
  $$('#range-seg button').forEach((b) => b.addEventListener('click', () => {
    if (!RANGE_KEYS.includes(b.dataset.range)) return;
    state.range = b.dataset.range;
    applyRange();
    render();
  }));
  $('#btn-reset').addEventListener('click', () => {
    state.island = 'Semua';
    state.station = null;
    state.date = DATE_MAX;
    state.range = 'tahun';
    applyRange();
    render();
  });
  $$('.nav-item').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    go(a.dataset.page);
  }));
  $('#btn-share').addEventListener('click', shareLink);
  $('#more-share').addEventListener('click', () => { closeMore(); shareLink(); });
  const chip = $('#back-chip');
  if (chip) chip.addEventListener('click', () => {
    const s = history.state || {};
    if (state.detail && s.napas === 'detail') history.back();
    else if (!state.detail && state.origin && s.napas === 'origin') history.back();
    else if (state.detail) closeDetail(true);
    else returnToOrigin();
  });
  $('#detail-close').addEventListener('click', dismissDetail);
  $('#detail-scrim').addEventListener('click', dismissDetail);
  $('#detail-body').addEventListener('click', (e) => {
    const hosp = e.target.closest('[data-hospital]');
    if (hosp) {
      e.preventDefault();
      const spec = detailHospital(hosp.dataset.hospital);
      if (spec) openDetail(spec);
      return;
    }
    const st = e.target.closest('[data-station]');
    if (st) { e.preventDefault(); openStationProfile(st.dataset.station); }
  });
  window.addEventListener('popstate', (e) => {
    const s = e.state || {};
    if (state.detail && s.key !== state.detail.key) closeDetail(true);
    if (!state.detail && state.origin && s.napas !== 'origin') returnToOrigin();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.detail) dismissDetail();
      else if (document.body.classList.contains('filters-open')) closeFilters();
      else if (!$('#more-sheet').hidden) closeMore();
    }
  });
  $('#page').addEventListener('click', onPageClick);
  $('#page').addEventListener('keydown', (e) => {
    const kpi = e.target.closest('[data-kpi]');
    if (!kpi || e.target.closest('.info')) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      kpiGo(kpi.dataset.kpi);
    }
  });
  initMobileChrome();
  initTip();
}

function initMobileChrome() {
  $$('.mnav-item[data-page]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    go(a.dataset.page);
  }));
  $$('.more-item[data-page]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    go(a.dataset.page);
  }));
  $('#btn-more').addEventListener('click', () => {
    const sheet = $('#more-sheet');
    const open = sheet.hidden;
    sheet.hidden = !open;
    $('#btn-more').setAttribute('aria-expanded', String(open));
  });
  $('#btn-filter-mobile').addEventListener('click', openFilters);
  $('#btn-filter-close').addEventListener('click', closeFilters);
  $('#btn-filter-apply').addEventListener('click', closeFilters);
  $('#filter-scrim').addEventListener('click', closeFilters);
}

function openFilters() {
  closeMore();
  document.body.classList.add('filters-open');
  $('#filter-scrim').hidden = false;
  $('#btn-filter-mobile').setAttribute('aria-expanded', 'true');
}

function closeFilters() {
  document.body.classList.remove('filters-open');
  const scrim = $('#filter-scrim');
  if (scrim) scrim.hidden = true;
  const btn = $('#btn-filter-mobile');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function closeMore() {
  const sheet = $('#more-sheet');
  if (sheet) sheet.hidden = true;
  const btn = $('#btn-more');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

async function shareLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Tautan disalin');
  } catch {
    toast(location.href);
  }
}

function go(page) {
  state.page = page;
  state.origin = null;
  closeDetail(true);
  closeFilters();
  closeMore();
  render();
  renderBackChip();
}

// KPI cards are entry points: they hand the story to the page that explains it.
function kpiGo(id) {
  if (state.page !== 'ringkasan') return;
  const dest = KPI_DEST[id];
  if (!dest) return;
  if (dest.station) {
    const top = topRowsFull()[0];
    const spec = top ? detailStation(top.id, { cta: 'wilayah' }) : null;
    if (spec) openDetail(spec);
    return;
  }
  jumpTo(dest.page);
}

function onPageClick(e) {
  const kpi = e.target.closest('[data-kpi]');
  if (kpi && !e.target.closest('.info')) {
    kpiGo(kpi.dataset.kpi);
    return;
  }
  const nav = e.target.closest('[data-go]');
  if (nav) {
    e.preventDefault();
    go(nav.dataset.go);
    return;
  }
    const tab = e.target.closest('[data-tab]');
  if (tab) {
    state.tab[state.page] = tab.dataset.tab;
    render();
    return;
  }
  const provMetric = e.target.closest('[data-provmetric]');
  if (provMetric) {
    state.provMetric = provMetric.dataset.provmetric === 'per100' ? 'per100' : 'actual';
    applyProvMetric();
    return;
  }
  const healthTable = e.target.closest('[data-health-table]');
  if (healthTable) {
    setHealthTable(healthTable.dataset.healthTable === 'rs' ? 'rs' : 'stasiun');
    return;
  }
  const st = e.target.closest('[data-station]');
  if (st) {
    state.station = st.dataset.station;
    render();
    return;
  }
  const act = e.target.closest('[data-action]');
  if (act) {
    e.preventDefault();
    const a = act.dataset.action;
    if (a === 'back-origin') returnToOrigin();
    if (a === 'compare-station') {
      const spec = detailCompare();
      if (spec) openDetail(spec);
    }
  }
}

/* ------------------------------------------------------------ detail panel */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function monthFull(m) {
  const [y, mo] = String(m).split('-');
  return `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
}

const PAGE_NAMES = {
  ringkasan: 'Ringkasan', waktu: 'Waktu', wilayah: 'Stasiun', sumber: 'Sumber',
  kesehatan: 'Kesehatan', jaringan: 'Jaringan', metodologi: 'Metodologi',
};

function renderBackChip() {
  const chip = $('#back-chip');
  if (!chip) return;
  const label = state.detail ? state.detail.chip : (state.origin ? PAGE_NAMES[state.origin.page] : null);
  document.body.classList.toggle('has-back', !!label);
  if (!label) {
    chip.hidden = true;
    chip.classList.remove('to-page');
    $('#back-chip-label').textContent = '';
    return;
  }
  chip.hidden = false;
  chip.classList.toggle('to-page', !state.detail);
  $('#back-chip-label').textContent = label;
  chip.setAttribute('aria-label', state.detail ? `Tutup detail ${label}` : `Kembali ke ${label}`);
}

function pageSnapshot() {
  return {
    page: state.page,
    island: state.island,
    station: state.station,
    tab: { ...state.tab },
    scrollTop: ($('#page') && $('#page').scrollTop) || 0,
  };
}

function jumpTo(page, opts = {}) {
  closeDetail(true);
  state.origin = pageSnapshot();
  state.page = page;
  if (opts.station !== undefined) state.station = opts.station;
  if (opts.island !== undefined) state.island = opts.island;
  closeFilters();
  closeMore();
  render();
  history.pushState({ napas: 'origin' }, '', location.href);
  renderBackChip();
}

function returnToOrigin() {
  const origin = state.origin;
  state.origin = null;
  closeDetail(true);
  if (!origin) {
    state.page = 'ringkasan';
    state.station = null;
    render();
    renderBackChip();
    return;
  }
  state.page = origin.page;
  state.island = origin.island;
  state.station = origin.station;
  state.tab = { ...origin.tab };
  state.pendingScroll = origin.scrollTop;
  render();
  renderBackChip();
}

function openDetail(spec) {
  const panel = $('#detail');
  if (!panel) return;
  state.detail = spec;
  $('#detail-kicker').textContent = spec.kicker;
  $('#detail-title').textContent = spec.title;
  $('#detail-body').innerHTML = spec.body;
  panel.classList.toggle('is-wide', !!spec.wide);
  panel.classList.remove('closing');
  panel.hidden = false;
  $('#detail-scrim').hidden = false;
  document.body.classList.add('detail-open');
  renderBackChip();
  history.pushState({ napas: 'detail', key: spec.key }, '', location.href);
  requestAnimationFrame(() => {
    const btn = $('#detail-close');
    if (btn) btn.focus({ preventScroll: true });
    if (spec.after) spec.after($('#detail-body'));
  });
}

function closeDetail(fromHistory) {
  const panel = $('#detail');
  if (!panel || panel.hidden) return;
  state.detail = null;
  $('#detail-scrim').hidden = true;
  document.body.classList.remove('detail-open');
  renderBackChip();
  const done = () => {
    panel.hidden = true;
    panel.classList.remove('closing');
    $('#detail-body').innerHTML = '';
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else {
    panel.classList.add('closing');
    setTimeout(done, 190);
  }
}

function dismissDetail() {
  if (history.state && history.state.napas === 'detail') history.back();
  else closeDetail(true);
}

function openStationProfile(id) {
  const st = DATA.stationsById.get(id);
  if (!st) return;
  const island = state.island !== 'Semua' && st.island !== state.island ? 'Semua' : state.island;
  jumpTo('wilayah', { station: id, island });
}

function detailMetrics(rows) {
  return `<div class="metric-grid">${rows.map(([k, v, u]) => `<div class="metric"><div class="metric-label">${esc(k)}</div><div class="metric-value">${v}${u ? ` <small>${esc(u)}</small>` : ''}</div></div>`).join('')}</div>`;
}

function detailStack(pct, total) {
  const parts = CAT_ORDER.filter((c) => (pct[c] || 0) > 0);
  const bar = parts.map((c) => `<span style="width:${pct[c]}%;background:${CAT_COLORS[c]}" data-tip="${esc(c)} · ${fmt(pct[c], 1)}%"></span>`).join('');
  const legend = parts.map((c) => `<div class="dleg-row"><span class="sw" style="background:${CAT_COLORS[c]}"></span><span>${esc(c)}</span><b>${fmt(pct[c], 1)}%</b></div>`).join('');
  return `<div class="dstack" role="img" aria-label="Komposisi ISPU">${bar}</div><div class="dlegend">${legend}</div>${total ? `<div class="detail-note">${fmtInt(total)} hari-stasiun</div>` : ''}`;
}

function detailBars(rows, opts = {}) {
  const max = Math.max(...rows.map((r) => r.value || 0), 1);
  return `<div class="dlist">${rows.map((r) => `<button class="drow" type="button" ${r.id ? `data-station="${esc(r.id)}"` : ''} ${r.disabled ? 'disabled' : ''}>
    <span class="drow-label">${esc(r.label)}</span>
    <span class="drow-track"><span style="width:${Math.max(2, (r.value || 0) / max * 100)}%;background:${r.color || C.navy}"></span></span>
    <span class="drow-value">${r.display || fmt(r.value, 1)}${opts.unit ? ` <small>${esc(opts.unit)}</small>` : ''}</span>
  </button>`).join('')}</div>`;
}

function detailIspuYear(year) {
  const all = DATA.overview.ispu_year_pct || {};
  const key = String(year);
  const pct = all[key];
  if (!pct) return null;
  const prevKey = String(Number(year) - 1);
  const prev = all[prevKey] || null;
  const rows = CAT_ORDER.map((c) => {
    const v = pct[c] || 0;
    const d = prev ? v - (prev[c] || 0) : null;
    return {
      label: c,
      value: v,
      color: CAT_COLORS[c],
      display: `${fmt(v, 1)}%${d == null ? '' : ` <small>${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 1)}</small>`}`,
    };
  });
  const body = `
    <div class="detail-block"><div class="detail-label">Komposisi ${esc(key)}</div>${detailStack(pct)}</div>
    <div class="detail-block"><div class="detail-label">Per kategori · % hari-stasiun</div>${detailBars(rows)}</div>
    ${prev ? `<div class="detail-note">Angka kecil = selisih terhadap ${esc(prevKey)} dalam poin persentase</div>` : ''}`;
  return {
    key: `ispu-year:${key}`,
    kicker: 'Komposisi ISPU · semua stasiun',
    title: key,
    chip: key,
    body,
  };
}

function detailMonth(month, island) {
  const source = island ? DATA.time.island_monthly.filter((r) => r.island === island) : DATA.overview.monthly;
  const row = source.find((r) => r.month === month);
  if (!row) return null;
  const [y, mo] = String(month).split('-').map(Number);
  const prevKey = `${y - 1}-${String(mo).padStart(2, '0')}`;
  const prev = source.find((r) => r.month === prevKey);
  const delta = prev && prev.pm25 != null ? row.pm25 - prev.pm25 : null;
  const ispu = island
    ? (DATA.overview.ispu_month_island || []).find((r) => r.month === month && r.island === island)
    : (DATA.overview.ispu_month_national || {})[month];
  const islandRows = DATA.time.island_monthly.filter((r) => r.month === month).sort((a, b) => b.pm25 - a.pm25);
  const eps = DATA.time.episode_monthly_island.filter((r) => r.month === month && (!island || r.island === island));
  const episode = eps.reduce((a, r) => a + (r.episode || 0), 0);
  const body = `
    ${detailMetrics([
      ['PM2.5 rata-rata', `${fmt(row.pm25, 1)}`, 'µg/m³'],
      ['Vs tahun lalu', delta == null ? '—' : `${delta >= 0 ? '+' : ''}${fmt(delta, 1)}`, 'µg/m³'],
      ['Stasiun · hari', `${row.stations} · ${fmtInt(row.days)}`, ''],
    ])}
    <div class="detail-block"><div class="detail-label">Komposisi ISPU</div>${ispu ? detailStack(ispu.pct, ispu.days) : '<div class="detail-note">Tidak tersedia</div>'}</div>
    <div class="detail-block"><div class="detail-label">Per pulau · µg/m³</div>${detailBars(islandRows.map((r) => ({ label: r.island, value: r.pm25, color: CAT_COLORS[categoryFromPm(r.pm25)] || C.navy })))}</div>
    <div class="detail-list">
      <div class="row"><span>Hari >55 µg/m³</span><b>${fmtInt(episode)}</b></div>
      <div class="row"><span>Bulan sebelumnya</span><b>${(() => { const d = new Date(Date.UTC(y, mo - 2, 1)); const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; const p = source.find((r) => r.month === k); return p ? `${fmt(p.pm25, 1)} µg/m³` : '—'; })()}</b></div>
    </div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="waktu">Buka di Waktu</button>`;
  return {
    key: `month:${island || 'nasional'}:${month}`,
    kicker: `Tren ${island || 'nasional'} · bulanan`,
    title: monthFull(month),
    chip: `${island ? `${island} · ` : ''}${monthFull(month)}`,
    body,
    after: (root) => {
      const cta = root.querySelector('[data-detail-go]');
      if (cta) cta.addEventListener('click', () => jumpTo('waktu'));
    },
  };
}

function detailIslandCategory(island, cat) {
  const rows = DATA.stations.stations
    .filter((s) => s.island === island)
    .map((s) => ({ ...s, pct: ((DATA.overview.ispu_station_pct[s.id] || {})[cat] || 0) }))
    .sort((a, b) => b.pct - a.pct);
  const withData = rows.filter((r) => r.pct > 0);
  const mean = withData.length ? withData.reduce((a, r) => a + r.pct, 0) / withData.length : null;
  const body = `
    ${detailMetrics([
      ['Kategori', esc(cat), ''],
      ['Stasiun terdampak', `${withData.length}/${rows.length}`, ''],
      ['Rata-rata porsi', mean == null ? '—' : fmt(mean, 1), '%'],
    ])}
    <div class="detail-block"><div class="detail-label">Porsi hari per stasiun</div>
      ${detailBars(rows.map((r) => ({ label: r.id, value: r.pct, id: r.id, color: CAT_COLORS[cat] || C.navy, display: `${fmt(r.pct, 1)}%` })))}
    </div>
    <div class="detail-note">Klik stasiun untuk membuka profil · ${esc(DATA.view.label)}</div>`;
  return {
    key: `islandcat:${island}:${cat}`,
    kicker: `Komposisi ISPU · ${island}`,
    title: cat,
    chip: `${island} · ${cat}`,
    body,
  };
}

function detailIsland(name) {
  const isl = DATA.overview.island26.find((r) => r.island === name);
  if (!isl) return null;
  const stations = DATA.stations.stations
    .filter((s) => s.island === name && s.mean_2026 != null)
    .sort((a, b) => b.mean_2026 - a.mean_2026);
  const months = DATA.time.island_monthly.filter((r) => r.island === name).slice(-10);
  const eps = DATA.time.episode_monthly_island.filter((r) => r.island === name);
  const episode = eps.reduce((a, r) => a + (r.episode || 0), 0);
  const pct = DATA.overview.ispu_haze26_pct[name] || {};
  const body = `
    ${detailMetrics([
      ['PM2.5 rata-rata', fmt(isl.mean, 1), 'µg/m³'],
      ['Maksimum', fmt(isl.max, 1), 'µg/m³'],
      ['Stasiun · hari', `${isl.stations} · ${fmtInt(isl.days)}`, ''],
    ])}
    <div class="detail-block"><div class="detail-label">Komposisi ISPU</div>${detailStack(pct, isl.days)}</div>
    <div class="detail-block"><div class="detail-label">Tren bulanan · µg/m³</div>${detailBars(months.map((r) => ({ label: monthLabel(r.month), value: r.pm25, color: CAT_COLORS[categoryFromPm(r.pm25)] || C.navy })))}</div>
    <div class="detail-block"><div class="detail-label">Stasiun terberat</div>${detailBars(stations.slice(0, 6).map((s) => ({ label: s.id, value: s.mean_2026, id: s.id, color: CAT_COLORS[categoryFromPm(s.mean_2026)] || C.navy })))}</div>
    <div class="detail-list"><div class="row"><span>Hari >55 µg/m³ · seluruh periode</span><b>${fmtInt(episode)}</b></div></div>`;
  return {
    key: `island:${name}`,
    kicker: `Ranking pulau · ${DATA.view.label}`,
    title: name,
    chip: name,
    body,
  };
}

/* --------------------------------------------------------------- detail: waktu */
function timeScopeRows() {
  if (state.station) return DATA.time.station_daily[state.station] || [];
  return state.island === 'Semua' ? DATA.time.daily : (DATA.time.daily_island[state.island] || []);
}

function detailDay(dateStr) {
  const rows = timeScopeRows();
  const row = rows.find((r) => r[0] === dateStr);
  if (!row) return null;
  const value = row[1];
  const n = row[2] || 0;
  const monthKey = dateStr.slice(0, 7);
  const monthRows = rows.filter((r) => r[0].slice(0, 7) === monthKey && r[1] != null);
  const mean = monthRows.length ? monthRows.reduce((a, r) => a + r[1], 0) / monthRows.length : null;
  const sorted = monthRows.slice().sort((a, b) => b[1] - a[1]);
  const rank = sorted.findIndex((r) => r[0] === dateStr) + 1;
  const worst = sorted[0];
  const body = `
    ${detailMetrics([
      ['PM2.5', fmt(value, 1), 'µg/m³'],
      ['Kategori ISPU', esc(categoryFromPm(value)), ''],
      ['Stasiun', fmtInt(n), ''],
    ])}
    <div class="detail-block"><div class="detail-label">Bulan ini</div>
      ${detailBars([
        { label: 'Hari ini', value, color: CAT_COLORS[categoryFromPm(value)] || C.navy },
        { label: 'Rata-rata', value: mean, color: C.muted },
        { label: 'Tertinggi', value: worst ? worst[1] : null, color: C.terra },
      ])}
    </div>
    <div class="detail-list">
      <div class="row"><span>Peringkat hari</span><b>${rank || '—'}/${monthRows.length || '—'}</b></div>
      <div class="row"><span>Selisih vs rata-rata</span><b>${mean == null ? '—' : `${value - mean >= 0 ? '+' : ''}${fmt(value - mean, 1)} µg/m³`}</b></div>
    </div>`;
  return {
    key: `day:${scopeLabel()}:${dateStr}`,
    kicker: `Kalender harian · ${scopeLabel()}`,
    title: `${dateStr.slice(8, 10)} ${monthFull(monthKey)}`,
    chip: `${dateStr.slice(8, 10)} ${monthFull(monthKey)}`,
    body,
  };
}

function detailHourDow(hour, dow) {
  const rows = state.station ? (DATA.time.hour_dow_by_station[state.station] || []) : (state.island === 'Semua' ? (DATA.time.hour_dow_all || []) : (DATA.time.hour_dow_by_island[state.island] || []));
  const dows = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  const row = rows.find((r) => r.hour === hour && r.dow === dow);
  if (!row) return null;
  const sameHour = rows.filter((r) => r.hour === hour).sort((a, b) => b.pm25 - a.pm25);
  const dayRows = rows.filter((r) => r.dow === dow).sort((a, b) => b.pm25 - a.pm25);
  const body = `
    ${detailMetrics([
      ['PM2.5', fmt(row.pm25, 1), 'µg/m³'],
      ['Observasi', fmtInt(row.n), ''],
      ['Kategori', esc(categoryFromPm(row.pm25)), ''],
    ])}
    <div class="detail-block"><div class="detail-label">Jam ini · per hari</div>
      ${detailBars(sameHour.map((r) => ({ label: dows[r.dow].slice(0, 3), value: r.pm25, color: r.dow === dow ? (CAT_COLORS[categoryFromPm(r.pm25)] || C.navy) : C.grey2 })))}
    </div>
    <div class="detail-block"><div class="detail-label">Hari ini · per jam</div>
      ${detailBars(dayRows.slice(0, 8).map((r) => ({ label: `${String(r.hour).padStart(2, '0')}:00`, value: r.pm25, color: CAT_COLORS[categoryFromPm(r.pm25)] || C.navy })))}
    </div>`;
  return {
    key: `hourdow:${scopeLabel()}:${hour}:${dow}`,
    kicker: `Jam × hari · ${scopeLabel()}`,
    title: `${String(hour).padStart(2, '0')}:00 · ${dows[dow]}`,
    chip: `${String(hour).padStart(2, '0')}:00 ${dows[dow].slice(0, 3)}`,
    body,
  };
}


function detailEpisodeMonth(month) {
  const rows = (DATA.time.episode_monthly_island || []).filter((r) => r.month === month);
  if (!rows.length) return null;
  const total = rows.reduce((a, r) => a + (r.episode || 0), 0);
  const days = rows.reduce((a, r) => a + (r.days || 0), 0);
  const sorted = rows.slice().sort((a, b) => b.episode - a.episode);
  const body = `
    ${detailMetrics([
      ['Episode', fmtInt(total), 'hari-stasiun'],
      ['Hari-stasiun', fmtInt(days), ''],
      ['Porsi', days ? fmt(total / days * 100, 1) : '—', '%'],
    ])}
    <div class="detail-block"><div class="detail-label">Episode per pulau</div>
      ${detailBars(sorted.map((r) => ({ label: r.island, value: r.episode, color: ISLAND_COLORS[r.island] || C.navy, display: fmtInt(r.episode) })))}
    </div>
    <div class="detail-note">Episode = hari-stasiun dengan PM2.5 > 55 µg/m³</div>`;
  return {
    key: `episode:${month}`,
    kicker: 'Episode per bulan',
    title: monthFull(month),
    chip: monthFull(month),
    body,
  };
}

function detailMonthScope(month) {
  if (!state.station) return detailMonth(month, state.island === 'Semua' ? null : state.island);
  const rows = DATA.time.station_monthly[state.station] || [];
  const row = rows.find((r) => r.month === month);
  if (!row) return null;
  const [y, mo] = String(month).split('-').map(Number);
  const prev = rows.find((r) => r.month === `${y - 1}-${String(mo).padStart(2, '0')}`);
  const delta = prev ? row.pm25 - prev.pm25 : null;
  const ranked = rows.filter((r) => r.pm25 != null).slice().sort((a, b) => b.pm25 - a.pm25);
  const rank = ranked.findIndex((r) => r.month === month) + 1;
  const body = `
    ${detailMetrics([
      ['PM2.5', fmt(row.pm25, 1), 'µg/m³'],
      ['Vs tahun lalu', delta == null ? '—' : `${delta >= 0 ? '+' : ''}${fmt(delta, 1)}`, 'µg/m³'],
      ['Hari layak', fmtInt(row.days), ''],
    ])}
    <div class="detail-block"><div class="detail-label">Peringkat bulan</div>${detailBars(ranked.slice(0, 6).map((r) => ({ label: monthLabel(r.month), value: r.pm25, color: r.month === month ? (CAT_COLORS[categoryFromPm(r.pm25)] || C.navy) : C.grey2 })))}</div>
    <div class="detail-list"><div class="row"><span>Peringkat</span><b>${rank || '—'}/${ranked.length}</b></div></div>
    <button class="primary-btn detail-cta" type="button" data-station="${esc(state.station)}">Buka profil stasiun</button>`;
  return {
    key: `stmonth:${state.station}:${month}`,
    kicker: `Bulanan · ${state.station}`,
    title: monthFull(month),
    chip: monthFull(month),
    body,
  };
}

function detailDayNearest(ts) {
  const rows = timeScopeRows();
  if (!rows.length) return null;
  const target = new Date(ts).getTime();
  let best = rows[0];
  let bd = Infinity;
  rows.forEach((r) => {
    const d = Math.abs(new Date(r[0] + 'T00:00:00').getTime() - target);
    if (d < bd) { bd = d; best = r; }
  });
  return detailDay(best[0]);
}

/* ------------------------------------------------------- detail: wilayah/sumber */
function bindRowActivate(selector, attr, make) {
  $$(selector).forEach((tr) => {
    const run = () => {
      const spec = make(tr.getAttribute(attr));
      if (spec) openDetail(spec);
    };
    tr.addEventListener('click', run);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
    });
  });
}

function stationTip(s) {
  const cat = s.day_category || '—';
  const day = s.day_value == null ? '—' : fmt(s.day_value, 1);
  return `<div class="map-tip-h"><span class="dot" style="background:${catColor(cat)}"></span><b>${esc(s.id)}</b><span class="cat">${esc(cat)}</span></div>`
    + `<div class="map-tip-n">${day}<small> µg/m³</small><small class="sep"> · ${esc(shortDate(state.date))}</small></div>`
    + `<div class="map-tip-s">${esc(s.city)} · rata-rata ${fmt(s.mean_2026, 1)}</div>`;
}

function detailStation(id, opts = {}) {
  const st = DATA.stationsById.get(id);
  if (!st) return null;
  const toWilayah = opts.cta === 'wilayah';
  const comp = DATA.overview.ispu_station_pct[id] || {};
  const months = (DATA.time.station_monthly[id] || []).slice(-12);
  const rank = topRowsFull().findIndex((r) => r.id === id) + 1;
  const body = `
    ${detailMetrics([
      ['Pada acuan', st.day_value == null ? '—' : fmt(st.day_value, 1), 'µg/m³'],
      ['Rata-rata', `${st.lower_bound ? '≥' : ''}${fmt(st.mean_2026, 1)}`, 'µg/m³'],
      ['P95', fmt(st.p95_2026, 1), 'µg/m³'],
      ['Maksimum', fmt(st.max_2026, 1), 'µg/m³'],
    ])}
    <div class="detail-block"><div class="detail-label">Komposisi ISPU · ${esc(DATA.view.label)}</div>${detailStack(comp, st.days_2026)}</div>
    <div class="detail-block"><div class="detail-label">12 bulan terakhir</div>${detailBars(months.map((r) => ({ label: monthLabel(r.month), value: r.pm25, color: CAT_COLORS[categoryFromPm(r.pm25)] || C.navy })))}</div>
    <div class="detail-list">
      <div class="row"><span>Kota · provinsi</span><b>${esc(st.city)} · ${esc(st.province)}</b></div>
      <div class="row"><span>Tanggal acuan</span><b>${esc(shortDate(state.date))} · ${esc(st.day_category)}</b></div>
      <div class="row"><span>Peringkat nasional</span><b>${rank || '—'}/${topRowsFull().length}</b></div>
      <div class="row"><span>Hari layak</span><b>${fmtInt(st.days_2026)} hari</b></div>
    </div>
    <button class="primary-btn detail-cta" type="button" ${toWilayah ? `data-station-go="${esc(id)}"` : `data-station-profile="${esc(id)}"`}>Buka profil stasiun</button>`;
  return {
    key: `station:${id}`,
    kicker: `Stasiun · ${st.island}`,
    title: id,
    chip: id,
    body,
    after: (root) => {
      const go = root.querySelector('[data-station-go]');
      if (go) go.addEventListener('click', () => {
        closeDetail(true);
        openStationProfile(id);
      });
      const btn = root.querySelector('[data-station-profile]');
      if (btn) btn.addEventListener('click', () => {
        closeDetail(true);
        state.station = id;
        render();
      });
    },
  };
}

function detailPollutantPair(a, b) {
  const p = DATA.sources.pollutant_matrix;
  const i = p.labels.indexOf(a);
  const j = p.labels.indexOf(b);
  const r = p.matrix[i] && p.matrix[i][j];
  const row = (p.matrix[i] || []).map((v, k) => ({ label: p.labels[k], value: v == null ? 0 : Math.abs(v), display: v == null ? '—' : fmtR(v), color: v != null && v < 0 ? C.terra : C.navy }));
  const body = `
    ${detailMetrics([
      ['Korelasi r', fmtR(r), ''],
      ['Kekuatan', Math.abs(r) >= 0.7 ? 'Kuat' : Math.abs(r) >= 0.4 ? 'Sedang' : 'Lemah', ''],
      ['Observasi', fmtInt(p.n), 'jam'],
    ])}
    <div class="detail-block"><div class="detail-label">${esc(a)} vs polutan lain · |r|</div>${detailBars(row)}</div>
    <div class="detail-note">Korelasi antar polutan · r negatif berwarna jingga</div>`;
  return {
    key: `pair:${a}:${b}`,
    kicker: 'Matriks korelasi polutan',
    title: `${a} vs ${b}`,
    chip: `${a}·${b}`,
    body,
  };
}

const WIND_DIRS = ['U', 'UTL', 'TL', 'TTL', 'T', 'TTR', 'TGR', 'TS', 'S', 'SB', 'STB', 'ST', 'B', 'BB', 'BBL', 'BS'];
const WIND_SPEEDS = ['0–0,5', '0,5–1,5', '1,5–3,3', '3,3–5,5', '>5,5'];
const WIND_COLORS = ['#FFF3BF', '#E3A008', '#D9663F', '#B3261E', '#182048'];

function detailWindSector(dir) {
  const id = windStationId();
  const w = id ? DATA.sources.windrose[id] : null;
  if (!w) return null;
  const di = WIND_DIRS.indexOf(dir);
  if (di < 0) return null;
  const counts = w.matrix[di] || [];
  const total = counts.reduce((a, b) => a + b, 0);
  const grand = w.matrix.flat().reduce((a, b) => a + b, 0);
  const share = grand ? total / grand * 100 : null;
  const top = counts.reduce((best, v, k) => (v > counts[best] ? k : best), 0);
  const body = `
    ${detailMetrics([
      ['Frekuensi', share == null ? '—' : fmt(share, 1), '%'],
      ['Observasi', fmtInt(total), 'jam'],
      ['Kelas dominan', WIND_SPEEDS[top] || '—', 'm/s'],
    ])}
    <div class="detail-block"><div class="detail-label">Distribusi kecepatan · jam</div>
      ${detailBars(counts.map((v, k) => ({ label: WIND_SPEEDS[k], value: v, color: WIND_COLORS[k], display: fmtInt(v) })))}
    </div>
    <div class="detail-note">Stasiun angin ${esc(id)} · 16 arah mata angin</div>`;
  return {
    key: `wind:${id}:${dir}`,
    kicker: `Wind rose · ${id}`,
    title: `Angin dari ${dir}`,
    chip: `Angin ${dir}`,
    body,
  };
}

function detailSourceStation(id) {
  const row = sourceRows().find((r) => r.station === id);
  if (!row) return null;
  const body = `
    ${detailMetrics([
      ['PM2.5', fmt(row.pm25, 1), 'µg/m³'],
      ['Baseline', fmt(row.baseline, 1), 'µg/m³'],
      ['Jarak jalan', fmt(row.distance, 0), 'm'],
      ['Lalu lintas', fmtInt(row.traffic), 'kend/jam'],
    ])}
    <div class="detail-list">
      <div class="row"><span>Hari episode</span><b>${fmtInt(row.episode_days)} hari</b></div>
      <div class="row"><span>Hari layak</span><b>${fmtInt(row.days)} hari</b></div>
      <div class="row"><span>Status</span><b>${esc(row.status)}</b></div>
    </div>
    <button class="primary-btn detail-cta" type="button" data-station="${esc(id)}">Buka profil stasiun</button>`;
  return {
    key: `srcstation:${id}`,
    kicker: `Sumber · ${row.island}`,
    title: id,
    chip: id,
    body,
  };
}

/* ------------------------------------------------------- detail: kesehatan */
function detailOutcome(key) {
  const o = (DATA.health.outcomes || []).find((x) => x.key === key);
  if (!o) return null;
  const years = healthYears();
  const cur = years[years.length - 1];
  const span = healthSpan();
  if (!cur || !span) return null;
  const a = span.actual[key] || 0;
  const totalResp = span.actual.resp || 0;
  const scope = state.island === 'Semua' ? 'nasional' : state.island;
  const body = `
    ${detailMetrics([
      ['Kunjungan', fmtInt(a), 'kasus'],
      ['Hari', fmtInt(span.days), 'hari'],
      ['Porsi respirasi', totalResp ? `${fmt(a / totalResp * 100, 1)}%` : '—', ''],
    ])}
    <div class="detail-block"><div class="detail-label">Kunjungan per tahun · rentang sama</div>
      ${detailBars(years.map((r) => ({ label: String(r.year), value: r.actual[key] || 0, color: r.year === cur.year ? C.navy : C.grey2, display: fmtInt(r.actual[key] || 0) })))}
    </div>
    <div class="detail-list">
      <div class="row"><span>Rentang</span><b>${esc(DATA.view.label)}</b></div>
      <div class="row"><span>Hari tercatat</span><b>${span.days} hari</b></div>
      <div class="row"><span>Rumah sakit</span><b>${healthHospitalIds().length}</b></div>
    </div>
    <div class="detail-note">Kunjungan yang tercatat di rumah sakit mitra, bukan kasus yang diatribusikan ke PM2.5.</div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="kesehatan">Buka Kesehatan</button>`;
  return {
    key: `outcome:${key}`,
    kicker: `Kunjungan aktual · ${scope} · ${DATA.view.label}`,
    title: o.label,
    chip: o.label,
    body,
    after: (root) => {
      const cta = root.querySelector('[data-detail-go]');
      if (cta) cta.addEventListener('click', () => jumpTo('kesehatan'));
    },
  };
}

function detailHealthYear(year) {
  const r = (DATA.health.years || []).find((x) => x.year === year);
  if (!r) return null;
  const isl = (DATA.health.byIsland || {});
  const islRows = Object.keys(isl).map((name) => {
    const row = (isl[name] || []).find((x) => x.year === year);
    return { label: name, value: row ? row.actual.resp : 0, color: ISLAND_COLORS[name] || C.navy, display: row ? fmtInt(row.actual.resp) : '—' };
  }).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const body = `
    ${detailMetrics([
      ['Hari', fmtInt(r.days), 'hari'],
      ['Respirasi', fmtInt(r.actual.resp), 'kasus'],
      ['Kematian', fmtInt(r.actual.death), 'kasus'],
    ])}
    <div class="detail-block"><div class="detail-label">Kunjungan respirasi per pulau</div>${detailBars(islRows)}</div>
    <div class="detail-list">
      <div class="row"><span>Balita</span><b>${fmtInt(r.actual.resp_admissions_under5)}</b></div>
      <div class="row"><span>Lansia 60+</span><b>${fmtInt(r.actual.resp_admissions_over60)}</b></div>
      <div class="row"><span>Rentang</span><b>${esc(DATA.view.label)}</b></div>
    </div>`;
  return {
    key: `healthyear:${year}`,
    kicker: 'Kunjungan aktual per tahun',
    title: String(year),
    chip: String(year),
    body,
  };
}

function detailLag(n) {
  const lag = healthLag();
  const row = lag[String(n)];
  if (!row) return null;
  const labels = Object.fromEntries((DATA.health.outcomes || []).map((o) => [o.key, o.label]));
  const bars = Object.keys(row).map((k) => ({ label: labels[k] || k, value: row[k], color: row[k] >= 0.35 ? C.navy : C.grey2, display: fmtR(row[k]) })).sort((a, b) => b.value - a.value);
  const best = bars[0];
  const body = `
    ${detailMetrics([
      ['Lag', String(n), 'hari'],
      ['r tertinggi', best ? best.label : '—', ''],
      ['Nilai r', best ? best.display : '—', ''],
    ])}
    <div class="detail-block"><div class="detail-label">r anomali per outcome</div>${detailBars(bars)}</div>
    <div class="detail-note">Korelasi anomali PM2.5 dan kunjungan pada lag ${n} hari</div>`;
  return {
    key: `lag:${n}:${state.island}`,
    kicker: `Lag ${n} hari · ${state.island === 'Semua' ? 'nasional' : state.island}`,
    title: `Lag ${n}`,
    chip: `Lag ${n}`,
    body,
  };
}

function detailHealthMonth(month) {
  const rows = state.island === 'Semua' ? DATA.health.monthly : (DATA.health.monthly_island || []).filter((r) => r.island === state.island);
  const row = rows.find((r) => r.month === month);
  if (!row) return null;
  const pm = (DATA.time.monthly || []).find((r) => r.month === month);
  const sorted = rows.slice().sort((a, b) => b.resp - a.resp);
  const rank = sorted.findIndex((r) => r.month === month) + 1;
  const body = `
    ${detailMetrics([
      ['Kunjungan/hari', fmt(row.resp, 1), 'kasus'],
      ['Balita', fmt(row.under5, 1), 'kasus'],
      ['Lansia', fmt(row.over60, 1), 'kasus'],
    ])}
    <div class="detail-block"><div class="detail-label">12 bulan tertinggi</div>
      ${detailBars(sorted.slice(0, 8).map((r) => ({ label: monthLabel(r.month), value: r.resp, color: r.month === month ? C.navy : C.grey2 })))}
    </div>
    <div class="detail-list">
      <div class="row"><span>PM2.5 nasional</span><b>${pm && pm.pm25 != null ? `${fmt(pm.pm25, 1)} µg/m³` : '—'}</b></div>
      <div class="row"><span>Peringkat bulan</span><b>${rank || '—'}/${rows.length}</b></div>
      <div class="row"><span>Total kunjungan</span><b>${fmtInt(row.resp_total)}</b></div>
    </div>`;
  return {
    key: `healthmonth:${month}:${state.island}`,
    kicker: `Bulanan · ${state.island === 'Semua' ? 'nasional' : state.island}`,
    title: monthFull(month),
    chip: monthFull(month),
    body,
  };
}

function detailHealthStation(id) {
  const r = (DATA.health.stations || []).find((s) => s.station === id);
  if (!r) return null;
  const labels = Object.fromEntries((DATA.health.outcomes || []).map((o) => [o.key, o.label]));
  const bars = Object.keys(r.lag0 || {}).map((k) => ({ label: labels[k] || k, value: r.lag0[k], color: r.lag0[k] >= 0.5 ? C.navy : C.grey2, display: fmtR(r.lag0[k]) })).sort((a, b) => b.value - a.value);
  const body = `
    ${detailMetrics([
      ['r lag 0', fmtR(r.lag0_resp), ''],
      ['Kunjungan', fmtInt(r.resp_actual), 'kasus'],
      ['Balita', fmtInt(r.resp_under5_actual), 'kasus'],
    ])}
    <div class="detail-block"><div class="detail-label">r lag 0 per outcome</div>${detailBars(bars)}</div>
    <div class="detail-list">
      <div class="row"><span>Lansia 60+</span><b>${fmtInt(r.resp_over60_actual)} kasus</b></div>
      <div class="row"><span>Hari episode &gt;55</span><b>${fmtInt(r.episode_days)} hari</b></div>
      <div class="row"><span>Hari layak</span><b>${fmt(r.usable_pct, 1)}%</b></div>
      <div class="row"><span>Status</span><b>${esc(r.status)}</b></div>
      <div class="row"><span>Rentang</span><b>${esc(DATA.view.label)}</b></div>
    </div>
    <button class="primary-btn detail-cta" type="button" data-station="${esc(id)}">Buka profil stasiun</button>`;
  return {
    key: `healthstation:${id}`,
    kicker: `Kesehatan · ${r.island}`,
    title: id,
    chip: id,
    body,
  };
}

/* ---------------------------------------------------------- detail: jaringan */
function provToggleHtml() {
  const mk = (key, label) => `<button type="button" data-provmetric="${key}" class="${state.provMetric === key ? 'active' : ''}" aria-pressed="${state.provMetric === key}">${label}</button>`;
  return `<div class="seg" role="group" aria-label="Metrik peta provinsi">${mk('actual', 'Kunjungan')}${mk('per100', 'per 100 tempat tidur')}</div>`;
}

function per100Unit() {
  const days = (DATA.hospitals.meta && DATA.hospitals.meta.days) || '';
  return `kunjungan per 100 tempat tidur · ${days} hari`;
}

function hospitalRows() {
  const rows = DATA.hospitals.hospitals || [];
  if (state.island === 'Semua') return rows;
  return rows.filter((h) => h.island === state.island);
}

function detailHospital(id) {
  const h = DATA.hospitalsById.get(id);
  if (!h) return null;
  const labels = Object.fromEntries((DATA.hospitals.outcomes || []).map((o) => [o.key, o.label]));
  const outcomes = (DATA.hospitals.outcomes || []).map((o) => ({ key: o.key, label: labels[o.key], value: (h.actual || {})[o.key] || 0, color: o.key === 'resp' ? C.navy : C.grey2, display: fmtInt((h.actual || {})[o.key] || 0) }));
  const months = (h.monthly || []).slice(-13);
  const max = Math.max(...months.map((m) => m.v || 0), 1);
  const spark = months.map((m) => `<span class="hspark-bar${m.partial ? ' partial' : ''}" style="height:${Math.max(3, (m.v / max) * 100)}%" data-tip="${esc(monthFull(m.m))} · ${fmtInt(m.v)} kunjungan"></span>`).join('');
  const body = `
    ${detailMetrics([
      ['Kunjungan', fmtInt(h.actual.resp), 'kasus'],
      ['Kunjungan per 100 TT', fmt(h.per100beds, 0), 'kasus'],
      ['Hari', fmtInt(h.days), 'hari'],
    ])}
    <div class="detail-list">
      <div class="row"><span>Tempat tidur</span><b>${fmtInt(h.beds)}</b></div>
      <div class="row"><span>Kelas</span><b>${esc(h.kelas)}</b></div>
      <div class="row"><span>Kota</span><b>${esc(h.city)} · ${esc(h.kecamatan)}</b></div>
      <div class="row"><span>Provinsi</span><b>${esc(h.province)}</b></div>
      <div class="row"><span>Stasiun</span><b class="mono">${esc(h.station || '—')}</b></div>
      <div class="row"><span>Rentang</span><b>${esc(DATA.view.label)}</b></div>
    </div>
    <div class="detail-block"><div class="detail-label">Kunjungan respirasi bulanan</div><div class="hspark">${spark}</div><div class="detail-note">${months.length} bulan terakhir · batang pucat = bulan parsial</div></div>
    <div class="detail-block"><div class="detail-label">Kunjungan per outcome · ${h.days} hari</div>${detailBars(outcomes)}</div>
    <div class="detail-note">Kasus = kunjungan tercatat, bukan kasus yang diatribusikan ke PM2.5.</div>
    <button class="primary-btn detail-cta" type="button" data-station="${esc(h.station || '')}">Buka profil stasiun</button>`;
  return {
    key: `hospital:${h.id}`,
    kicker: `${h.kelas} · ${h.island}`,
    title: h.name,
    chip: h.city,
    body,
  };
}

function detailProvince(name) {
  const p = DATA.provincesByName.get(name);
  if (!p) return null;
  const list = hospitalRows().filter((h) => h.province === name).slice().sort((a, b) => (b.per100beds || 0) - (a.per100beds || 0));
  const max = Math.max(...list.map((h) => h.per100beds || 0), 1);
  const bars = list.map((h) => `<button class="drow" type="button" data-hospital="${esc(h.id)}">
      <span class="drow-label sans">${esc(h.name)}</span>
      <span class="drow-track"><span style="width:${Math.max(3, (h.per100beds || 0) / max * 100)}%;background:${C.terra}"></span></span>
      <span class="drow-value">${fmt(h.per100beds, 0)}</span>
    </button>`).join('');
  const body = `
    ${detailMetrics([
      ['Kunjungan', fmtInt(p.actual.resp), 'kasus'],
      ['Kunjungan per 100 TT', fmt(p.per100beds, 0), 'kasus'],
      ['Hari', fmtInt(p.days || DATA.hospitals.meta.days), 'hari'],
    ])}
    <div class="detail-list">
      <div class="row"><span>Rumah sakit</span><b>${p.hospitals}</b></div>
      <div class="row"><span>Tempat tidur</span><b>${fmtInt(p.beds)}</b></div>
      <div class="row"><span>Rentang</span><b>${esc(DATA.view.label)}</b></div>
    </div>
    <div class="detail-block"><div class="detail-label">Kasus per 100 tempat tidur · per RS</div><div class="dlist wide">${bars || '<div class="detail-note">Tidak ada RS mitra di provinsi ini.</div>'}</div></div>
    <div class="detail-note">Klik baris untuk membuka rumah sakit. Warna provinsi mengikuti RS mitra, bukan sensus kasus.</div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="kesehatan">Buka Kesehatan</button>`;
  return {
    key: `province:${name}`,
    kicker: `Provinsi · ${p.island || 'Indonesia'}`,
    title: name,
    chip: name,
    body,
    after: (root) => {
      const cta = root.querySelector('[data-detail-go]');
      if (cta) cta.addEventListener('click', () => jumpTo('kesehatan'));
    },
  };
}


function detailQc(segment) {
  const qc = DATA.network.qc_detail || {};
  const totals = DATA.network.qc_totals || {};
  const v = totals[segment];
  if (v == null) return null;
  const grand = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const bars = Object.entries(qc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ label: qcLabel(k), value: n, color: k === segment ? C.navy : C.grey2, display: fmtInt(n) }));
  const body = `
    ${detailMetrics([
      ['Baris', fmtInt(v), 'baris'],
      ['Porsi', fmt(v / grand * 100, 1), '%'],
      ['Segmen', qcLabel(segment), ''],
    ])}
    <div class="detail-block"><div class="detail-label">Rincian pemeriksaan data</div>${detailBars(bars)}</div>
    <div class="detail-note">Total baris tersegmentasi ${fmtInt(grand)}</div>`;
  return {
    key: `qc:${segment}`,
    kicker: 'Pemeriksaan data · 2024–2026',
    title: qcLabel(segment),
    chip: qcLabel(segment),
    body,
  };
}

function detailCompleteness(station, month) {
  const comp = DATA.network.completeness || [];
  const row = comp.find((r) => r.station === station && r.month === month);
  if (!row) return null;
  const stRows = comp.filter((r) => r.station === station && r.pct != null);
  const moRows = comp.filter((r) => r.month === month && r.pct != null);
  const stMean = stRows.length ? stRows.reduce((a, r) => a + r.pct, 0) / stRows.length : null;
  const moMean = moRows.length ? moRows.reduce((a, r) => a + r.pct, 0) / moRows.length : null;
  const body = `
    ${detailMetrics([
      ['Hari layak', fmt(row.pct, 1), '%'],
      ['Hari', `${row.usable_days}/${row.total_days}`, ''],
      ['Vs rata-rata stasiun', stMean == null ? '—' : `${row.pct - stMean >= 0 ? '+' : ''}${fmt(row.pct - stMean, 1)}`, 'pp'],
    ])}
    <div class="detail-block"><div class="detail-label">Kelengkapan 12 bulan · ${esc(station)}</div>
      ${detailBars(stRows.slice(-12).map((r) => ({ label: monthLabel(r.month), value: r.pct, color: r.month === month ? C.navy : C.grey2, display: `${fmt(r.pct, 0)}%` })))}
    </div>
    <div class="detail-list"><div class="row"><span>Rata-rata bulan ini</span><b>${moMean == null ? '—' : `${fmt(moMean, 1)}%`}</b></div></div>`;
  return {
    key: `completeness:${station}:${month}`,
    kicker: 'Matriks kelengkapan',
    title: `${station} · ${monthLabel(month)}`,
    chip: `${station} · ${monthLabel(month)}`,
    body,
  };
}

function detailNetworkStation(id) {
  const s = (DATA.network.stations || []).find((r) => r.station === id);
  if (!s) return null;
  const comp = (DATA.network.completeness || []).filter((r) => r.station === id && r.pct != null).slice(-12);
  const valid = DATA.network.valid_pct_by_station[id];
  const body = `
    ${detailMetrics([
      ['Hari layak', fmt(s.usable_pct, 1), '%'],
      ['Gap data', fmt(s.gap, 1), '%'],
      ['Baris lolos', valid == null ? '—' : fmt(valid, 1), '%'],
    ])}
    <div class="detail-block"><div class="detail-label">Kelengkapan 12 bulan</div>
      ${detailBars(comp.map((r) => ({ label: monthLabel(r.month), value: r.pct, color: r.pct < 80 ? C.terra : r.pct < 95 ? C.yellow : C.teal, display: `${fmt(r.pct, 0)}%` })))}
    </div>
    <div class="detail-list">
      <div class="row"><span>Status</span><b>${esc(s.status)}</b></div>
      <div class="row"><span>Rata-rata</span><b>${fmt(s.mean_2026, 1)} µg/m³</b></div>
      <div class="row"><span>Hari data</span><b>${fmtInt(s.days_2026)} hari</b></div>
    </div>
    <button class="primary-btn detail-cta" type="button" data-station="${esc(id)}">Buka profil stasiun</button>`;
  return {
    key: `netstation:${id}`,
    kicker: `Jaringan · ${s.island}`,
    title: id,
    chip: id,
    body,
  };
}

/* ------------------------------------------------------------------ render */
function disposeAll() {
  charts.forEach((c) => { try { c.dispose(); } catch (_) {} });
  charts = [];
  maps.forEach((m) => {
    try { if (m.__napasTip && m.__napasTip.destroy) m.__napasTip.destroy(); } catch (_) {}
    try { m.remove(); } catch (_) {}
  });
  maps = [];
}

function render() {
  disposeAll();
  $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.page === state.page));
  $$('.mnav-item[data-page]').forEach((a) => {
    const on = a.dataset.page === state.page;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const moreBtn = $('#btn-more');
  if (moreBtn) moreBtn.classList.toggle('active', !['ringkasan', 'waktu', 'wilayah', 'kesehatan'].includes(state.page));
  $$('.more-item[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === state.page));
  syncFilters();
  syncRangeUi();
  $('#foot-hash').textContent = `metrics ${DATA.meta.metrics_sha256.slice(0, 12)}…`;
  const footEnd = $('#foot-end');
  if (footEnd) footEnd.textContent = `Data hingga ${DATA.meta.periods.data_end}`;
  $('#page').innerHTML = renderPage();
  updateUrl();
  requestAnimationFrame(() => {
    if (state.pendingScroll) {
      $('#page').scrollTop = state.pendingScroll;
      state.pendingScroll = 0;
    }
    afterRender();
  });
}

function periodLabel() {
  return rangeLabel();
}

function syncFilters() {
  const islandPages = ['ringkasan', 'waktu', 'wilayah', 'sumber', 'kesehatan', 'jaringan'];
  const stationPages = ['ringkasan', 'waktu', 'wilayah', 'sumber'];
  const isl = $('#filter-island');
  const st = $('#filter-station');
  isl.disabled = !islandPages.includes(state.page);
  st.disabled = !stationPages.includes(state.page);
  isl.title = isl.disabled ? 'Filter pulau tidak dipakai di halaman ini' : '';
  st.title = st.disabled ? 'Filter stasiun tidak dipakai di halaman ini' : '';
  isl.value = state.island;
  st.value = state.station || '';
}

function afterRender() {
  if (state.page === 'ringkasan') afterOverview();
  if (state.page === 'waktu') afterTime();
  if (state.page === 'wilayah') afterGeo();
  if (state.page === 'sumber') afterSource();
  if (state.page === 'kesehatan') afterHealth();
  if (state.page === 'jaringan') afterNetwork();
  if (state.page === 'metodologi') afterMethod();
}

function pageHead(title, meta, actions = '') {
  const back = state.origin
    ? `<button class="ghost-btn back-btn" type="button" data-action="back-origin">← ${esc(PAGE_NAMES[state.origin.page] || 'Kembali')}</button>`
    : '';
  return `<div class="page-head">
    <div><h1 class="page-title">${title}</h1><div class="page-meta">${meta}</div></div>
    <div class="page-actions">${back}${actions}</div>
  </div>`;
}

function card(title, sub, body, opts = {}) {
  const id = opts.id ? ` id="${opts.id}"` : '';
  const cls = opts.cls ? ` ${opts.cls}` : '';
  /* opts.period = keterangan periode; digabung ke sub kalau kartu tidak punya konten kanan. */
  const period = opts.period ? periodText(opts.period) : '';
  const right = opts.right
    ? `${opts.right}${period ? `<div class="card-sub period">${esc(period)}</div>` : ''}`
    : `<div class="card-sub">${[sub, period].filter(Boolean).join(' · ')}</div>`;
  return `<section class="card${cls}"${id}>
    <div class="card-head"><div class="card-title">${title}</div><div class="card-head-right">${right}</div></div>
    <div class="card-body">${body}</div>
  </section>`;
}

function renderPage() {
  switch (state.page) {
    case 'waktu': return renderTime();
    case 'wilayah': return renderGeo();
    case 'sumber': return renderSource();
    case 'kesehatan': return renderHealth();
    case 'jaringan': return renderNetwork();
    case 'metodologi': return renderMethod();
    default: return renderOverview();
  }
}

/* ------------------------------------------------------------------ overview */
function filteredStations() {
  return DATA.stations.stations.filter((s) => state.island === 'Semua' || s.island === state.island);
}

function topRows() {
  const map = new Map(DATA.stations.stations.map((s) => [s.id, s]));
  return DATA.overview.top26
    .map((r) => ({ ...map.get(r.station), ...r, id: r.station }))
    .filter((r) => state.island === 'Semua' || r.island === state.island)
    .filter((r) => r.mean_2026 !== null && r.mean_2026 !== undefined)
    .sort((a, b) => b.mean_2026 - a.mean_2026);
}

function kpiCard(k) {
  const value = k.id === 'resp' ? fmtInt(k.value) : fmt(k.value, 1);
  const est = k.id === 'resp';
  return `<div class="kpi" data-id="${k.id}">
    <div class="kpi-top"><div class="kpi-label">${k.label}</div><span class="info" tabindex="0" data-tip="${esc(k.note)}">i</span></div>
    <div class="kpi-value-row"><span class="kpi-value">${value}</span><span class="kpi-unit">${k.unit}</span></div>
    <div class="kpi-bottom"><span class="kpi-base ${est ? 'est' : ''}">${k.baseline}</span>${k.window ? `<span class="kpi-window">${k.window}</span>` : ''}</div>
  </div>`;
}

function categoryFromPm(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return 'Tanpa data';
  if (v <= 15.5) return 'Baik';
  if (v <= 55.4) return 'Sedang';
  if (v <= 150.4) return 'Tidak Sehat';
  if (v <= 250.4) return 'Sangat Tidak Sehat';
  return 'Berbahaya';
}
function catBadge(cat, share) {
  const c = CAT_COLORS[cat] || '#C3CAD9';
  const label = share == null ? cat : `${cat} · ${fmt(share, 1)}%`;
  return `<span class="cat-badge" style="background:${c}22;border-color:${c};color:${c}"><span class="sw" style="background:${c}"></span>${esc(label)}</span>`;
}
const ISLAND_COLORS = { Sumatera: '#D9663F', Jawa: '#182048', Kalimantan: '#E3A008', Sulawesi: '#0F9D8A', Papua: '#5C8FD6' };
const CAT_ORDER = ['Baik', 'Sedang', 'Tidak Sehat', 'Sangat Tidak Sehat', 'Berbahaya'];
const DIURNAL_COLORS = { 'Clean/Regional': '#0F9D8A', Industrial: '#D9663F', 'Peatland/Forest': '#6B9B2E', 'Traffic/Roadside': '#B3261E', 'Urban Background': '#E3A008' };

function scopeStats() {
  const stats = DATA.overview.stats_window;
  if (state.station && stats.by_station[state.station]) return stats.by_station[state.station];
  if (state.island !== 'Semua') return stats.by_island[state.island] || stats.all;
  return stats.all;
}

function overviewKpis() {
  const scope = scopeStats();
  const cat = categoryFromPm(scope.mean);
  const top = topRowsFull();
  const topStation = state.station ? (DATA.stationsById.get(state.station) || top[0]) : top[0];
  const topLabel = topStation ? `${fmt(topStation.mean_2026 ?? scope.mean, 1)}` : '—';
  const span = healthSpan();
  const scopeName = state.station || (state.island === 'Semua' ? 'nasional' : state.island);
  const resp = span ? span.actual.resp : null;
  const respDays = span ? span.days : null;
  const ratioRow = (DATA.overview.kpis || []).find((k) => k.id === 'national');
  const ratio = ratioRow && ratioRow.ratio ? `${fmt(ratioRow.ratio, 2)}× 2024` : '—';
  const label = DATA.view.label;
  return [
    {
      id: 'mean', label: 'Rata-rata PM2.5', value: scope.mean, unit: 'µg/m³',
      baseline: catBadge(cat), window: DATA.view.name,
      note: `${scopeName} · n=${fmtInt(scope.days)} hari-stasiun · ${scope.stations} stasiun · ${label}`,
      tip: [
        ['Definisi', 'Rata-rata PM2.5 harian tiap stasiun, lalu dirata-rata'],
        ['Cakupan', `${fmtInt(scope.days)} hari-stasiun · ${scope.stations} stasiun`],
        ['Rentang', label],
        ['Ambang', 'PP 55 · WHO 15 µg/m³'],
        ['Pembanding', ratio],
      ],
      tipNote: 'JMB-02 dan MER-01 dikeluarkan (status bukan Active).',
    },
    {
      id: 'above55', label: 'Hari melampaui 55 µg/m³', value: scope.above55_pct, unit: '%',
      baseline: `${fmtInt(scope.severe_n)} hari-stasiun >150,4`, window: DATA.view.name,
      note: `${scopeName} · ${fmtInt(scope.above55_n)} dari ${fmtInt(scope.days)} hari-stasiun · ${label}`,
      tip: [
        ['Definisi', 'Porsi hari-stasiun dengan PM2.5 di atas 55 µg/m³'],
        ['Hitung', `${fmtInt(scope.above55_n)} dari ${fmtInt(scope.days)} hari-stasiun`],
        ['Rentang', label],
        ['Ambang', '55 = batas PP · 150,4 = ISPU Tidak Sehat'],
      ],
      tipNote: 'Satu hari-stasiun = satu stasiun pada satu hari.',
    },
    {
      id: 'heaviest', label: 'Stasiun terberat', value: topLabel, unit: topStation ? ` ${topStation.id}` : '',
      baseline: `${categoryFromPm(topStation ? topStation.mean_2026 : 0)} · ISPU`, window: DATA.view.name,
      note: topStation ? `${topStation.id} · ${fmt(topStation.mean_2026, 1)} µg/m³ · ${label}` : 'Tidak ada stasiun pada filter',
      tip: topStation ? [
        ['Stasiun', topStation.id],
        ['Kota', topStation.city],
        ['Rata-rata', `${fmt(topStation.mean_2026, 1)} µg/m³`],
        ['Peringkat', `1 dari ${top.length} stasiun`],
        ['Status', topStation.status],
      ] : [],
      tipNote: topStation ? 'Nilai batas bawah bila sensor menyentuh 999.' : 'Tidak ada stasiun pada filter ini.',
    },
    {
      id: 'resp', label: 'Kunjungan respirasi', value: resp, unit: 'kasus',
      baseline: 'aktual rumah sakit', window: DATA.view.name,
      note: `${scopeName} · ${label} · ${respDays} hari · ${DATA.hospitals.meta.count} RS`,
      tip: [
        ['Definisi', 'Jumlah kunjungan/rawat inap respirasi yang tercatat'],
        ['Cakupan', `${respDays} hari · rumah sakit mitra`],
        ['Rentang', label],
        ['Sifat', 'Aktual, bukan estimasi atau klaim kausal'],
      ],
      tipNote: 'Kunjungan rumah sakit, bukan kasus yang diatribusikan ke PM2.5.',
    },
  ];
}

function healthStationRow(id) {
  return (DATA.health.stations || []).find((s) => s.station === id) || null;
}
function topRowsFull() {
  const map = new Map(DATA.stations.stations.map((s) => [s.id, s]));
  return DATA.overview.top26
    .map((r) => ({ ...map.get(r.station), ...r, id: r.station }))
    .filter((r) => state.island === 'Semua' || r.island === state.island)
    .filter((r) => r.mean_2026 !== null && r.mean_2026 !== undefined)
    .sort((a, b) => (b.mean_2026 - a.mean_2026) || ((b.p95_2026 || 0) - (a.p95_2026 || 0)));
}
function kpiIcon(id) {
  const icons = {
    mean: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h8"/>',
    above55: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5"/><path d="M12 17.6v.4"/>',
    heaviest: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
    resp: '<path d="M12 21s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9Z"/>',
  };
  return `<span class="kpi-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[id] || icons.mean}</svg></span>`;
}

function kpiTipHtml(k) {
  const rows = k.tip || [];
  const head = `<div class="tip-title">${esc(k.label)}</div>`;
  if (!rows.length) return `${head}<div class="tip-note">${esc(k.note || '')}</div>`;
  const body = rows.map(([a, b]) => `<div class="tip-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
  return `${head}<div class="tip-rows">${body}</div>${k.tipNote ? `<div class="tip-note">${esc(k.tipNote)}</div>` : ''}`;
}

function kpiCard2(k) {
  const value = k.id === 'resp' ? fmtInt(k.value) : k.value;
  const est = k.id === 'resp';
  const valHtml = typeof value === 'number' ? fmt(value, 1) : value;
  const dest = KPI_DEST[k.id];
  const tipAttr = `data-tip-html="${esc(kpiTipHtml(k))}" aria-label="Info ${esc(k.label)}"`;
  if (!dest) {
    return `<div class="kpi" data-id="${k.id}">
      <div class="kpi-top">${kpiIcon(k.id)}<div class="kpi-label">${k.label}</div><span class="info" tabindex="0" ${tipAttr}>i</span></div>
      <div class="kpi-value-row"><span class="kpi-value${k.id === 'heaviest' ? ' small' : ''}">${valHtml}</span><span class="kpi-unit">${k.unit}</span></div>
      <div class="kpi-bottom"><span class="kpi-base ${est ? 'est' : ''}">${k.baseline}</span>${k.window ? `<span class="kpi-window">${k.window}</span>` : ''}</div>
    </div>`;
  }
  const destLabel = `Buka ${PAGE_NAMES[dest.page] || 'rincian'}`;
  return `<div class="kpi is-link" data-id="${k.id}" data-kpi="${k.id}" role="link" tabindex="0" aria-label="${esc(`${k.label}: ${valHtml} ${k.unit || ''} — ${destLabel}`)}">
    <div class="kpi-top">${kpiIcon(k.id)}<div class="kpi-label">${k.label}</div><span class="info" tabindex="0" ${tipAttr}>i</span></div>
    <div class="kpi-value-row"><span class="kpi-value${k.id === 'heaviest' ? ' small' : ''}">${valHtml}</span><span class="kpi-unit">${k.unit}</span></div>
    <div class="kpi-bottom"><span class="kpi-base ${est ? 'est' : ''}">${k.baseline}</span>${k.window ? `<span class="kpi-window">${k.window}</span>` : ''}</div>
  </div>`;
}

// Each KPI hands the story off to the page that explains it (no narration needed).
const KPI_DEST = {
  mean: { page: 'waktu' },
  above55: { page: 'waktu' },
  heaviest: { station: true },
  resp: { page: 'kesehatan' },
};

function round1(v) { return Math.round(v * 10) / 10; }

function healthYears() {
  if (DATA.health.scopeYears) return DATA.health.scopeYears;
  if (state.island === 'Semua') return DATA.health.years;
  return (DATA.health.byIsland || {})[state.island] || DATA.health.years;
}

/* Cakupan sebenarnya rentang aktif (tanpa pergeseran tahun):
   haridistinct + total kunjungan sepanjang rentang terpilih. */
function healthSpan() {
  if (DATA.health.span) return DATA.health.span;
  const years = healthYears();
  const actual = {};
  let days = 0;
  years.forEach((r) => {
    days += r.days || 0;
    Object.keys(r.actual || {}).forEach((k) => { actual[k] = (actual[k] || 0) + (r.actual[k] || 0); });
  });
  return { days, actual };
}

function healthLag() {
  if (state.island === 'Semua') return DATA.health.lag;
  return DATA.health.lag_by_island[state.island] || DATA.health.lag;
}

function healthStations() {
  const rows = DATA.health.stations;
  return rows.filter((r) => (state.island === 'Semua' || r.island === state.island) && (!state.station || r.station === state.station));
}

function defaultStationForIsland() {
  const rows = filteredStations();
  const preferred = rows.find((s) => s.id === 'KTG-02');
  return preferred ? preferred.id : (rows[0] ? rows[0].id : null);
}

function ispuLegendFull() {
  const rows = [...CAT_ORDER.map((k) => `<div class="row"><span class="sw" style="background:${CAT_COLORS[k]}"></span>${esc(k)}</div>`), '<div class="row"><span class="sw" style="background:#C3CAD9"></span>Tanpa data</div>'];
  return `<div class="map-legend-title">ISPU dominan</div>${rows.join('')}`;
}
function overviewPills() {
  const dq = DATA.meta.data_quality;
  const ratio = (DATA.overview.kpis || []).find((k) => k.id === 'national');
  const blind = (DATA.network.blind_spots || []).length;
  const ratioTip = state.range === 'semua'
    ? 'Rentang Semua tidak dibandingkan dengan 2024'
    : `Rata-rata ${DATA.view.label} dibanding rentang sama pada 2024`;
  return `<span class="pill static" data-tip="${esc(ratioTip)}">${fmtRatio(ratio ? ratio.ratio : null)}× 2024</span>
    <span class="pill static" data-tip="Baris lolos pemeriksaan ${fmtInt(dq.valid_rows)} dari ${fmtInt(dq.raw_rows)} baris mentah">${fmt(dq.valid_overall_pct, 1)}% data layak</span>
    <span class="pill warning" data-tip="${esc((DATA.network.blind_spots || []).join(' · '))}">${blind} wilayah tanpa stasiun</span>`;
}

function renderOverview() {
  const d = DATA.meta.data_quality;
  const meta = `${DATA.view.label} · ${d.stations} stasiun · ${d.provinces} provinsi · data hingga ${DATA.meta.periods.data_end}`;
  const kpis = overviewKpis().map(kpiCard2).join('');
  const islandCompTitle = state.station
    ? `Komposisi ISPU · ${state.station}`
    : (state.island === 'Semua' ? 'Komposisi ISPU per pulau' : `Komposisi ISPU · ${state.island}`);
  const trendTitle = state.station
    ? `Tren ${state.station}`
    : (state.island === 'Semua' ? 'Tren nasional' : `Tren ${state.island}`);
  const trend = trendMeta();
  return `${pageHead('Ringkasan', meta, overviewPills())}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="grid-55">
      <section class="card map-card h-420">
        <div class="card-head"><div class="card-title">Peta hotspot</div><div class="card-head-right"><div class="card-sub">ISPU · ${esc(shortDate(state.date))}</div>${provToggleHtml()}</div></div>
        <div class="card-body"><div class="map" id="map-overview"></div><div class="map-legend" id="legend-overview"></div></div>
      </section>
      ${card(trendTitle, 'µg/m³ · bulanan · garis PP 55 & WHO 15', `<div class="chart" id="chart-trend"></div>`, { cls: 'h-420', right: `<div class="card-sub">P95 ${fmt(trend.p95, 1)} · ${esc(DATA.view.label)}</div>` })}
    </div>
    <div class="grid-12">
      ${card('Ranking pulau', `µg/m³ · ${DATA.view.label}`, `<div class="chart" id="chart-rank-island"></div>`, { cls: 'span-3 h-320' })}
      ${card('Siklus 24 jam', `µg/m³ · per jam · ${scopeLabel()}`, `<div class="chart" id="chart-cycle"></div>`, { cls: 'span-4 h-320', right: `<div class="card-sub">${esc(diurnalNote())}</div>`, period: 'range' })}
      ${card('Kunjungan per kategori', `kasus · ${healthSpan().days} hari`, `<div class="chart" id="chart-ov-health"></div>`, { cls: 'span-5 h-320', right: '<div class="card-sub">aktual</div>', period: 'range' })}
    </div>
    <div class="grid-12">
      ${card(islandCompTitle, '% hari-stasiun', `<div class="chart" id="chart-ispu-island"></div>` + ispuStackLegend(), { cls: 'span-6 h-280', period: 'range' })}
      ${card('Perbandingan 5 kelas lokasi', 'baseline vs rata-rata · µg/m³', `<div class="chart" id="chart-class"></div>`, { cls: 'span-6 h-280', right: '<div class="card-sub">klik untuk rincian</div>', period: 'range' })}
    </div>
  </div>`;
}

function trendMeta() {
  const rows = trendRows();
  const last = rows.length ? rows[rows.length - 1] : null;
  const partialDays = last && last.stations ? Math.round(last.days / last.stations) : null;
  const st = state.station ? DATA.overview.stats_window.by_station[state.station] : null;
  const scope = st || (state.island === 'Semua' ? DATA.overview.stats_window.all : (DATA.overview.stats_window.by_island[state.island] || DATA.overview.stats_window.all));
  return { p95: scope.p95, partialDays };
}
function ispuStackLegend() {
  return `<div class="stack-legend">${CAT_ORDER.map((k) => `<span class="item"><span class="sw" style="background:${CAT_COLORS[k]}"></span>${esc(k)}</span>`).join('')}</div>`;
}

function afterOverview() {
  const rows = filteredStations();
  const hot = makeMap('map-overview', rows.map((s) => ({
    id: s.id,
    lat: s.lat,
    lon: s.lon,
    color: catColor(s.day_category),
    r: s.day_value == null ? 4.5 : 4 + Math.min(4, s.day_value / 90),
    selected: s.id === state.station,
    mean: s.day_value,
    tip: stationTip(s),
  })), {
    onClick: (id) => {
      const spec = detailStation(id, { cta: 'wilayah' });
      if (!spec) return;
      openDetail(spec);
      if (hot && hot.getLayer('stations-selected')) {
        hot.setFilter('stations-selected', ['==', ['get', 'id'], id]);
      }
    },
    legend: ispuLegendFull(),
    legendKind: 'stations',
    labels: true,
    islands: false,
    zoom: true,
    choropleth: { onProvince: (name) => { const spec = detailProvince(name); if (spec) openDetail(spec); } },
  });
  makeMonthlyChart('chart-trend', trendRows(), {
    compact: true,
    who15: true,
    xInterval: 2,
    onPick: (m) => { const spec = detailMonth(m, state.island === 'Semua' ? null : state.island); if (spec) openDetail(spec); },
  });
  const islandRows = state.station
    ? (() => {
      const st = DATA.stationsById.get(state.station);
      if (!st) return [];
      return [{ name: state.station, ...(DATA.overview.ispu_station_pct[state.station] || {}) }];
    })()
    : (state.island === 'Semua'
      ? Object.entries(DATA.overview.ispu_haze26_pct).map(([name, v]) => ({ name, ...v }))
      : Object.entries(DATA.overview.ispu_station_pct).filter(([id]) => { const s = DATA.stationsById.get(id); return s && s.island === state.island; }).map(([name, v]) => ({ name, ...v })));
  makeStackedComposition('chart-ispu-island', islandRows.sort((a, b) => (b['Berbahaya'] || 0) - (a['Berbahaya'] || 0)), {
    onPick: (name, cat) => {
      const spec = DATA.overview.ispu_haze26_pct[name] ? detailIslandCategory(name, cat) : null;
      if (spec) openDetail(spec);
      else {
        const st = DATA.stationsById.get(name);
        if (st) openDetail({
          key: `station:${name}`,
          kicker: `Komposisi ISPU · ${st.island}`,
          title: name,
          chip: name,
          body: `<div class="detail-block"><div class="detail-label">${esc(cat)}</div>${detailStack(DATA.overview.ispu_station_pct[name] || {}, st.days_2026)}</div>
            ${detailMetrics([['Kota', esc(st.city), ''], ['Mean', fmt(st.mean_2026, 1), 'µg/m³'], ['Layak', fmt(st.usable_pct, 1), '%']])}
            <button class="primary-btn detail-cta" type="button" data-station="${esc(name)}">Buka profil stasiun</button>`,
        });
      }
    },
  });
  makeCycleChart('chart-cycle');
  makeObservedChart('chart-ov-health', { grid: { left: 92, right: 48, top: 24, bottom: 24 }, yFont: 9 });
  makeSiteClassChart('chart-class');
  const islands = DATA.overview.island26.slice().sort((a, b) => b.mean - a.mean).map((r) => ({ id: r.island, value: r.mean, cat: categoryFromPm(r.mean), days: r.days }));
  const selIsland = state.station ? (DATA.stationsById.get(state.station) || {}).island : null;
  makeBarChart('chart-rank-island', islands, {
    horizontal: true,
    color: (r) => (selIsland ? (r.id === selIsland ? CAT_COLORS[r.cat] || C.navy : 'rgba(24,32,72,.18)') : (CAT_COLORS[r.cat] || C.navy)),
    label: (r) => fmt(r.value, 1),
    grid: { left: 78, right: 54, top: 18, bottom: 22 },
    yFont: 8.5,
    pp55: true,
    onPick: (r) => { const spec = detailIsland(r.id); if (spec) openDetail(spec); },
  });
}

function makeStackedComposition(id, rows, opts = {}) {
  if (!rows || !rows.length) return null;
  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: { left: 86, right: 28, top: 8, bottom: 24 },
    tooltip: { ...tooltipBase(), trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps) => `<b>${esc(ps[0].axisValue)}</b>` + ps.map((p) => `<br>${esc(p.seriesName)} ${fmt(p.value, 1)}%`).join('') },
    xAxis: { type: 'value', max: 100, axisLabel: { color: C.muted, fontSize: 8.5, formatter: '{value}%' }, splitLine: { lineStyle: { color: C.grid } } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: 9 } },
    series: CAT_ORDER.map((cat) => ({ name: cat, type: 'bar', stack: 'total', data: rows.map((r) => r[cat] ?? 0), barWidth: 16, itemStyle: { color: CAT_COLORS[cat], borderRadius: 4, borderColor: 'rgba(255,255,255,.5)', borderWidth: 1 }, emphasis: {} })),
  });
  if (chart && opts.onPick) {
    pickByPixel(chart, document.getElementById(id), 'y', (i, val) => {
      const row = rows[i];
      if (!row) return;
      let acc = 0;
      let cat = null;
      CAT_ORDER.forEach((c) => {
        const v = Number(row[c]) || 0;
        if (!cat && v > 0 && val <= acc + v + 1e-6) cat = c;
        acc += v;
      });
      if (cat) opts.onPick(row.name, cat);
    });
  }
  return chart;
}

function pickPolar(chart, el, onPick) {
  if (!chart || !el) return;
  el.style.cursor = 'pointer';
  chart.getZr().on('click', (e) => {
    if (chart.isDisposed()) return;
    const pt = [e.offsetX, e.offsetY];
    if (!chart.containPixel({ polarIndex: 0 }, pt)) return;
    const v = chart.convertFromPixel({ polarIndex: 0 }, pt);
    if (!v) return;
    requestAnimationFrame(() => onPick(Math.round(Number(v[1])), Number(v[0])));
  });
}

function pickByPixel(chart, el, axis, onPick) {
  if (!chart || !el) return;
  el.style.cursor = 'pointer';
  chart.getZr().on('click', (e) => {
    if (chart.isDisposed()) return;
    const pt = [e.offsetX, e.offsetY];
    if (!chart.containPixel({ gridIndex: 0 }, pt)) return;
    const v = chart.convertFromPixel({ gridIndex: 0 }, pt);
    if (!v) return;
    const idx = Math.round(Number(axis === 'y' ? v[1] : v[0]));
    const other = Number(axis === 'y' ? v[0] : v[1]);
    if (!Number.isFinite(idx) || idx < 0) return;
    requestAnimationFrame(() => onPick(idx, other));
  });
}

function trendRows() {
  if (state.station) return DATA.time.station_monthly[state.station] || [];
  if (state.island === 'Semua') return DATA.overview.monthly;
  return DATA.time.island_monthly.filter((r) => r.island === state.island);
}

function renderOverviewPanel() {
  const el = $('#ov-panel');
  if (!el) return;
  const tab = state.tab.ringkasan || 'ranking';
  if (tab === 'tabel') {
    const rows = topRows();
    el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Stasiun</th><th>Pulau</th><th class="num">Rata-rata</th><th class="num">P95</th><th class="num">Maks</th><th class="num">Hari</th><th>Status</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.island)}</td><td class="num">${fmt(r.mean_2026, 1)}</td><td class="num">${fmt(r.p95_2026, 1)}</td><td class="num">${fmt(r.max_2026, 1)}</td><td class="num">${r.days_2026}</td><td><span class="st ${statusSlug(r.status)}">${esc(r.status)}</span></td></tr>`).join('')}
    </tbody></table></div>`;
    return;
  }
  el.innerHTML = `<div class="chart" id="ov-panel-chart"></div>`;
  const rows = tab === 'pulau'
    ? DATA.overview.island26.slice().sort((a, b) => b.mean - a.mean).map((r) => ({ id: r.island, value: r.mean, status: r.island === state.island ? 'selected' : '' }))
    : topRows().slice(0, 10).map((r) => ({ id: r.id, value: r.mean_2026, status: r.status }));
  makeBarChart('ov-panel-chart', rows, {
    horizontal: true,
    color: (r) => tab === 'pulau' ? (r.status === 'selected' ? C.yellow : C.navy) : pmColor(r.value),
    label: (r) => fmt(r.value, 1),
    grid: { left: 54, right: 38, top: 6, bottom: 6 },
    yFont: 9,
  });
}

function pmLegend() {
  return `<div class="row"><span class="sw" style="background:${C.teal}"></span>&lt;15</div>
    <div class="row"><span class="sw" style="background:${C.moss}"></span>15–55</div>
    <div class="row"><span class="sw" style="background:${C.yellow}"></span>55–100</div>
    <div class="row"><span class="sw" style="background:${C.terra}"></span>&gt;100</div>
    <div class="row"><span class="sw" style="background:#C3CAD9"></span>tanpa data</div>`;
}

/* ------------------------------------------------------------------ time */
function timeKpis() {
  const sub = `${scopeLabel()} · ${DATA.view.label}`;
  const curve = diurnalCurve();
  const peakIdx = curve.means.reduce((best, v, i) => (v != null && (best < 0 || v > curve.means[best]) ? i : best), -1);
  const peak = peakIdx >= 0 ? { hour: peakIdx, pm25: curve.means[peakIdx] } : null;
  const w26 = state.island === 'Semua' ? DATA.time.weekday.find((r) => r.year === 2026) : (DATA.time.weekday_island || []).find((r) => r.year === 2026 && r.island === state.island);
  const diff = w26 && w26.weekend != null && w26.weekday != null ? w26.weekend - w26.weekday : null;
  const scope = scopeStats();
  let streak = 0; let streakStation = null;
  const streakId = state.station || defaultStationForIsland();
  if (streakId && DATA.time.episode_stats[streakId]) { streak = DATA.time.episode_stats[streakId].longest || 0; streakStation = streakId; }
  else Object.entries(DATA.time.episode_stats).forEach(([id, r]) => {
    if (state.island !== 'Semua') { const s = DATA.stationsById.get(id); if (!s || s.island !== state.island) return; }
    if ((r.longest || 0) > streak) { streak = r.longest; streakStation = id; }
  });
  return [
    { id: 'peak', label: `Jam terburuk${state.station ? ' · ' + state.station : ''}`, value: peak ? `${String(peak.hour).padStart(2, '0')}:00` : '—', unit: '', baseline: peak ? `${fmt(peak.pm25, 1)} µg/m³` : '', window: DATA.view.name, note: sub },
    { id: 'weekend', label: 'Selisih akhir pekan', value: diff == null ? '—' : (diff >= 0 ? '+' : '') + fmt(diff, 1), unit: diff == null ? '' : 'µg/m³', baseline: w26 && diff != null ? `libur ${fmt(w26.weekend, 1)} − kerja ${fmt(w26.weekday, 1)}` : 'tidak cukup hari', window: DATA.view.name, note: `akhir pekan − hari kerja · ${DATA.view.label}` },
    { id: 'above55', label: 'Hari >55 µg/m³', value: scope.above55_pct, unit: '%', baseline: `${fmtInt(scope.above55_n)}/${fmtInt(scope.days)} hari-stasiun`, window: DATA.view.name, note: `porsi hari-stasiun di atas 55 · ${DATA.view.label}` },
    { id: 'streak', label: 'Rentetan episode terpanjang', value: streak ? fmtInt(streak) : '—', unit: 'hari', baseline: streakStation ? `${streakStation} · >55 µg/m³` : '', window: '2024–2026', note: 'hari berurutan >55 µg/m³ · seluruh periode' },
  ];
}
/* Catatan cakupan & satuan kartu siklus 24 jam. */
function diurnalNote() {
  return state.range === 'hari' ? 'satu hari penuh' : 'garis putus-putus = rata-rata';
}
function renderTime() {
  const d = DATA.meta.data_quality;
  const meta = `${DATA.view.label} · ${d.stations} stasiun · data hingga ${DATA.meta.periods.data_end}`;
  const sub = `${scopeLabel()} · ${DATA.view.label}`;
  const kpis = timeKpis().map(kpiCard2).join('');
  return `${pageHead('Waktu', meta, `<span class="pill">${esc(DATA.view.name)}</span>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="grid-12">
      ${card('Perubahan PM2.5 harian', 'µg/m³', `<div class="chart" id="chart-daily"></div>`, { cls: 'span-12 h-460', right: '<div class="card-sub">µg/m³ · garis 15 / 55 / 100</div>', period: state.range === 'hari' ? `${daySpan(shiftIso(state.date, -14), shiftIso(state.date, 7))} hari sekitar ${shortDate(state.date)}` : 'full' })}
    </div>
    <div class="grid-12">
      ${card('Siklus 24 jam', `µg/m³ · per jam · ${scopeLabel()} + tiap kelas lokasi`, `<div class="chart" id="chart-time-cycle"></div>`, { cls: 'span-8 h-320', right: `<div class="card-sub">${esc(diurnalNote())} · klik untuk rincian</div>`, period: 'range' })}
      ${card('Bulanan per pulau', 'µg/m³ · 2024–2026', `<div class="chart" id="chart-month-island"></div>`, { cls: 'span-4 h-320', right: '<div class="card-sub">µg/m³ · garis 55</div>', period: 'full' })}
    </div>
    <div class="grid-12">
      ${card('Kalender harian', `PM2.5 · ${sub}`, `<div class="chart" id="chart-heat"></div>`, { cls: 'span-7 h-340', right: `<div class="heat-legend" id="legend-heat"></div>`, period: `PM2.5 · ${sub} · ${periodText('full')}` })}
      ${card('Jam × hari', 'µg/m³ · 2024–2026', `<div class="chart" id="chart-hour-dow"></div>`, { cls: 'span-5 h-340', right: '<div class="card-sub">µg/m³ · jam × hari</div>', period: 'full' })}
    </div>
    <div class="grid-12">
      ${card('Episode per bulan', 'hari-stasiun >55 · 2024–2026', `<div class="chart" id="chart-episode-month"></div>`, { cls: 'span-7 h-280', right: '<div class="card-sub">hari-stasiun >55</div>', period: 'full' })}
      ${card('Hari kerja vs akhir pekan', `µg/m³ · ${DATA.view.label}`, `<div class="chart" id="chart-weekday"></div>`, { cls: 'span-5 h-280', right: '<div class="card-sub">µg/m³ · per tahun</div>', period: 'range' })}
    </div>
    <div class="grid-12">
      ${card('Komposisi ISPU per tahun', '% hari-stasiun', `<div class="chart" id="chart-ispu-year"></div>` + ispuStackLegend(), { cls: 'span-12 h-280', period: 'full' })}
    </div>
  </div>`;
}

function afterTime() {
  makeHeatmap();
  makeHourDowChart();
  makeCycleChart('chart-time-cycle', { detail: true });
  makeMonthIslandChart();
  makeEpisodeMonthChart();
  makeWeekdayChart();
  makeEpisodeChart();
  const yearRows = Object.entries(DATA.overview.ispu_year_pct).map(([name, v]) => ({ name, ...v }));
  makeStackedComposition('chart-ispu-year', yearRows, {
    onPick: (name) => {
      const spec = detailIspuYear(name);
      if (spec) openDetail(spec);
    },
  });
}

function timeMonthlyRows() {
  return trendRows();
}

function makeHourDowChart() {
  const rows = state.station ? (DATA.time.hour_dow_by_station[state.station] || []) : (state.island === 'Semua' ? (DATA.time.hour_dow_all || []) : (DATA.time.hour_dow_by_island[state.island] || []));
  if (!rows.length) return null;
  const dows = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const data = rows.map((r) => [r.hour, r.dow, r.pm25, r.n]);
  const chart = makeChart('chart-hour-dow', {
    aria: { enabled: true },
    grid: { left: 44, right: 34, top: 8, bottom: 30 },
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${hours[p.value[0]]}:00 · ${dows[p.value[1]]}</b><br>${fmt(p.value[2], 1)} µg/m³ · n=${fmtInt(p.value[3])}` },
    xAxis: { type: 'category', data: hours, axisLabel: { color: C.muted, fontSize: 7.5, interval: 2 }, axisTick: { show: false } },
    yAxis: { type: 'category', inverse: true, data: dows, axisLabel: { color: C.muted, fontSize: 8 }, axisTick: { show: false } },
    visualMap: { show: false, dimension: 2, min: 37.8, max: 55, inRange: { color: ['#DFF6F1', '#FFE9A8', '#E3A008', '#D9663F'] } },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: C.paper, borderWidth: 1 } }],
  });
  pickByPixel(chart, document.getElementById('chart-hour-dow'), 'x', (hour, dowV) => {
    const dow = Math.round(Number(dowV));
    if (hour >= 0 && hour < 24 && dow >= 0 && dow < 7) {
      const spec = detailHourDow(hour, dow);
      if (spec) openDetail(spec);
    }
  });
  return chart;
}
function makeMonthIslandChart() {
  const rows = DATA.time.island_monthly;
  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const islands = Array.from(new Set(rows.map((r) => r.island))).sort();
  const by = new Map(rows.map((r) => [`${r.month}|${r.island}`, r.pm25]));
  const chart = makeChart('chart-month-island', {
    aria: { enabled: true },
    grid: { left: 40, right: 12, top: 30, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 8, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: months.map((m) => monthLabel(m)), axisLabel: { color: C.muted, fontSize: 7.5, interval: 4 }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    series: islands.map((isl) => ({ name: isl, type: 'line', data: months.map((m) => by.get(`${m}|${isl}`) ?? null), smooth: false, symbol: 'none', lineStyle: { width: isl === state.island ? 2.4 : 1.3, color: ISLAND_COLORS[isl] || C.navy, opacity: state.island === 'Semua' || isl === state.island ? 1 : 0.35 }, itemStyle: { color: ISLAND_COLORS[isl] || C.navy }, markLine: isl === islands[0] ? markLinePP(ppItem('y', 55, 'PP 55', C.yellow)) : undefined })),
  });
  pickByPixel(chart, document.getElementById('chart-month-island'), 'x', (mi2, yVal) => {
    const month = months[mi2];
    if (!month) return;
    let best = null;
    islands.forEach((isl) => {
      const v = by.get(`${month}|${isl}`);
      if (v == null) return;
      const d = Math.abs(v - yVal);
      if (!best || d < best.d) best = { isl, d };
    });
    if (!best) return;
    const spec = detailMonth(month, best.isl);
    if (spec) openDetail(spec);
  });
  return chart;
}
function makeEpisodeMonthChart() {
  const rows = DATA.time.episode_monthly_island || [];
  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const islands = Array.from(new Set(rows.map((r) => r.island))).sort();
  const by = new Map(rows.map((r) => [`${r.month}|${r.island}`, r.episode]));
  const chart = makeChart('chart-episode-month', {
    aria: { enabled: true },
    grid: { left: 40, right: 12, top: 30, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 8, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: months.map((m) => monthLabel(m)), axisLabel: { color: C.muted, fontSize: 7.5, interval: 4 }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    series: islands.map((isl) => ({ name: isl, type: 'bar', stack: 'ep', data: months.map((m) => by.get(`${m}|${isl}`) || 0), barWidth: 10, itemStyle: { color: ISLAND_COLORS[isl] || C.navy } })),
  });
  pickByPixel(chart, document.getElementById('chart-episode-month'), 'x', (mi2) => {
    const month = months[mi2];
    if (!month) return;
    const spec = detailEpisodeMonth(month);
    if (spec) openDetail(spec);
  });
  return chart;
}
function makeHeatmap() {
  const el = $('#chart-heat');
  if (!el) return;
  let rows;
  let months;
  if (state.station) {
    rows = DATA.time.station_daily[state.station] || [];
    months = Array.from(new Set(rows.map((r) => r[0].slice(0, 7)))).sort();
  } else {
    rows = state.island === 'Semua' ? DATA.time.daily : (DATA.time.daily_island[state.island] || []);
    months = [];
    const start = new Date('2024-01-01T00:00:00');
    for (let i = 0; i < 34; i++) {
      const d = new Date(start);
      d.setMonth(start.getMonth() + i);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }
  const mi = new Map(months.map((m, i) => [m, i]));
  const data = [];
  rows.forEach((r) => {
    const date = r[0];
    const m = date.slice(0, 7);
    if (!mi.has(m)) return;
    const day = Number(date.slice(8, 10));
    data.push([day - 1, mi.get(m), r[1], categoryFromPm(r[1]), r[2] || 0]);
  });
  const chart = makeChart('chart-heat', {
    aria: { enabled: true },
    grid: { left: 52, right: 12, top: 8, bottom: 24 },
    tooltip: {
      ...tooltipBase(),
      formatter: (p) => {
        const [x, y, v, cat, n] = p.value;
        return `<b>${months[y]}-${String(x + 1).padStart(2, '0')}</b><br>${fmt(v, 1)} µg/m³<br>${esc(cat)}${n ? ` · n=${fmtInt(n)}` : ''}`;
      },
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 31 }, (_, i) => String(i + 1)),
      splitArea: { show: false },
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 8, interval: 2 },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: months.map((m) => monthLabel(m)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 8.5 },
    },
    visualMap: {
      show: false,
      dimension: 2,
      pieces: [
        { lte: 15.5, color: C.teal },
        { gt: 15.5, lte: 55.4, color: C.moss },
        { gt: 55.4, lte: 150.4, color: C.yellow },
        { gt: 150.4, lte: 250.4, color: C.terra },
        { gt: 250.4, color: C.red },
      ],
    },
    series: [{
      type: 'heatmap',
      data,
      itemStyle: { borderColor: C.paper, borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: C.navy, borderWidth: 1 } },
    }],
  });
  pickByPixel(chart, el, 'x', (dayIdx, monthIdx) => {
    const mi2 = Math.round(Number(monthIdx));
    const day = Math.round(Number(dayIdx)) + 1;
    if (mi2 < 0 || mi2 >= months.length || day < 1 || day > 31) return;
    const dateStr = `${months[mi2]}-${String(day).padStart(2, '0')}`;
    const spec = detailDay(dateStr);
    if (spec) openDetail(spec);
  });
  const legend = $('#legend-heat');
  if (legend) legend.innerHTML = ispuLegendFull();
  return chart;
}

function makeEpisodeChart() {
  const rows = state.station ? (DATA.time.station_daily[state.station] || []) : (state.island === 'Semua' ? DATA.time.daily : (DATA.time.daily_island[state.island] || []));
  const [from, to] = rangeBounds();
  const shiftDay = (iso, days) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const dayOnly = state.range === 'hari';
  const chart = makeChart('chart-daily', {
    aria: { enabled: true },
    grid: { left: 40, right: 16, top: 26, bottom: 28 },
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      formatter: (ps) => {
        const ts = ps[0].value[0];
        const iso = new Date(ts).toISOString().slice(0, 10);
        return `<b>${esc(shortDate(iso))}</b><br>${fmt(ps[0].value[1], 1)} µg/m³`;
      },
    },
    xAxis: {
      type: 'time',
      min: dayOnly ? shiftDay(from, -14) : undefined,
      max: dayOnly ? shiftDay(to, 7) : undefined,
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 9 },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 9 } },
    series: [{
      type: 'line',
      data: rows.map((r) => [r[0], r[1]]),
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.6, color: C.navy },
      areaStyle: { color: 'rgba(16,42,67,.06)' },
      markLine: {
        silent: true,
        symbol: 'none',
        label: { show: dayOnly, formatter: 'Tanggal acuan', color: C.terra, fontSize: 8.5 },
        data: [
          ...(dayOnly ? [{ xAxis: to, lineStyle: { type: 'dashed', width: 1.2, color: C.terra } }] : []),
          ppItem('y', 55, 'PP 55', C.yellow),
          { yAxis: 15, lineStyle: { type: [4, 3], width: 1, color: C.teal, opacity: .5 }, label: { show: false } },
          { yAxis: 100, lineStyle: { type: [4, 3], width: 1, color: C.terra, opacity: .45 }, label: { show: false } },
        ],
      },
    }],
  });
  pickByPixel(chart, document.getElementById('chart-daily'), 'x', (ts) => {
    const spec = detailDayNearest(ts);
    if (spec) openDetail(spec);
  });
  return chart;
}

function makeWeekdayChart() {
  const rows = DATA.time.weekday;
  const chart = makeChart('chart-weekday', {
    aria: { enabled: true },
    grid: { left: 40, right: 16, top: 30, bottom: 28 },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 9, color: C.muted } },
    xAxis: { type: 'category', data: rows.map((r) => String(r.year)), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 10 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 9 } },
    series: [
      { name: 'Hari kerja', type: 'bar', data: rows.map((r) => r.weekday), barWidth: 22, itemStyle: { color: C.navy, borderRadius: [3, 3, 0, 0] }, label: { show: true, position: 'top', fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.navy, formatter: (p) => fmt(p.value, 1) }, markLine: markLinePP(ppItem('y', 55, 'PP 55', C.yellow)) },
      { name: 'Akhir pekan', type: 'bar', data: rows.map((r) => r.weekend), barWidth: 22, itemStyle: { color: C.yellow, borderRadius: [3, 3, 0, 0] } },
    ],
  });
  return chart;
}

/* ------------------------------------------------------------------ geo */
function defaultCompareA() {
  if (state.compareA && DATA.stationsById.has(state.compareA)) return state.compareA;
  return state.station || defaultStationForIsland() || 'KTG-02';
}
function defaultCompareB(a) {
  if (state.compareB && DATA.stationsById.has(state.compareB) && state.compareB !== a) return state.compareB;
  const ranked = filteredStations().filter((s) => s.id !== a && s.mean_2026 != null).sort((x, y) => y.mean_2026 - x.mean_2026);
  return ranked[0] ? ranked[0].id : null;
}
function renderGeo() {
  const valid = state.station && filteredStations().some((s) => s.id === state.station);
  const stId = valid ? state.station : defaultStationForIsland();
  if (stId) state.station = stId;
  const st = DATA.stationsById.get(stId) || null;
  const meta = `${DATA.view.label} · ${filteredStations().length} stasiun · data hingga ${DATA.meta.periods.data_end}`;
  return `${pageHead('Stasiun', meta, `<span class="pill">${esc(DATA.view.name)}</span>`)}
  <div class="page-body">
    <div class="grid-12">
      <section class="card span-7 h-420">
        <div class="card-head"><div class="card-title">Peta stasiun</div><div class="card-head-right"><div class="card-sub">ISPU · ${esc(shortDate(state.date))}</div></div></div>
        <div class="card-body"><div class="map" id="map-geo"></div><div class="map-legend" id="legend-geo"></div></div>
      </section>
      <section class="card span-5 h-420">
        <div class="card-head"><div class="card-title">Profil stasiun</div><div class="card-head-right">${st ? `<button class="ghost-btn" type="button" data-action="compare-station">Bandingkan</button>` : ''}<div class="card-sub">${st ? 'klik titik lain' : 'pilih stasiun'}</div><div class="card-sub period">${esc(DATA.view.label)}</div></div></div>
        <div class="card-body" id="profile-body">${renderProfile(st)}</div>
      </section>
    </div>
    <div class="grid-12">
      ${card('Tren bulanan stasiun', 'µg/m³ · 2024–2026', `<div class="chart" id="chart-profile-trend"></div>`, { cls: 'span-12 h-280', right: '<div class="card-sub">µg/m³ · garis 55</div>', period: 'full' })}
    </div>
    <div class="grid-12">
      ${card('Kronis–akut', `rata-rata vs P95 harian · ${DATA.view.label}`, `<div class="chart" id="chart-chronic"></div>`, { cls: 'span-7 h-320', right: '<div class="card-sub">X rata-rata · Y P95</div>', period: 'range' })}
      ${card('Ringkasan beban', 'µg/m³', `<div class="card-body" id="chronic-stats" style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;align-content:start"></div>`, { cls: 'span-5 h-320', right: `<div class="card-sub">${esc(DATA.view.label)}</div>` })}
    </div>
    ${renderGeoTable()}
  </div>`;
}
function renderGeoTable() {
  const rows = geoTableRows();
  return `<section class="card span-12 h-auto">
    <div class="card-head">
      <div class="card-title">Tabel 27 stasiun</div>
      <div class="card-head-right">
        <div class="card-sub">${esc(DATA.view.label)}</div>
        <input class="method-search" id="geo-table-search" type="search" placeholder="Cari stasiun/kota" value="${esc(state.tableSearch)}" aria-label="Cari stasiun">
        <label class="filter-group"><span class="filter-label">Urut</span><select class="select" id="geo-table-sort">${['mean','p95','usable','name'].map((k) => `<option value="${k}" ${state.tableSort === k ? 'selected' : ''}>${({mean:'Rata-rata',p95:'P95',usable:'Kelayakan',name:'Nama'})[k]}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="card-body"><div class="table-wrap" style="height:auto;max-height:360px"><table class="data" id="geo-table"></table></div></div>
  </section>`;
}
function geoTableRows() {
  const rows = filteredStations().slice();
  const q = state.tableSearch.toLowerCase().trim();
  const filtered = q ? rows.filter((s) => s.id.toLowerCase().includes(q) || s.city.toLowerCase().includes(q) || s.island.toLowerCase().includes(q)) : rows;
  const by = {
    mean: (a, b) => (b.mean_2026 || 0) - (a.mean_2026 || 0),
    p95: (a, b) => (b.p95_2026 || 0) - (a.p95_2026 || 0),
    usable: (a, b) => (a.usable_pct || 0) - (b.usable_pct || 0),
    name: (a, b) => a.id.localeCompare(b.id),
  }[state.tableSort] || ((a, b) => (b.mean_2026 || 0) - (a.mean_2026 || 0));
  return filtered.sort(by);
}

function afterGeo() {
  const selectedId = state.station || defaultStationForIsland() || 'KTG-02';
  const rows = filteredStations();
  const mapped = rows.map((s) => ({
    id: s.id,
    lat: s.lat,
    lon: s.lon,
    color: catColor(s.day_category),
    r: s.day_value == null ? 4.5 : 3.5 + Math.min(3.5, s.day_value / 100),
    selected: s.id === selectedId,
    popup: `<b>${esc(s.id)}</b><br>${esc(shortDate(state.date))} · ${s.day_value == null ? 'tanpa data' : fmt(s.day_value, 1) + ' µg/m³'}<br>rata-rata ${fmt(s.mean_2026, 1)} µg/m³ · ${esc(s.status)}`,
  }));
  makeMap('map-geo', mapped, {
    onClick: (id) => { state.station = id; render(); },
    legend: ispuLegendFull(),
    labels: true,
  });
  const st = DATA.stationsById.get(selectedId) || null;
  if (st) {
    makeProfileSpark(st);
    makeMonthlyChart('chart-profile-trend', DATA.time.station_monthly[st.id] || [], {
      compact: true,
      onPick: (m) => { const spec = detailMonthScope(m); if (spec) openDetail(spec); },
    });
  }
  makeChronicChart();
  renderGeoTableBody();
  const search = $('#geo-table-search');
  const sort = $('#geo-table-sort');
  if (search) search.addEventListener('input', () => { state.tableSearch = search.value; renderGeoTableBody(); });
  if (sort) sort.addEventListener('change', () => { state.tableSort = sort.value; renderGeoTableBody(); });
}
function makeChronicChart() {
  const rows = filteredStations().filter((s) => s.mean_2026 != null);
  const chart = makeChart('chart-chronic', {
    aria: { enabled: true },
    grid: { left: 48, right: 16, top: 30, bottom: 34 },
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(p.value[3])}</b><br>mean ${fmt(p.value[0], 1)} µg/m³<br>P95 ${fmt(p.value[1], 1)} µg/m³<br>${esc(p.value[2])} · ${fmtInt(p.value[4])} hari` },
    xAxis: { type: 'value', name: 'mean µg/m³', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 9, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    yAxis: { type: 'value', name: 'P95 µg/m³', nameGap: 16, nameTextStyle: { fontSize: 9, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    series: rows.map((s, si) => ({ type: 'scatter', data: [[s.mean_2026, s.p95_2026, s.ispu_dominant || '—', s.id, s.days_2026]], symbolSize: 8, itemStyle: { color: catColor(s.ispu_dominant), borderColor: C.paper, borderWidth: 1.2 }, label: { show: true, position: 'top', fontSize: 7.5, color: C.muted, formatter: (p) => (p.value[0] > 150 || p.value[1] > 400 || p.value[3] === 'SM2-01') ? p.value[3] : '', distance: 4 }, labelLayout: { hideOverlap: true }, markLine: si === 0 ? markLinePP(ppItem('x', 55, '55', C.yellow), ppItem('y', 55, 'PP 55', C.yellow)) : undefined })),
  });
  chart.on('click', (p) => {
    if (p.seriesType !== 'scatter') return;
    const s = rows[p.seriesIndex];
    if (!s) return;
    const spec = detailStation(s.id);
    if (spec) openDetail(spec);
  });
  const stats = $('#chronic-stats');
  if (stats) {
    const valid = rows.filter((s) => s.mean_2026 != null);
    const kronis = valid.slice().sort((a, b) => a.mean_2026 - b.mean_2026)[0];
    const akut = valid.slice().sort((a, b) => b.p95_2026 - a.p95_2026)[0];
    stats.innerHTML = [
      ['Rata-rata terendah', kronis ? `${kronis.id} · ${fmt(kronis.mean_2026, 1)}` : '—', 'µg/m³'],
      ['Rata-rata tertinggi', topRowsFull()[0] ? `${topRowsFull()[0].id} · ${fmt(topRowsFull()[0].mean_2026, 1)}` : '—', 'µg/m³'],
      ['P95 tertinggi', akut ? `${akut.id} · ${fmt(akut.p95_2026, 1)}` : '—', 'µg/m³'],
      ['Stasiun', valid.length ? `${valid.length}` : '—', 'stasiun'],
    ].map(([k, v, u]) => `<div class="metric"><div class="metric-label">${k}</div><div class="metric-value">${v} <small>${u}</small></div></div>`).join('');
  }
}
function renderGeoTableBody() {
  const el = $('#geo-table');
  if (!el) return;
  const rows = geoTableRows();
  el.innerHTML = `<thead><tr><th>Stasiun</th><th>Kota</th><th>Pulau</th><th>ISPU dominan</th><th class="num">Mean</th><th class="num">P95</th><th class="num">Maks</th><th class="num">Hari >55</th><th class="num">Layak</th><th>Status</th></tr></thead><tbody>${rows.map((s) => { const comp = DATA.overview.ispu_station_pct[s.id] || {}; const pct55 = (comp['Tidak Sehat'] || 0) + (comp['Sangat Tidak Sehat'] || 0) + (comp['Berbahaya'] || 0); const hari55 = Math.round((s.days_2026 || 0) * pct55 / 100); return `<tr data-geo-station="${esc(s.id)}" tabindex="0"><td class="mono">${esc(s.id)}</td><td>${esc(s.city)}</td><td>${esc(s.island)}</td><td>${catBadge(s.ispu_dominant, s.ispu_share)}</td><td class="num">${s.lower_bound ? '≥' : ''}${fmt(s.mean_2026, 1)}</td><td class="num">${fmt(s.p95_2026, 1)}</td><td class="num">${fmt(s.max_2026, 1)}</td><td class="num">${fmtInt(hari55)}</td><td class="num">${fmt(s.usable_pct, 1)}%</td><td><span class="st ${statusSlug(s.status)}">${esc(s.status)}</span></td></tr>`; }).join('')}</tbody>`;
  bindRowActivate('#geo-table tbody tr', 'data-geo-station', detailStation);
}
function renderCompare(root = document) {
  const body = root.querySelector('#compare-body');
  const table = root.querySelector('#compare-table');
  if (!body || !table) return;
  const a = DATA.stationsById.get(state.compareA || '');
  const b = DATA.stationsById.get(state.compareB || '');
  if (!a || !b || a.id === b.id) { body.innerHTML = `<div class="empty">Tidak ada pembanding</div>`; table.innerHTML = ''; return; }
  const pct = (x, y) => (x == null || y == null || y === 0) ? null : (x - y) / y * 100;
  body.innerHTML = [a, b].map((s, i) => `<div class="profile" style="height:auto">
    <div class="profile-head"><div><div class="profile-name">${esc(s.id)}</div><div class="profile-sub">${esc(s.city)} · ${esc(s.province)}</div></div>${statusBadge(s.status)}</div>
    <div class="metric-grid">
      <div class="metric"><div class="metric-label">ISPU dominan</div><div class="metric-value"><span class="cat-badge" style="background:${catColor(s.ispu_dominant)}22;border-color:${catColor(s.ispu_dominant)};color:${catColor(s.ispu_dominant)}">${esc(s.ispu_dominant || '—')} · ${s.ispu_share == null ? '—' : fmt(s.ispu_share, 1) + '%'}</span></div></div>
      <div class="metric"><div class="metric-label">Mean</div><div class="metric-value">${s.lower_bound ? '≥' : ''}${fmt(s.mean_2026, 1)} <small>µg/m³</small></div></div>
      <div class="metric"><div class="metric-label">P95</div><div class="metric-value">${fmt(s.p95_2026, 1)} <small>µg/m³</small></div></div>
      <div class="metric"><div class="metric-label">Maks</div><div class="metric-value">${fmt(s.max_2026, 1)} <small>µg/m³</small></div></div>
      <div class="metric"><div class="metric-label">Hari</div><div class="metric-value">${fmtInt(s.days_2026)} <small>hari</small></div></div>
      <div class="metric"><div class="metric-label">Kelayakan</div><div class="metric-value">${fmt(s.usable_pct, 1)} <small>%</small></div></div>
      <div class="metric"><div class="metric-label">Baseline</div><div class="metric-value">${fmt(s.baseline, 1)} <small>µg/m³</small></div></div>
      <div class="metric"><div class="metric-label">Lalu lintas · jarak</div><div class="metric-value">${fmtInt(s.traffic)} <small>/jam · ${fmtInt(s.distance)} m</small></div></div>
    </div>
    <div class="spark-wrap"><div class="spark-label">Bulanan 2024–2026</div><div class="chart spark" id="compare-spark-${i}"></div></div>
    <div class="detail-list">
      <div class="row"><span>Tipe situs</span><b>${esc(s.site_class)}</b></div>
      <div class="row"><span>Data lolos pemeriksaan</span><b>${fmt(s.valid_pct, 1)}%</b></div>
      <div class="row"><span>Hari layak · 2024–2026</span><b>${s.usable_days}/${s.total_days}</b></div>
      ${s.issues ? `<div class="row"><span>Catatan QC</span><b>${esc(s.issues)}</b></div>` : ''}
    </div>
  </div>`).join('');
  const rows = [
    ['Mean µg/m³', a.mean_2026, b.mean_2026, (x, y) => fmt(x, 1), (x, y) => pct(x, y)],
    ['P95 µg/m³', a.p95_2026, b.p95_2026, (x, y) => fmt(x, 1), (x, y) => pct(x, y)],
    ['Maks µg/m³', a.max_2026, b.max_2026, (x, y) => fmt(x, 1), (x, y) => pct(x, y)],
    ['Hari', a.days_2026, b.days_2026, (x, y) => fmtInt(x), (x, y) => pct(x, y)],
    ['Kelayakan %', a.usable_pct, b.usable_pct, (x, y) => fmt(x, 1), (x, y) => x == null ? null : x - y],
    ['Baseline µg/m³', a.baseline, b.baseline, (x, y) => fmt(x, 1), (x, y) => pct(x, y)],
    ['Traffic /jam', a.traffic, b.traffic, (x, y) => fmtInt(x), (x, y) => pct(x, y)],
    ['Distance m', a.distance, b.distance, (x, y) => fmtInt(x), (x, y) => pct(x, y)],
  ];
  table.innerHTML = `<thead><tr><th>Metrik</th><th class="num">A · ${esc(a.id)}</th><th class="num">B · ${esc(b.id)}</th><th class="num">Selisih</th></tr></thead><tbody>${rows.map(([label, x, y, f, d]) => { const dv = d(x, y); const cls = dv == null ? '' : dv >= 0 ? 'delta-pos' : 'delta-neg'; return `<tr><td>${label}</td><td class="num">${x == null ? '—' : f(x, y)}</td><td class="num">${y == null ? '—' : f(y, x)}</td><td class="num ${cls}">${dv == null ? '—' : (dv >= 0 ? '+' : '') + fmt(dv, 1) + (label.includes('%') ? ' poin' : '%')}</td></tr>`; }).join('')}</tbody>`;
  [a, b].forEach((s, i) => {
    const rows2 = DATA.time.station_monthly[s.id] || [];
    makeChart(`compare-spark-${i}`, {
      aria: { enabled: true },
      grid: { left: 8, right: 8, top: 6, bottom: 20 },
      tooltip: { ...tooltipBase(), formatter: (p) => `<b>${p.axisValue}</b><br>${fmt(p.value, 1)} µg/m³` },
      xAxis: { type: 'category', data: rows2.map((r) => monthLabel(r.month)), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 7.5, interval: 5 } },
      yAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
      series: [{ type: 'line', data: rows2.map((r) => r.pm25), smooth: false, symbol: 'none', lineStyle: { width: 1.6, color: i === 0 ? C.navy : C.terra }, itemStyle: { color: i === 0 ? C.navy : C.terra }, areaStyle: { color: 'rgba(231,179,58,.14)' }, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: 'dashed', color: C.terra, opacity: .45 }, data: [{ yAxis: 55 }] } }],
    });
  });
}

function detailCompare() {
  const aId = defaultCompareA();
  const bId = defaultCompareB(aId);
  state.compareA = aId; state.compareB = bId;
  const opts = (sel) => filteredStations().slice().sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.id)} · ${esc(s.city)}</option>`).join('');
  return {
    key: 'compare',
    wide: true,
    kicker: `Perbandingan stasiun · ${DATA.view.label}`,
    title: 'Bandingkan profil',
    chip: `${aId} vs ${bId}`,
    body: `<div class="compare-pick">
      <label class="filter-group"><span class="filter-label">Stasiun A</span><select class="select wide" data-compare="a">${opts(aId)}</select></label>
      <label class="filter-group"><span class="filter-label">Stasiun B</span><select class="select wide" data-compare="b">${opts(bId)}</select></label>
    </div>
    <div class="compare-2" id="compare-body"></div>
    <div class="table-wrap" style="height:auto;max-height:260px"><table class="data" id="compare-table"></table></div>
    <div class="detail-note">Selisih relatif terhadap stasiun B; kelayakan dihitung dalam poin persentase.</div>`,
    after: (root) => {
      renderCompare(root);
      root.querySelectorAll('[data-compare]').forEach((sel) => sel.addEventListener('change', () => {
        if (sel.dataset.compare === 'a') state.compareA = sel.value;
        else state.compareB = sel.value;
        const next = detailCompare();
        state.detail = next;
        $('#detail-kicker').textContent = next.kicker;
        $('#detail-title').textContent = next.title;
        $('#detail-body').innerHTML = next.body;
        next.after($('#detail-body'));
        renderBackChip();
      }));
    },
  };
}

const POLL_META = [
  ['pm10', 'PM10', 'µg/m³'],
  ['so2', 'SO2', 'µg/m³'],
  ['no2', 'NO2', 'µg/m³'],
  ['o3', 'O3', 'µg/m³'],
  ['co', 'CO', 'µg/m³'],
  ['temp', 'Suhu', '°C'],
  ['hum', 'Kelembapan', '%'],
  ['wind', 'Angin', 'm/s'],
];

function pollutantAt(stationId, iso) {
  const rows = (DATA.pollutants.stations || {})[stationId] || [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i][0] === iso) {
      return Object.fromEntries(DATA.pollutants.keys.map((k, j) => [k, rows[i][j + 1]]));
    }
    if (rows[i][0] < iso) break;
  }
  return null;
}

function metricRow(k, v, u) {
  return `<div class="metric"><div class="metric-label">${k}</div><div class="metric-value">${v} <small>${u}</small></div></div>`;
}

function renderProfile(st) {
  if (!st) {
    return `<div class="empty"><svg viewBox="0 0 24 24"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg><div>Pilih stasiun</div></div>`;
  }
  const today = pollutantAt(st.id, state.date);
  const todayRows = [
    ['PM2.5', st.day_value == null ? '—' : fmt(st.day_value, 1), 'µg/m³'],
    ...POLL_META.map(([k, label, unit]) => [label, today && today[k] != null ? fmt(today[k], 1) : '—', unit]),
  ];
  const rangeStat = DATA.view.byStation[st.id] || {};
  const rangeRows = [
    ['Rata-rata', fmt(st.mean_2026, 1), 'µg/m³'],
    ['P95', fmt(st.p95_2026, 1), 'µg/m³'],
    ['Maks', fmt(st.max_2026, 1), 'µg/m³'],
    ['Hari', fmtInt(st.days_2026), 'hari'],
    ['Hari >55', fmtInt(rangeStat.above55_n || 0), 'hari'],
  ];
  const fixedRows = [
    ['Layak', fmt(st.usable_pct, 1), '%'],
    ['Baseline', fmt(st.baseline, 1), 'µg/m³'],
    ['Lalu lintas', fmtInt(st.traffic), '/jam'],
    ['Jarak jalan', fmtInt(st.distance), 'm'],
  ];
  const ranked = filteredStations()
    .filter((s) => s.mean_2026 != null)
    .slice()
    .sort((a, b) => b.mean_2026 - a.mean_2026);
  const idx = ranked.findIndex((r) => r.id === st.id);
  const rank = idx >= 0 ? `${idx + 1}/${ranked.length}` : '—';
  const nat = DATA.overview.kpis.find((k) => k.id === 'national').value;
  const vs = st.mean_2026 == null ? null : st.mean_2026 / nat;
  const sensor = st.sensor;
  const instruments = st.instruments || [];
  const sensorTone = sensor ? (sensor.status === 'Active' ? 'baik' : sensor.status === 'Intermittent' ? 'perhatian' : 'terbatas') : '';
  const sensorBlock = sensor ? `
    <div class="sensor-block">
      <div class="sensor-head"><span class="sensor-title">Sensor</span><span class="badge ${sensorTone}">${esc(sensor.status)}</span></div>
      <div class="sensor-meta"><b class="mono">${esc(sensor.id)}</b> · ${esc(sensor.model)}</div>
      <div class="sensor-meta">${esc(sensor.mounting)} · terpasang ${esc(fmtDateISO(sensor.installed))}</div>
      <details class="sensor-acc">
        <summary>${instruments.length} instrumen & satuan</summary>
        <div class="sensor-rows">${instruments.map((i) => `<div class="sensor-row"><span>${esc(i.pollutant)}</span><span class="sensor-eq">${esc(i.equipment)}</span><span class="sensor-unit">${i.converted ? '<span class="badge est">ppm → µg/m³</span>' : esc(unitLabel(i.unit_raw))}</span></div>`).join('')}</div>
      </details>
    </div>` : '';
  return `<div class="profile">
    <div class="profile-head">
      <div><div class="profile-name">${esc(st.id)}</div><div class="profile-sub">${esc(st.city)} · ${esc(st.province)}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${catBadge(st.day_category)}${statusBadge(st.status)}${st.lower_bound ? '<span class="badge est">≥999 batas bawah</span>' : ''}</div>
    </div>
    <div class="detail-label">Pada ${esc(shortDate(state.date))}</div>
    <div class="metric-grid">${todayRows.map(([k, v, u]) => metricRow(k, v, u)).join('')}</div>
    ${state.range === 'hari' ? '' : `<div class="detail-label">Rentang ${esc(DATA.view.label)}</div>
    <div class="metric-grid">${rangeRows.map(([k, v, u]) => metricRow(k, v, u)).join('')}</div>`}
    ${sensorBlock}
    <div class="detail-list">
      <div class="row"><span>Peringkat ${esc(DATA.view.name)}</span><b>${rank}</b></div>
      <div class="row"><span>Vs nasional</span><b>${vs == null ? '—' : fmt(vs, 1) + '×'}</b></div>
      <div class="row"><span>Tipe situs</span><b>${esc(st.site_class)}</b></div>
      <div class="row"><span>Data lolos pemeriksaan</span><b>${fmt(st.valid_pct, 1)}%</b></div>
      <div class="row"><span>Hari layak · 2024–2026</span><b>${st.usable_days}/${st.total_days}</b></div>
      ${st.issues ? `<div class="row"><span>Catatan</span><b>${esc(st.issues)}</b></div>` : ''}
    </div>
  </div>`;
}

function makeProfileSpark(st) {
  const el = $('#profile-spark');
  if (!el) return;
  const rows = DATA.time.station_monthly[st.id] || [];
  makeChart('profile-spark', {
    aria: { enabled: true },
    grid: { left: 6, right: 8, top: 6, bottom: 18 },
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${p.axisValue}</b><br>${fmt(p.value, 1)} µg/m³` },
    xAxis: { type: 'category', data: rows.map((r) => monthLabel(r.month)), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 7.5, interval: 5 } },
    yAxis: { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
    series: [{ type: 'line', data: rows.map((r) => r.pm25), smooth: false, symbol: 'none', lineStyle: { width: 1.6, color: C.navy }, itemStyle: { color: C.navy }, areaStyle: { color: 'rgba(231,179,58,.14)' }, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: 'dashed', color: C.terra, opacity: .45 }, data: [{ yAxis: 55 }] } }],
  });
}

function ispuLegend() {
  return Object.entries(CAT_COLORS).map(([k, v]) => `<div class="row"><span class="sw" style="background:${v}"></span>${esc(k)}</div>`).join('');
}
function usableLegend() {
  return `<div class="row"><span class="sw" style="background:${C.teal}"></span>≥95%</div><div class="row"><span class="sw" style="background:${C.yellow}"></span>80–95%</div><div class="row"><span class="sw" style="background:${C.terra}"></span>&lt;80%</div>`;
}


/* ------------------------------------------------------------------ sources */
function sourceRows() {
  const rows = DATA.sources.all;
  if (state.island === 'Semua') return rows;
  return rows.filter((r) => {
    const st = DATA.stationsById.get(r.station);
    return st && st.island === state.island;
  });
}

function pearson(rows, key) {
  const pts = rows.filter((r) => r[key] != null && r.pm25 != null);
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((a, r) => a + r[key], 0) / n;
  const my = pts.reduce((a, r) => a + r.pm25, 0) / n;
  let num = 0, dx = 0, dy = 0;
  pts.forEach((r) => {
    num += (r[key] - mx) * (r.pm25 - my);
    dx += (r[key] - mx) ** 2;
    dy += (r.pm25 - my) ** 2;
  });
  const den = Math.sqrt(dx * dy);
  return den ? { r: num / den, n } : null;
}

function renderSource() {
  const mode = 'all';
  const rows = sourceRows();
  const corr = {
    baseline: pearson(rows, 'baseline'),
    distance: pearson(rows, 'distance'),
    traffic: pearson(rows, 'traffic'),
  };
  const corrDisplay = corr;
  const pmCorr = DATA.sources.pollutant_matrix ? DATA.sources.pollutant_matrix.matrix[0][1] : null;
  const scopeNote = state.station ? `${scopeLabel()} · korelasi skala ${state.island === 'Semua' ? 'nasional' : state.island}` : `${scopeLabel()}`;
  const kpis = [
    { id: 'cb', label: 'Nilai Korelasi baseline', value: corrDisplay.baseline ? fmtR(corrDisplay.baseline.r) : '—', unit: '', baseline: corrDisplay.baseline ? `n=${corrDisplay.baseline.n}` : '', window: DATA.view.name, note: `Pearson baseline vs rata-rata PM2.5 · ${scopeNote}`,
      tip: [['Definisi', 'Korelasi Pearson baseline situs vs rata-rata PM2.5 tiap stasiun'], ['Cakupan', scopeNote], ['Rentang', DATA.view.label], ['Sifat', 'Asosiatif, bukan kausal']] },
    { id: 'cd', label: 'Nilai Korelasi jarak jalan', value: corrDisplay.distance ? fmtR(corrDisplay.distance.r) : '—', unit: '', baseline: corrDisplay.distance ? `n=${corrDisplay.distance.n}` : '', window: 'm', note: `Pearson jarak ke jalan vs rata-rata PM2.5; semakin jauh → cenderung lebih rendah · ${scopeNote}`,
      tip: [['Definisi', 'Korelasi Pearson jarak ke jalan (meter) vs rata-rata PM2.5 tiap stasiun'], ['Cakupan', scopeNote], ['Arah', 'Negatif = makin jauh makin rendah'], ['Sifat', 'Asosiatif, bukan kausal']] },
    { id: 'ct', label: 'Nilai Korelasi lalu lintas', value: corrDisplay.traffic ? fmtR(corrDisplay.traffic.r) : '—', unit: '', baseline: corrDisplay.traffic ? `n=${corrDisplay.traffic.n}` : '', window: '/jam', note: `Pearson volume lalu lintas vs rata-rata PM2.5 · ${scopeNote}`,
      tip: [['Definisi', 'Korelasi Pearson volume kendaraan/jam vs rata-rata PM2.5 tiap stasiun'], ['Cakupan', scopeNote], ['Rentang', DATA.view.label], ['Sifat', 'Asosiatif, bukan kausal']] },
    { id: 'pm', label: 'Nilai Korelasi PM2.5–PM10', value: pmCorr == null ? '—' : fmtR(pmCorr), unit: '', baseline: DATA.sources.pollutant_matrix ? `n=${fmtInt(DATA.sources.pollutant_matrix.n)} hari-stasiun` : '', window: '2024–2026', note: 'Korelasi pooled hari-stasiun PM2.5 vs PM10 · seluruh periode',
      tip: [['Definisi', 'Korelasi Pearson PM2.5 vs PM10 pada tingkat hari-stasiun'], ['Cakupan', 'Seluruh periode 2024–2026'], ['Sifat', 'Asosiatif, bukan kausal']] },
  ].map(kpiCard2).join('');
  const scopeMeans = sourceScopeMeans();
  const pollutants = scopeMeans.pollutants;
  const meteoMeans = scopeMeans.meteo;
  const windStations = filteredSourceStations();
  const windDefault = (windStations.includes(state.station) ? state.station : (windStations.includes(state.windStation) ? state.windStation : windStations[0])) || '';
  const windOptions = windStations.map((s) => `<option ${s === windDefault ? 'selected' : ''}>${s}</option>`).join('');
  return `${pageHead('Sumber', `${DATA.view.label} · korelasi tingkat stasiun · asosiasi, bukan kausal`, `<span class="badge est" data-tip="Korelasi Pearson pada tingkat stasiun; bukan klaim kausal">Asosiasi, bukan kausal</span>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="grid-12">
      ${card('Baseline vs PM2.5', `X baseline µg/m³ · Y ${DATA.view.label} µg/m³`, `<div class="chart" id="scatter-baseline"></div>`, { cls: 'span-4 h-320', right: `<div class="card-sub">r ${corrDisplay.baseline ? fmtR(corrDisplay.baseline.r) : ''} · garis 55</div>`, period: 'range' })}
      ${card('Jarak jalan vs PM2.5', `X meter (log) · Y ${DATA.view.label} µg/m³`, `<div class="chart" id="scatter-distance"></div>`, { cls: 'span-4 h-320', right: `<div class="card-sub">r ${corrDisplay.distance ? fmtR(corrDisplay.distance.r) : ''} · garis 55</div>`, period: 'range' })}
      ${card('Lalu lintas vs PM2.5', `X kendaraan/jam · Y ${DATA.view.label} µg/m³`, `<div class="chart" id="scatter-traffic"></div>`, { cls: 'span-4 h-320', right: `<div class="card-sub">r ${corrDisplay.traffic ? fmtR(corrDisplay.traffic.r) : ''} · garis 55</div>`, period: 'range' })}
    </div>
    <div class="grid-12">
      ${card('Korelasi polutan × meteorologi', `nilai korelasi · ${scopeNote}`, `<div class="chart" id="chart-meteo-corr"></div>`, { cls: 'span-6 h-340', right: '<div class="card-sub">klik sel untuk rincian</div>', period: 'range' })}
      <section class="card span-6 h-340">
        <div class="card-head"><div class="card-title">Rata-rata polutan</div><div class="card-head-right"><div class="card-sub">${esc(scopeNote)}</div><div class="card-sub period">${esc(periodText('range'))}</div></div></div>
        <div class="card-body"><div class="stat-grid">${pollutants.map((r) => `<div class="stat-block"><div class="k">${esc(r.label)}</div><div class="v">${fmt(r.value, 1)} <small>${esc(r.unit)}</small></div><div class="n">n = ${fmtInt(r.n)}</div></div>`).join('')}</div></div>
      </section>
    </div>
    <div class="grid-12">
      ${card('Matriks korelasi polutan', 'Pearson · pooled hari-stasiun · 2024–2026', `<div class="chart" id="chart-pollutant-matrix"></div>`, { cls: 'span-6 h-340', right: '<div class="card-sub">PM2.5 · PM10 · SO2 · NO2 · O3 · CO</div>', period: 'full' })}
      <section class="card span-6 h-340">
        <div class="card-head"><div class="card-title">Arah angin</div><div class="card-head-right"><label class="filter-group"><span class="filter-label">Stasiun</span><select class="select" id="wind-station">${windOptions}</select></label><div class="card-sub">16 sektor · 5 kelas</div><div class="card-sub period">${esc(periodText('full'))}</div></div></div>
        <div class="card-body"><div class="chart" id="chart-windrose"></div></div>
      </section>
    </div>
    <div class="grid-12">
      <section class="card span-12 h-auto">
        <div class="card-head"><div class="card-title">Meteorologi</div><div class="card-head-right"><div class="card-sub">rata-rata · ${esc(scopeNote)}</div><div class="card-sub period">${esc(periodText('range'))}</div></div></div>
        <div class="card-body"><div class="stat-grid">${meteoMeans.map((r) => `<div class="stat-block"><div class="k">${esc(r.label)}</div><div class="v">${fmt(r.value, 1)} <small>${esc(r.unit)}</small></div><div class="n">n = ${fmtInt(r.n)}</div></div>`).join('')}</div></div>
      </section>
    </div>
  </div>`;
}
function filteredSourceStations() {
  const rows = DATA.sources.all;
  return rows.filter((r) => state.island === 'Semua' || r.island === state.island).map((r) => r.station);
}

/* Stasiun acuan wind rose: ikut filter stasiun bila ada, kalau tidak pilihan terakhir. */
function windStationId() {
  const list = filteredSourceStations();
  if (state.station && list.includes(state.station)) return state.station;
  if (state.windStation && list.includes(state.windStation)) return state.windStation;
  return list[0] || null;
}

/* Rata-rata polutan & meteorologi untuk cakupan aktif (stasiun bila dipilih,
   kalau tidak pulau/nasional) pada rentang aktif. Semua dari data/*.json. */
function sourceScopeMeans() {
  const keys = (DATA.pollutants && DATA.pollutants.keys) || [];
  const [from, to] = rangeBounds();
  const ids = state.station ? [state.station] : filteredSourceStations();
  const acc = {};
  keys.forEach((k) => { acc[k] = { s: 0, n: 0 }; });
  let pmSum = 0;
  let pmN = 0;
  ids.forEach((id) => {
    const rows = (DATA.pollutants.stations || {})[id] || [];
    const dayIdx = DATA.stationDayIndex ? DATA.stationDayIndex[id] : null;
    rows.forEach((r) => {
      if (r[0] < from || r[0] > to) return;
      keys.forEach((k, i) => {
        const v = r[i + 1];
        if (v == null) return;
        acc[k].s += v;
        acc[k].n += 1;
      });
      const pm = dayIdx ? dayIdx.get(r[0]) : null;
      if (pm != null) { pmSum += pm; pmN += 1; }
    });
  });
  const val = (k) => (acc[k] && acc[k].n ? round1(acc[k].s / acc[k].n) : null);
  return {
    pollutants: (DATA.sources.pollutants || []).map((p) => ({
      ...p,
      value: p.key === 'pm25' ? (pmN ? round1(pmSum / pmN) : null) : val(p.key),
      n: p.key === 'pm25' ? pmN : (acc[p.key] ? acc[p.key].n : 0),
    })),
    meteo: (DATA.sources.meteo || []).map((p) => ({ ...p, value: val(p.key), n: acc[p.key] ? acc[p.key].n : 0 })),
    stations: ids.length,
  };
}

function afterSource() {
  const rows = sourceRows();
  const yName = `PM2.5 ${DATA.view.label} (µg/m³)`;
  makeScatter('scatter-baseline', rows, 'baseline', false, 'Baseline (µg/m³)', yName);
  makeScatter('scatter-distance', rows, 'distance', true, 'Jarak ke jalan (m, log)', yName);
  makeScatter('scatter-traffic', rows, 'traffic', false, 'Lalu lintas (kendaraan/jam)', yName);
  makePollutantMatrix();
  makeMeteoCorrChart();
  makeWindrose();
  const windSel = $('#wind-station');
  if (windSel) windSel.addEventListener('change', () => { state.windStation = windSel.value; makeWindrose(); });
}
function makePollutantMatrix() {
  const p = DATA.sources.pollutant_matrix;
  if (!p) return null;
  const labels = p.labels;
  const data = [];
  p.matrix.forEach((row, i) => row.forEach((v, j) => data.push({ value: [j, i, v], label: { color: v != null && Math.abs(v) > 0.45 ? '#FFFFFF' : C.navy } })));
  const chart = makeChart('chart-pollutant-matrix', {
    aria: { enabled: true },
    grid: { left: 74, right: 20, top: 8, bottom: 48 },
    tooltip: { ...tooltipBase(), formatter: (pp) => `<b>${labels[pp.value[0]]} vs ${labels[pp.value[1]]}</b><br>r = ${pp.value[2] == null ? '—' : fmtR(pp.value[2])} · n = ${fmtInt(p.n)}` },
    xAxis: { type: 'category', data: labels, axisLabel: { color: C.muted, fontSize: 8.5 }, axisTick: { show: false }, position: 'bottom' },
    yAxis: { type: 'category', data: labels, axisLabel: { color: C.navy, fontSize: 8.5 }, axisTick: { show: false }, inverse: true },
    visualMap: { show: false, dimension: 2, min: -1, max: 1, inRange: { color: ['#D9663F', '#F6F3EC', '#182048'] } },
    series: [{ type: 'heatmap', data, label: { show: true, fontSize: 8, color: C.navy, formatter: (pp) => pp.value[2] == null ? '' : fmt(pp.value[2], 2) }, itemStyle: { borderColor: C.paper, borderWidth: 1 } }],
  });
  pickByPixel(chart, document.getElementById('chart-pollutant-matrix'), 'x', (col, rowV) => {
    const i = Math.round(Number(rowV));
    const j = col;
    if (i < 0 || j < 0 || i >= labels.length || j >= labels.length || i === j) return;
    const spec = detailPollutantPair(labels[i], labels[j]);
    if (spec) openDetail(spec);
  });
  return chart;
}
function makeWindrose() {
  const id = windStationId();
  const w = id ? DATA.sources.windrose[id] : null;
  if (!w) return null;
  const dirs = ['U', 'UTL', 'TL', 'TTL', 'T', 'TTR', 'TGR', 'TS', 'S', 'SB', 'STB', 'ST', 'B', 'BB', 'BBL', 'BS'];
  const speedLabels = ['0–0,5', '0,5–1,5', '1,5–3,3', '3,3–5,5', '>5,5'];
  const colors = ['#FFF3BF', '#E3A008', '#D9663F', '#B3261E', '#182048'];
  const series = colors.map((color, i) => ({ name: speedLabels[i], type: 'bar', coordinateSystem: 'polar', data: w.matrix.map((row) => row[i]), stack: 'wind', itemStyle: { color, opacity: .9 } }));
  const chart = makeChart('chart-windrose', {
    aria: { enabled: true },
    polar: { center: ['50%', '52%'], radius: '68%' },
    angleAxis: { type: 'category', data: dirs, axisLabel: { color: C.muted, fontSize: 8 }, axisLine: { lineStyle: { color: C.line } } },
    radiusAxis: { axisLabel: { color: C.muted, fontSize: 8 }, splitLine: { lineStyle: { color: C.grid } } },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 8, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'item' },
    series,
  });
  pickPolar(chart, document.getElementById('chart-windrose'), (di, radius) => {
    const dir = WIND_DIRS[di];
    if (!dir) return;
    const total = (w.matrix[di] || []).reduce((a, v) => a + v, 0);
    if (radius > total + 0.5) return;
    const spec = detailWindSector(dir);
    if (spec) openDetail(spec);
  });
  return chart;
}

/* Korelasi polutan × meteorologi — dihitung runtime dari data harian
   (pollutants.json) sesuai filter pulau/stasiun + rentang aktif.
   Tidak ada angka yang ditulis manual di HTML. */
const METEO_FIELDS = [
  { key: 'temp', label: 'Suhu' },
  { key: 'hum', label: 'Kelembapan' },
  { key: 'wind', label: 'Angin' },
];
const CORR_POLLUTANTS = [
  { key: 'pm25', label: 'PM2.5' },
  { key: 'pm10', label: 'PM10' },
  { key: 'so2', label: 'SO2' },
  { key: 'no2', label: 'NO2' },
  { key: 'o3', label: 'O3' },
  { key: 'co', label: 'CO' },
];
const METEO_MIN_N = 30;

/* Pasangan (polutan, bidang meteo) → nilai korelasi + n, pada filter aktif.
   PM2.5 diambil dari indeks harian stasiun (data/time.json → station_daily),
   polutan lain & meteorologi dari data/pollutants.json. */
function meteoCorrRows() {
  const keys = (DATA.pollutants && DATA.pollutants.keys) || [];
  const [from, to] = rangeBounds();
  const ids = state.station ? [state.station] : filteredSourceStations();
  const pols = CORR_POLLUTANTS.filter((p) => p.key === 'pm25' || keys.includes(p.key));
  const pairs = pols
    .flatMap((p) => METEO_FIELDS.map((m) => ({ pol: p, met: m, xs: [], ys: [], n: 0 })));

  ids.forEach((id) => {
    const rows = ((DATA.pollutants.stations || {})[id] || []);
    const dayIdx = DATA.stationDayIndex ? DATA.stationDayIndex[id] : null;
    rows.forEach((r) => {
      if (r[0] < from || r[0] > to) return;
      pols.forEach((p) => {
        const y = p.key === 'pm25'
          ? (dayIdx && dayIdx.has(r[0]) ? dayIdx.get(r[0]) : null)
          : r[keys.indexOf(p.key) + 1];
        if (y == null) return;
        METEO_FIELDS.forEach((m) => {
          const x = r[keys.indexOf(m.key) + 1];
          if (x == null) return;
          const pair = pairs.find((pp) => pp.pol.key === p.key && pp.met.key === m.key);
          pair.xs.push(x);
          pair.ys.push(y);
          pair.n += 1;
        });
      });
    });
  });

  return pairs.map((pair) => {
    if (pair.n < METEO_MIN_N) return { pol: pair.pol, met: pair.met, r: null, n: pair.n };
    const mx = pair.xs.reduce((a, b) => a + b, 0) / pair.n;
    const my = pair.ys.reduce((a, b) => a + b, 0) / pair.n;
    let num = 0; let dx = 0; let dy = 0;
    for (let i = 0; i < pair.n; i += 1) {
      const a = pair.xs[i] - mx;
      const b = pair.ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    const den = Math.sqrt(dx * dy);
    return { pol: pair.pol, met: pair.met, r: den ? Math.round(num / den * 1000) / 1000 : null, n: pair.n };
  });
}

function makeMeteoCorrChart() {
  const rows = meteoCorrRows();
  const usable = rows.filter((r) => r.r != null);

  /* Tanpa nilai sama sekali (rentang 1 hari, atau stasiun tanpa baris polutan/meteo):
     tampilkan keterangan, bukan grid "—" yang terbaca sebagai chart rusak. */
  if (!usable.length) {
    const el = document.getElementById('chart-meteo-corr');
    if (el) {
      const maxN = rows.reduce((m, r) => Math.max(m, r.n), 0);
      el.innerHTML = `<div class="empty"><div>Tidak ada nilai korelasi pada rentang ini</div><div class="card-sub">${maxN ? `n maksimum ${fmtInt(maxN)} hari-stasiun` : 'stasiun ini tidak punya baris polutan/meteo'} · butuh ≥ ${METEO_MIN_N} per pasangan</div></div>`;
    }
    return null;
  }

  /* Skala warna mengikuti besaran data: korelasi satu stasiun jarang melewati ±0,2,
     sehingga skala tetap -1..1 membuat semua sel nyaris sewarna latar. */
  const maxAbs = Math.max(...usable.map((r) => Math.abs(r.r)));
  const cap = Math.max(0.2, Math.ceil(maxAbs * 10) / 10);

  const pols = CORR_POLLUTANTS.filter((p) => rows.some((r) => r.pol.key === p.key));
  const data = [];
  pols.forEach((p, pi) => {
    METEO_FIELDS.forEach((m, mi) => {
      const row = rows.find((r) => r.pol.key === p.key && r.met.key === m.key);
      data.push({ value: [mi, pi, row && row.r != null ? row.r : null, row ? row.n : 0] });
    });
  });
  const chart = makeChart('chart-meteo-corr', {
    aria: { enabled: true },
    grid: { left: 54, right: 16, top: 22, bottom: 24, containLabel: true },
    tooltip: {
      ...tooltipBase(),
      formatter: (pp) => {
        const v = pp.value;
        const pol = pols[v[1]] ? pols[v[1]].label : '';
        const met = METEO_FIELDS[v[0]] ? METEO_FIELDS[v[0]].label : '';
        return `<b>${esc(pol)} vs ${esc(met)}</b><br>Nilai korelasi ${v[2] == null ? '—' : fmtR(v[2])}<br>n = ${fmtInt(v[3])} hari-stasiun<br><span style="opacity:.7">skala warna ±${fmt(cap, 1)}</span>`;
      },
    },
    xAxis: { type: 'category', data: METEO_FIELDS.map((m) => m.label), axisLabel: { color: C.navy, fontSize: 9 }, axisTick: { show: false }, splitArea: { show: false } },
    yAxis: { type: 'category', data: pols.map((p) => p.label), axisLabel: { color: C.navy, fontSize: 9 }, axisTick: { show: false }, inverse: true },
    visualMap: { show: false, dimension: 2, min: -cap, max: cap, inRange: { color: ['#D9663F', '#F6F3EC', '#182048'] } },
    series: [{
      type: 'heatmap',
      data,
      itemStyle: { borderColor: C.paper, borderWidth: 1 },
      label: {
        show: true,
        fontSize: 9,
        fontFamily: 'IBM Plex Mono',
        formatter: (pp) => (pp.value[2] == null ? '—' : fmt(pp.value[2], 2)),
      },
      emphasis: { itemStyle: { borderColor: C.navy, borderWidth: 1.4 } },
    }],
  });
  if (chart) {
    chart.off('click');
    chart.on('click', (pp) => {
      const v = pp.value || [];
      const pol = pols[v[1]];
      const met = METEO_FIELDS[v[0]];
      if (!pol || !met) return;
      const row = rows.find((r) => r.pol.key === pol.key && r.met.key === met.key);
      if (!row) return;
      const spec = detailMeteoPair(row);
      if (spec) openDetail(spec);
    });
  }
  return chart;
}

function detailMeteoPair(row) {
  const strength = row.r == null ? '—' : Math.abs(row.r) >= 0.7 ? 'Kuat' : Math.abs(row.r) >= 0.4 ? 'Sedang' : 'Lemah';
  const direction = row.r == null ? '—' : row.r < 0 ? 'Berlawanan arah' : 'Searah';
  const body = `
    ${detailMetrics([
      ['Nilai korelasi', row.r == null ? '—' : fmtR(row.r), ''],
      ['Kekuatan', strength, ''],
      ['Observasi', fmtInt(row.n), 'hari-stasiun'],
    ])}
    <div class="detail-list">
      <div class="row"><span>Arah hubungan</span><b>${esc(direction)}</b></div>
      <div class="row"><span>Polutan</span><b>${esc(row.pol.label)}</b></div>
      <div class="row"><span>Meteorologi</span><b>${esc(row.met.label)}</b></div>
      <div class="row"><span>Rentang</span><b>${esc(DATA.view.label)}</b></div>
    </div>
    <div class="detail-note">Rata-rata harian per stasiun · asosiasi, bukan sebab-akibat</div>`;
  return {
    key: `meteo:${row.pol.key}:${row.met.key}`,
    kicker: 'Korelasi polutan × meteorologi',
    title: `${row.pol.label} vs ${row.met.label}`,
    chip: row.pol.label,
    body,
  };
}

function makeScatter(id, rows, xKey, logX, xName = xKey, yName = 'PM2.5 2026 (µg/m³)') {
  const pts = rows.map((r) => [r[xKey], r.pm25, r.days, r.station, r.status, r.island, r.episode_days]);
  const xvals = pts.map((p) => logX ? Math.log10(Math.max(1, p[0])) : p[0]);
  const yvals = pts.map((p) => p[1]);
  const n = pts.length;
  const mx = xvals.reduce((a, b) => a + b, 0) / n;
  const my = yvals.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xvals[i] - mx) * (yvals[i] - my); den += (xvals[i] - mx) ** 2; }
  const b = den ? num / den : 0;
  const a = my - b * mx;
  const xmin = Math.min(...xvals), xmax = Math.max(...xvals);
  const lx0 = logX ? Math.pow(10, xmin) : xmin;
  const lx1 = logX ? Math.pow(10, xmax) : xmax;
  const line = [[lx0, a + b * xmin], [lx1, a + b * xmax]];
  // Style per-titik dihitung di sini: callback itemStyle.borderColor/borderWidth/opacity
  // tidak dievaluasi oleh build ECharts yang dipakai (titik jadi tak ter-render).
  const scatterData = pts.map((v) => {
    const sel = !!state.station && v[3] === state.station;
    return {
      value: v,
      symbolSize: sel ? 13 : 5 + Math.min(9, Math.sqrt(v[6] || v[2]) / 3.5),
      itemStyle: {
        color: ISLAND_COLORS[v[5]] || C.navy,
        borderColor: sel ? C.navy : C.paper,
        borderWidth: sel ? 2 : 1,
        opacity: state.station && !sel ? 0.42 : 1,
      },
    };
  });
  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: { left: 52, right: 14, top: 18, bottom: 38 },
    tooltip: {
      ...tooltipBase(),
      formatter: (p) => {
        if (p.seriesType === 'line') return '';
        return `<b>${esc(p.value[3])}</b><br>${esc(xName)}: ${fmt(p.value[0], 1)}<br>${esc(yName)}: ${fmt(p.value[1], 1)} µg/m³<br>episode ${fmtInt(p.value[6] || 0)} hari · ${esc(p.value[5] || '')} · ${esc(p.value[4])}`;
      },
    },
    xAxis: {
      type: logX ? 'log' : 'value',
      min: logX ? 5 : undefined,
      name: xName,
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { fontSize: 8.5, color: C.muted },
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 8.5, formatter: (v) => fmtInt(v) },
      splitLine: { lineStyle: { color: C.grid } },
    },
    yAxis: {
      type: 'value',
      name: yName,
      nameLocation: 'middle',
      nameGap: 42,
      nameTextStyle: { fontSize: 8.5, color: C.muted },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 8.5 },
      splitLine: { lineStyle: { color: C.grid } },
    },
    series: [
      {
        type: 'scatter',
        data: scatterData,
        emphasis: { itemStyle: { color: C.yellow, borderColor: C.navy }, label: { show: true } },
        label: {
          show: true,
          position: 'top',
          fontSize: 7.5,
          color: C.muted,
          distance: 4,
          formatter: (p) => {
            if (p.value[3] === state.station) return p.value[3];
            return (p.value[1] > 250 || p.value[0] > 400 || p.value[3] === 'KTG-02' || p.value[3] === 'KTG-01' || p.value[3] === 'SM2-01') ? p.value[3] : '';
          },
        },
        labelLayout: { hideOverlap: true },
        // Label garis PP dilepas dari kanvas (crowded 15 label stasiun);
        // keterangan ambang ada di header kartu.
        markLine: markLinePP({ ...ppItem('y', 55, 'PP 55', C.yellow), label: { show: false } }),
      },
      {
        type: 'line',
        data: line,
        showSymbol: false,
        silent: true,
        lineStyle: { type: 'dashed', width: 1.4, color: C.terra, opacity: .7 },
      },
    ],
  });
  chart.on('click', (p) => {
    if (p.seriesType !== 'scatter') return;
    const id = p.value[3];
    if (!id) return;
    const spec = detailSourceStation(id);
    if (spec) openDetail(spec);
  });
  return chart;
}

/* ------------------------------------------------------------------ health */
function renderHealth() {
  const y = healthSpan();
  const scope = state.island === 'Semua' ? 'nasional' : state.island;
  const meta = `${DATA.view.label} · ${y.days} hari · ${scope} · kunjungan aktual`;
  const stations = healthStations();
  const totalResp = stations.reduce((a, r) => a + (r.resp_actual || 0), 0);
  const totalUnder5 = stations.reduce((a, r) => a + (r.resp_under5_actual || 0), 0);
  const totalOver60 = stations.reduce((a, r) => a + (r.resp_over60_actual || 0), 0);
  const under5Share = totalResp ? totalUnder5 / totalResp * 100 : null;
  const over60Share = totalResp ? totalOver60 / totalResp * 100 : null;
  const lag0 = healthLag()['0'] ? healthLag()['0'].resp : null;
  const healthTab = state.healthTable === 'rs' ? 'rs' : 'stasiun';
  const hospitalMeta = DATA.hospitals.meta;
  const stationPerHospital = new Set((DATA.hospitals.hospitals || []).map((h) => h.station)).size;
  const kpis = [
    { id: 'total', label: 'Kunjungan respirasi', value: totalResp, unit: 'kasus', baseline: `${y.days} hari · ${DATA.hospitals.meta.count} RS`, window: DATA.view.name, note: `aktual ${scope} · ${DATA.view.label}`,
      tip: [['Definisi', 'Jumlah kunjungan respirasi tercatat'], ['Cakupan', `${y.days} hari · ${DATA.hospitals.meta.count} RS · ${DATA.hospitals.meta.beds_total.toLocaleString('id-ID')} tempat tidur`], ['Rentang', DATA.view.label], ['Sifat', 'Beban layanan, bukan insidensi penduduk']],
      tipNote: 'Bukan kasus yang diatribusikan ke PM2.5.' },
    { id: 'under5', label: 'Kunjungan respirasi · balita', value: under5Share, unit: '%', baseline: `${fmtInt(totalUnder5)} kunjungan`, window: 'porsi respirasi', note: `porsi kunjungan balita dari total respirasi · ${DATA.view.label}`,
      tip: [['Definisi', 'Kunjungan balita ÷ total kunjungan respirasi'], ['Hitung', `${fmtInt(totalUnder5)} dari ${fmtInt(totalResp)} kunjungan`], ['Cakupan', `${y.days} hari · ${scope}`], ['Rentang', DATA.view.label]] },
    { id: 'over60', label: 'Kunjungan respirasi · lansia', value: over60Share, unit: '%', baseline: `${fmtInt(totalOver60)} kunjungan`, window: 'porsi respirasi', note: `porsi kunjungan usia 60+ dari total respirasi · ${DATA.view.label}`,
      tip: [['Definisi', 'Kunjungan usia 60+ ÷ total kunjungan respirasi'], ['Hitung', `${fmtInt(totalOver60)} dari ${fmtInt(totalResp)} kunjungan`], ['Cakupan', `${y.days} hari · ${scope}`], ['Rentang', DATA.view.label]] },
    { id: 'lag0', label: 'Asosiasi lag 0', value: lag0, unit: '', baseline: 'r anomali · hari sama', window: '2024–2026', note: 'Korelasi anomali PM2.5 dan kunjungan respirasi pada hari yang sama',
      tip: [['Definisi', 'Pearson anomali PM2.5 vs anomali kunjungan, hari sama'], ['Cakupan', '2024–2026 · minimal 30 hari tumpang tindih'], ['Rentang', '−1 sampai +1'], ['Sifat', 'Asosiatif, bukan kausal']] },
  ].map((k) => ({ ...k, value: k.id === 'lag0' ? fmtR(k.value) : k.id === 'total' ? fmtInt(k.value) : fmt(k.value, 1) })).map(kpiCard2).join('');
  return `${pageHead('Kesehatan', meta, `<span class="badge est" data-tip="Kunjungan rumah sakit yang tercatat. Bukan estimasi kasus akibat PM2.5.">Kunjungan aktual</span>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="rs-strip">
      <span class="status-chip"><b>${fmtInt(hospitalMeta.count)}</b> rumah sakit mitra</span>
      <span class="status-chip"><b>${fmtInt(hospitalMeta.beds_total)}</b> tempat tidur</span>
      <span class="status-chip"><b>${fmt(hospitalMeta.count / Math.max(1, stationPerHospital), 0)}</b> RS per stasiun</span>
      <span class="status-chip total">${esc(DATA.view.label)} · <b>${fmtInt(y.days)}</b> hari</span>
    </div>
    <div class="grid-12">
      ${card('Kunjungan per kategori', `kasus · ${y.days} hari`, `<div class="chart" id="chart-health"></div>`, { cls: 'span-7 h-340', right: '<div class="card-sub">aktual</div>', period: 'range' })}
      ${card('Kunjungan per tahun', 'kasus · rentang sama tiap tahun', `<div class="chart" id="chart-health-year"></div>`, { cls: 'span-5 h-340', right: '<div class="card-sub">2024–2026</div>', period: 'range' })}
    </div>
    <div class="grid-12">
      <section class="card span-12 h-460">
        <div class="card-head"><div class="card-title">PM2.5 dan kunjungan</div><div class="card-head-right"><div class="card-sub">dua panel · bukan dual axis</div><div class="card-sub period">${esc(periodText('full'))}</div></div></div>
        <div class="card-body" style="display:flex;flex-direction:column"><div class="legend-note" style="padding:5px 12px 0">atas: PM2.5 µg/m³ · bawah: kunjungan harian</div><div style="height:128px;flex:0 0 128px;position:relative"><div class="chart" id="chart-pm-month"></div></div><div style="height:128px;flex:0 0 128px;position:relative"><div class="chart" id="chart-resp-month"></div></div></div>
      </section>
    </div>
    <div class="grid-12">
      <section class="card map-card span-7 h-320">
        <div class="card-head"><div class="card-title">Peta kasus rumah sakit</div><div class="card-head-right"><div class="card-sub">${esc(DATA.view.label)}</div>${provToggleHtml()}</div></div>
        <div class="card-body"><div class="map" id="map-health"></div><div class="map-legend" id="legend-health"></div></div>
      </section>
      ${card('Kunjungan per 100 TT vs PM2.5', `X rata-rata PM2.5 · Y kunjungan/100 TT`, `<div class="chart" id="chart-health-scatter"></div>`, { cls: 'span-5 h-320', right: '<div class="card-sub">µg/m³ · kasus</div>', period: 'range' })}
    </div>
    <div class="grid-12">
      ${card('Lag 0–14', 'r anomali', `<div class="chart" id="chart-lag"></div>`, { cls: 'span-7 h-320', right: '<div class="card-sub">r · lag 0–14</div>', period: 'full' })}
      ${card('Kelompok rentan', 'kunjungan harian · bulanan', `<div class="chart" id="chart-vulnerable"></div>`, { cls: 'span-5 h-320', right: '<div class="card-sub">bulanan</div>', period: 'full' })}
    </div>
    <div class="grid-12">
      <section class="card span-12 h-auto">
        <div class="card-head">
          <div class="card-title">Peringkat</div>
          <div class="card-head-right">
            <div class="seg" role="group" aria-label="Pilih tabel">
              <button type="button" data-health-table="stasiun" class="${healthTab === 'stasiun' ? 'active' : ''}" aria-pressed="${healthTab === 'stasiun'}">Stasiun</button>
              <button type="button" data-health-table="rs" class="${healthTab === 'rs' ? 'active' : ''}" aria-pressed="${healthTab === 'rs'}">Rumah sakit</button>
            </div>
            <div class="card-sub" id="health-table-sub">${healthTab === 'rs' ? per100Unit() : 'r lag 0 tertinggi'}</div>
            <div class="card-sub period">${esc(DATA.view.label)}</div>
          </div>
        </div>
        <div class="card-body"><div class="table-wrap" style="height:auto;max-height:360px"><table class="data" id="health-top-table"></table></div></div>
      </section>
    </div>
    <div class="grid-12">
      <section class="card span-12 h-auto">
        <div class="card-head"><div class="card-title">Kunjungan 7 outcome</div><div class="card-head-right"><div class="card-sub">${y.days} hari · ${esc(DATA.view.label)}</div></div></div>
        <div class="card-body"><div class="stat-grid">${DATA.health.outcomes.map((o) => `<div class="stat-block"><div class="k">${esc(o.label)}</div><div class="v">${fmtInt(y.actual[o.key])} <small>kasus</small></div><div class="n">${y.days} hari · aktual</div></div>`).join('')}</div></div>
      </section>
    </div>
  </div>`;
}

function afterHealth() {
  makeObservedChart();
  makeHealthYearChart();
  makeHealthMonthlyCharts();
  makeHealthCaseMap();
  makeLagMultiChart();
  makeVulnerableChart();
  renderHealthTopTable();
  makeHealthScatter();
}

function makeObservedChart(id = 'chart-health', opts = {}) {
  const el = document.getElementById(id);
  if (!el) return null;
  const y = healthSpan();
  const outcomes = DATA.health.outcomes;
  const actual = outcomes.map((o) => y.actual[o.key] || 0);
  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: opts.grid || { left: 104, right: 64, top: 14, bottom: 20 },
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        return `<b>${outcomes[i].label}</b><br>${fmtInt(actual[i])} kunjungan<br><span style="opacity:.7">${esc(DATA.view.label)}</span>`;
      },
    },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8.5, hideOverlap: true, formatter: (v) => fmtInt(v) } },
    yAxis: { type: 'category', inverse: true, data: outcomes.map((o) => o.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: opts.yFont || 9.5, interval: 0 } },
    series: [
      { name: 'Kunjungan', type: 'bar', data: actual, barWidth: 11, itemStyle: { color: C.navy, borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 8.5, color: C.navy, formatter: (p) => fmtInt(p.value) } },
    ],
  });
  if (!chart) return null;
  pickByPixel(chart, el, 'y', (i) => {
    const o = outcomes[i];
    if (!o) return;
    const spec = detailOutcome(o.key);
    if (spec) openDetail(spec);
  });
  return chart;
}
function makeHealthYearChart() {
  const years = healthYears();
  const chart = makeChart('chart-health-year', {
    aria: { enabled: true },
    grid: { left: 46, right: 12, top: 28, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 9, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: years.map((r) => String(r.year)), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 9 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8.5, formatter: (v) => fmtInt(v) } },
    series: [
      { name: 'Respirasi', type: 'bar', data: years.map((r) => r.actual.resp || 0), barWidth: 22, itemStyle: { color: C.navy, borderRadius: [3, 3, 0, 0] } },
      { name: 'Kematian', type: 'bar', data: years.map((r) => r.actual.death || 0), barWidth: 22, itemStyle: { color: C.terra, borderRadius: [3, 3, 0, 0] } },
    ],
  });
  pickByPixel(chart, document.getElementById('chart-health-year'), 'x', (i) => {
    const r = years[i];
    if (!r) return;
    const spec = detailHealthYear(r.year);
    if (spec) openDetail(spec);
  });
}
function makeHealthMonthlyCharts() {
  const rows = state.island === 'Semua' ? DATA.health.monthly : (DATA.health.monthly_island || []).filter((r) => r.island === state.island);
  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const by = new Map(rows.map((r) => [r.month, r]));
  const pmRows = DATA.time.monthly || [];
  const pmBy = new Map(pmRows.map((r) => [r.month, r.pm25]));
  const x = months.map((m) => monthLabel(m));
  const chartPm = makeChart('chart-pm-month', {
    aria: { enabled: true },
    grid: { left: 40, right: 12, top: 6, bottom: 18 },
    tooltip: { ...tooltipBase(), trigger: 'axis', formatter: (ps) => `<b>${ps[0].axisValue}</b><br>PM2.5 ${fmt(ps[0].value, 1)} µg/m³` },
    xAxis: { type: 'category', data: x, axisLabel: { color: C.muted, fontSize: 7.5, interval: 4 }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    series: [{ type: 'line', data: months.map((m) => pmBy.get(m) ?? null), showSymbol: false, lineStyle: { width: 1.8, color: C.teal }, itemStyle: { color: C.teal }, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: 'dashed', color: C.terra, width: 1, opacity: .6 }, data: [{ yAxis: 55 }] } }],
  });
  const chartResp = makeChart('chart-resp-month', {
    aria: { enabled: true },
    grid: { left: 40, right: 12, top: 6, bottom: 22 },
    tooltip: { ...tooltipBase(), trigger: 'axis', formatter: (ps) => `<b>${ps[0].axisValue}</b><br>${fmt(ps[0].value, 1)} kunjungan/hari` },
    xAxis: { type: 'category', data: x, axisLabel: { color: C.muted, fontSize: 7.5, interval: 4 }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    series: [{ type: 'line', data: months.map((m) => by.get(m) ? by.get(m).resp : null), showSymbol: false, lineStyle: { width: 1.8, color: C.navy }, itemStyle: { color: C.navy } }],
  });
  const pickMonth = (idx) => {
    const m = months[idx];
    if (!m) return;
    const spec = detailHealthMonth(m);
    if (spec) openDetail(spec);
  };
  pickByPixel(chartPm, document.getElementById('chart-pm-month'), 'x', pickMonth);
  pickByPixel(chartResp, document.getElementById('chart-resp-month'), 'x', pickMonth);
}
function makeLagMultiChart() {
  const lag = healthLag();
  const keys = Object.keys(lag).sort((a, b) => Number(a) - Number(b));
  const defs = [
    ['resp', 'Respirasi total', C.navy, false],
    ['resp_admissions_under5', 'Balita', '#C98A12', false],
    ['resp_admissions_over60', 'Lansia', '#7B6BB0', false],
    ['asthma_emergency_cases', 'Asma', '#2F8FB0', true],
    ['copd_admissions', 'PPOK', '#C0453C', true],
  ];
  const all = keys.flatMap((k) => defs.map(([key]) => lag[k][key]).filter((v) => typeof v === 'number' && !Number.isNaN(v)));
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const pad = Math.max(0.005, (hi - lo) * 0.15);
  const chart = makeChart('chart-lag', {
    aria: { enabled: true },
    grid: { left: 42, right: 12, top: 30, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 8, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: keys, axisLabel: { color: C.muted, fontSize: 8 }, axisTick: { show: false } },
    yAxis: { type: 'value', min: Number((lo - pad).toFixed(3)), max: Number((hi + pad).toFixed(3)), splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8, formatter: (v) => fmt(v, 2) } },
    series: defs.map(([key, label, color, dashed]) => ({ name: label, type: 'line', data: keys.map((k) => lag[k][key]), symbol: 'circle', symbolSize: 3, lineStyle: { width: 1.8, color, type: dashed ? 'dashed' : 'solid' }, itemStyle: { color } })),
  });
  pickByPixel(chart, document.getElementById('chart-lag'), 'x', (idx) => {
    const k = keys[idx];
    if (k == null) return;
    const spec = detailLag(k);
    if (spec) openDetail(spec);
  });
}function makeVulnerableChart() {
  const rows = state.island === 'Semua' ? DATA.health.monthly : (DATA.health.monthly_island || []).filter((r) => r.island === state.island);
  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const by = new Map(rows.map((r) => [r.month, r]));
  const chart = makeChart('chart-vulnerable', {
    aria: { enabled: true },
    grid: { left: 42, right: 12, top: 30, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 8, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: months.map((m) => monthLabel(m)), axisLabel: { color: C.muted, fontSize: 7.5, interval: 4 }, axisTick: { show: false } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    series: [
      { name: 'Balita', type: 'line', data: months.map((m) => by.get(m) ? by.get(m).under5 : null), smooth: false, symbol: 'none', lineStyle: { width: 1.8, color: '#C98A12' }, itemStyle: { color: '#C98A12' } },
      { name: 'Lansia', type: 'line', data: months.map((m) => by.get(m) ? by.get(m).over60 : null), smooth: false, symbol: 'none', lineStyle: { width: 1.8, color: '#7B6BB0' }, itemStyle: { color: '#7B6BB0' } },
    ],
  });
  pickByPixel(chart, document.getElementById('chart-vulnerable'), 'x', (idx) => {
    const m = months[idx];
    if (!m) return;
    const spec = detailHealthMonth(m);
    if (spec) openDetail(spec);
  });
}function renderHealthTopTable() {
  const el = $('#health-top-table');
  if (!el) return;
  if (state.healthTable === 'rs') {
    const rows = hospitalRows().slice().sort((a, b) => (b.per100beds || 0) - (a.per100beds || 0)).slice(0, 10);
    el.innerHTML = `<thead><tr><th>Rumah sakit</th><th>Kota</th><th>Kelas</th><th class="num">Tempat tidur</th><th class="num">Kunjungan</th><th class="num">Kunjungan per 100 tempat tidur</th></tr></thead><tbody>${rows.map((h) => `<tr data-hospital-row="${esc(h.id)}" tabindex="0"><td>${esc(h.name)}</td><td>${esc(h.city)}</td><td>${esc(h.kelas)}</td><td class="num">${fmtInt(h.beds)}</td><td class="num">${fmtInt(h.actual.resp)}</td><td class="num">${fmt(h.per100beds, 0)}</td></tr>`).join('')}</tbody>`;
    bindRowActivate('#health-top-table tbody tr', 'data-hospital-row', detailHospital);
    return;
  }
  const rows = healthStations().slice().sort((a, b) => (b.lag0_resp || 0) - (a.lag0_resp || 0)).slice(0, 10);
  el.innerHTML = `<thead><tr><th>Stasiun</th><th>Pulau</th><th class="num">Kunjungan</th><th class="num">Balita</th><th class="num">r lag 0</th><th class="num">Hari episode</th><th>Status</th></tr></thead><tbody>${rows.map((r) => `<tr data-health-station="${esc(r.station)}" tabindex="0"><td class="mono">${esc(r.station)}</td><td>${esc(r.island)}</td><td class="num">${fmtInt(r.resp_actual)}</td><td class="num">${fmtInt(r.resp_under5_actual)}</td><td class="num">${r.lag0_resp == null ? '—' : fmtR(r.lag0_resp)}</td><td class="num">${fmtInt(r.episode_days)}</td><td><span class="st ${statusSlug(r.status)}">${esc(r.status)}</span></td></tr>`).join('')}</tbody>`;
  bindRowActivate('#health-top-table tbody tr', 'data-health-station', detailHealthStation);
}

function setHealthTable(kind) {
  state.healthTable = kind === 'rs' ? 'rs' : 'stasiun';
  $$('[data-health-table]').forEach((b) => {
    const on = b.dataset.healthTable === state.healthTable;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  const sub = $('#health-table-sub');
  if (sub) sub.textContent = state.healthTable === 'rs' ? per100Unit() : 'r lag 0 tertinggi';
  renderHealthTopTable();
}

function makeHealthCaseMap() {
  const el = document.getElementById('map-health');
  if (!el) return null;
  return makeMap('map-health', [], {
    legend: provLegendHtml(false),
    islands: false,
    zoom: true,
    choropleth: { onProvince: (name) => { const spec = detailProvince(name); if (spec) openDetail(spec); } },
  });
}
function stationBeds() {
  const m = new Map();
  (DATA.hospitals.hospitals || []).forEach((h) => {
    const cur = m.get(h.station) || { beds: 0, resp: 0 };
    cur.beds += h.beds || 0;
    cur.resp += (h.actual && h.actual.resp) || 0;
    m.set(h.station, cur);
  });
  return m;
}

function makeHealthScatter() {
  const st = DATA.stationsById;
  const beds = stationBeds();
  const rows = healthStations().map((r) => {
    const b = beds.get(r.station);
    return {
      station: r.station, island: r.island, pm: st.get(r.station) ? st.get(r.station).mean_2026 : null,
      per100: b && b.beds ? b.resp / b.beds * 100 : null, episode: r.episode_days, actual: r.resp_actual,
    };
  }).filter((r) => r.pm != null && r.per100 != null);
  const pts = rows.map((r) => [r.pm, r.per100, r.episode, r.station, r.island, r.actual]);
  const chart = makeChart('chart-health-scatter', {
    aria: { enabled: true },
    grid: { left: 46, right: 16, top: 30, bottom: 34 },
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(p.value[3])}</b><br>PM2.5 ${fmt(p.value[0], 1)} µg/m³<br>${fmt(p.value[1], 0)} kunjungan/100 TT<br>${fmtInt(p.value[5])} kunjungan · ${esc(p.value[4])}` },
    xAxis: { type: 'value', name: 'rata-rata PM2.5 (µg/m³)', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 9, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    yAxis: { type: 'value', name: 'kunjungan/100 TT', nameGap: 16, nameTextStyle: { fontSize: 9, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8, formatter: (v) => fmt(v, 0) } },
    series: [{
      type: 'scatter', data: pts, symbolSize: (v) => 5 + Math.min(9, Math.sqrt(v[2] || 1) / 3.5),
      itemStyle: { color: (p) => ISLAND_COLORS[p.value[4]] || C.navy, borderColor: C.paper, borderWidth: 1 },
      label: { show: true, position: 'top', fontSize: 7.5, color: C.muted, distance: 4, formatter: (p) => (p.value[1] > 80 || p.value[0] > 250 ? p.value[3] : '') },
      labelLayout: { hideOverlap: true },
      markLine: markLinePP(ppItem('x', 55, 'PP 55', C.yellow)),
    }],
  });
  chart.on('click', (p) => {
    if (p.seriesType !== 'scatter') return;
    const id = p.value[3];
    if (!id) return;
    const spec = detailHealthStation(id);
    if (spec) openDetail(spec);
  });
}
function renderHealthPanel() {
  const el = $('#health-panel');
  if (!el) return;
  const tab = state.tab.kesehatan || 'lag';
  if (tab === 'beban') {
    el.innerHTML = `<div class="chart" id="health-panel-chart"></div>`;
    const rows = healthStations().slice(0, 10).map((r) => ({ id: r.station, value: r.resp_actual, status: r.status })).reverse();
    if (!rows.length) {
      el.innerHTML = `<div class="empty">Tidak ada stasiun pada filter ini</div>`;
      return;
    }
    makeBarChart('health-panel-chart', rows, { horizontal: true, color: (r) => r.value > 3000 ? C.terra : C.navy, label: (r) => fmtInt(r.value), grid: { left: 54, right: 44, top: 6, bottom: 6 }, yFont: 9 });
    return;
  }
  if (tab === 'tahun') {
    el.innerHTML = `<div class="chart" id="health-panel-chart"></div>`;
    const years = healthYears();
    makeChart('health-panel-chart', {
      aria: { enabled: true },
      grid: { left: 42, right: 12, top: 28, bottom: 26 },
      legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 9, color: C.muted } },
      tooltip: { ...tooltipBase(), trigger: 'axis' },
      xAxis: { type: 'category', data: years.map((r) => String(r.year)), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 9 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8.5, formatter: (v) => fmtInt(v) } },
      series: [
        { name: 'Respirasi', type: 'bar', data: years.map((r) => r.actual.resp || 0), barWidth: 26, itemStyle: { color: C.navy, borderRadius: [3, 3, 0, 0] } },
        { name: 'Kematian', type: 'bar', data: years.map((r) => r.actual.death || 0), barWidth: 26, itemStyle: { color: C.terra, borderRadius: [3, 3, 0, 0] } },
      ],
    });
    return;
  }
  el.innerHTML = `<div style="padding:10px 12px 0"><select class="select wide" id="lag-select" aria-label="Pilih outcome">${DATA.health.outcomes.map((o) => `<option value="${o.key}" ${o.key === state.lagOutcome ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div><div class="chart" id="health-panel-chart"></div>`;
  const sel = $('#lag-select');
  if (sel) sel.addEventListener('change', () => { state.lagOutcome = sel.value; renderHealthPanel(); });
  const lag = healthLag();
  const keys = Object.keys(lag).sort((a, b) => Number(a) - Number(b));
  makeChart('health-panel-chart', {
    aria: { enabled: true },
    grid: { left: 42, right: 16, top: 18, bottom: 28 },
    tooltip: { ...tooltipBase(), trigger: 'axis', formatter: (ps) => `<b>lag ${ps[0].axisValue}</b><br>r = ${fmtR(ps[0].value)}` },
    xAxis: { type: 'category', data: keys, axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 9 } },
    yAxis: { type: 'value', min: 0.25, max: 0.4, interval: 0.05, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8.5, formatter: (v) => fmt(v, 2) } },
    series: [{ type: 'line', data: keys.map((k) => lag[k][state.lagOutcome]), smooth: false, symbol: 'circle', symbolSize: 4, lineStyle: { width: 2, color: C.navy }, itemStyle: { color: C.navy }, areaStyle: { color: 'rgba(231,179,58,.14)' } }],
  });
}

/* ------------------------------------------------------------------ network */
function networkRows() {
  if (state.island === 'Semua') return DATA.network.stations;
  return DATA.network.stations.filter((s) => s.island === state.island);
}

function renderNetwork() {
  const d = DATA.meta.data_quality;
  const rows = networkRows();
  const provinces = new Set(rows.map((r) => r.province)).size;
  const islands = new Set(rows.map((r) => r.island)).size;
  const meta = `${rows.length} stasiun · ${provinces} provinsi · ${islands} pulau`;
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, rows.filter((r) => r.status === s).length]));
  const strip = STATUS_ORDER.map((s) => `<span class="status-chip"><span class="dot" style="background:${s === 'Baik' ? C.teal : s === 'Perhatian' ? C.yellow : s === 'Terbatas' ? C.terra : s === 'Tidak memadai' ? '#C0453C' : C.red}"></span>${esc(s)} <b>${counts[s] || 0}</b></span>`).join('');
  const worst = rows.slice().sort((a, b) => a.usable_pct - b.usable_pct)[0];
  const validPct = d.valid_overall_pct;
  const usablePct = d.usable_station_days / d.daily_station_days * 100;
  const kpis = [
    { id: 'rows', label: 'Baris pengamatan', value: fmtInt(d.raw_rows), unit: 'baris', baseline: '27 berkas AQMS', window: '2024–2026', note: 'Baris mentah 27 berkas AQMS' },
    { id: 'valid', label: 'Baris lolos pemeriksaan', value: fmt(validPct, 1), unit: '%', baseline: `${fmtInt(d.valid_rows)} baris`, window: 'pemeriksaan', note: 'Porsi baris yang lolos pemeriksaan kualitas data' },
    { id: 'usable', label: 'Hari-stasiun layak', value: fmt(usablePct, 1), unit: '%', baseline: `${fmtInt(d.usable_station_days)}/${fmtInt(d.daily_station_days)}`, window: '≥18 jam', note: 'Hari dengan minimal 18 jam data yang lolos pemeriksaan' },
    { id: 'fragile', label: 'Stasiun paling rapuh', value: worst ? worst.station : '—', unit: '', baseline: worst ? `${fmt(worst.usable_pct, 1)}% layak` : '', window: '2024–2026', note: worst ? `${worst.station} · ${worst.status} · ${fmt(worst.usable_pct, 1)}% hari layak` : '' },
  ].map(kpiCard2).join('');
  const qc = DATA.network.qc_totals || {};
  const qcTotal = Object.values(qc).reduce((a, v) => a + v, 0) || 1;
  const qcLegend = Object.entries(qc).map(([k, v]) => `<span class="item"><span class="sw" style="background:${QC_COLOR[k] || C.grey}"></span>${qcLabel(k)} ${fmt(v / qcTotal * 100, 1)}%</span>`).join('');
  const exclusions = DATA.network.exclusions || {};
  return `${pageHead('Jaringan', meta, `<span class="pill warning" data-tip="${esc(DATA.network.blind_spots.join(' · '))}">${DATA.network.blind_spots.length} wilayah tanpa stasiun</span>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="network-strip">${strip}<span class="status-chip total">Total <b>${rows.length}</b></span></div>
    <div class="grid-12">
      <section class="card span-6 h-320">
        <div class="card-head"><div class="card-title">Peta status</div><div class="card-head-right"><div class="card-sub">status stasiun</div><div class="card-sub period">${esc(periodText('full'))}</div></div></div>
        <div class="card-body"><div class="map" id="map-network"></div><div class="map-legend" id="legend-network"></div></div>
      </section>
      ${card('Hasil pemeriksaan data', 'proporsi baris', `<div class="chart" id="chart-qc"></div>` + `<div class="stack-legend">${qcLegend}</div>`, { cls: 'span-6 h-320', right: `<div class="card-sub">${fmtInt(qcTotal)} baris</div>`, period: 'full' })}
    </div>
    <div class="grid-12">
      <section class="card span-6 h-240">
        <div class="card-head"><div class="card-title">Eksklusi & pengecualian</div><div class="card-head-right"><div class="card-sub">diagnostik</div><div class="card-sub period">${esc(periodText('full'))}</div></div></div>
        <div class="card-body"><div class="stat-grid">${Object.entries(exclusions).map(([k, v]) => `<div class="stat-block"><div class="k">${esc(k)}</div><div class="v" style="font-size:9px;white-space:normal">${esc(v)}</div></div>`).join('')}</div></div>
      </section>
      <section class="card span-6 h-240">
        <div class="card-head"><div class="card-title">Blind spot</div><div class="card-head-right"><div class="card-sub">tanpa stasiun</div><div class="card-sub period">${esc(periodText('full'))}</div></div></div>
        <div class="card-body" style="padding:12px;display:flex;flex-direction:column;gap:8px">${DATA.network.blind_spots.map((b) => `<span class="pill warning">${esc(b)}</span>`).join('')}</div>
      </section>
    </div>
    <div class="grid-12">
      ${card('Matriks kelengkapan stasiun × bulan', '% hari layak', `<div class="chart" id="chart-completeness-matrix"></div>`, { cls: 'span-12 h-420', right: '<div class="card-sub">hari layak / hari kalender</div>', period: 'full' })}
    </div>
    <div class="grid-12">
      ${card('Prioritas pemantauan', 'X gap data · Y rata-rata', `<div class="chart" id="chart-priority"></div>`, { cls: 'span-7 h-320', right: '<div class="card-sub">mean vs gap</div>', period: networkMeanPeriod() })}
      ${card('Titik perhatian', 'gap >20% atau status buruk', `<div class="table-wrap" style="height:auto;max-height:320px"><table class="data" id="network-attention"></table></div>`, { cls: 'span-5 h-auto', right: '<div class="card-sub">perhatian</div>', period: 'full' })}
    </div>
    <section class="card span-12 h-auto">
      <div class="card-head"><div class="card-title">Status 27 stasiun</div><div class="card-head-right"><div class="card-sub">kelengkapan terendah dulu</div><div class="card-sub period">${esc(periodText('full'))}</div></div></div>
      <div class="card-body"><div class="table-wrap" style="height:auto;max-height:360px"><table class="data" id="network-table"></table></div></div>
    </section>
  </div>`;
}

function afterNetwork() {
  const rows = networkRows();
  makeMap('map-network', rows.map((s) => ({ id: s.station, lat: s.lat, lon: s.lon, color: s.status === 'Baik' ? C.teal : s.status === 'Perhatian' ? C.yellow : s.status === 'Terbatas' ? C.terra : s.status === 'Tidak memadai' ? '#C0453C' : C.red, r: 3.5 + Math.min(7, s.usable_pct / 22), selected: s.station === state.station, popup: `<b>${esc(s.station)}</b><br>${esc(s.status)} · ${fmt(s.usable_pct, 1)}%<br>${fmt(s.mean_2026, 1)} µg/m³` })), {
    onClick: (id) => { const spec = detailNetworkStation(id); if (spec) openDetail(spec); },
    legend: STATUS_ORDER.map((s) => `<div class="row"><span class="sw" style="background:${s === 'Baik' ? C.teal : s === 'Perhatian' ? C.yellow : s === 'Terbatas' ? C.terra : s === 'Tidak memadai' ? '#C0453C' : C.red}"></span>${esc(s)}</div>`).join(''),
    badge: 'status',
    labels: false,
  });
  makeQcChart();
  makeCompletenessMatrix();
  makePriorityChart(rows);
  renderNetworkTables();
}
/* Proporsi hasil pemeriksaan data sebagai donat; nama & warna ada di legenda bawah. */
function makeQcChart() {
  const qc = DATA.network.qc_totals || {};
  const rows = Object.entries(qc).map(([key, value]) => ({ key, name: qcLabel(key), value }));
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const chart = makeChart('chart-qc', {
    aria: { enabled: true },
    tooltip: {
      ...tooltipBase(),
      trigger: 'item',
      formatter: (p) => `<b>${esc(p.name)}</b><br>${fmtInt(p.value)} baris · ${fmt(p.percent, 1)}%`,
    },
    series: [{
      type: 'pie',
      radius: ['52%', '76%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: true,
      minAngle: 3,
      padAngle: 0.6,
      itemStyle: { borderColor: C.paper, borderWidth: 1.5, borderRadius: 2 },
      data: rows.map((r) => ({ name: r.name, value: r.value, itemStyle: { color: QC_COLOR[r.key] || C.grey } })),
      /* Nama & warna tiap segmen ada di legenda bawah kartu; kanvas cukup
         menampilkan total di tengah supaya label luar tidak bertumpuk. */
      label: {
        show: true,
        position: 'inside',
        fontFamily: 'IBM Plex Mono',
        fontSize: 9,
        color: '#FFFFFF',
        formatter: (p) => (p.percent >= 8 ? `${fmt(p.percent, 1)}%` : ''),
      },
      labelLine: { show: false },
      emphasis: {
        scale: true,
        scaleSize: 4,
        label: { show: true, fontSize: 9 },
      },
    }],
    graphic: [{
      type: 'text',
      left: 'center',
      top: 'middle',
      style: {
        text: `${fmtInt(total)}\nbaris`,
        textAlign: 'center',
        fill: C.navy,
        font: '600 11px "IBM Plex Mono", monospace',
        lineHeight: 13,
      },
      silent: true,
    }],
  });
  chart.on('click', (p) => {
    const r = rows[p.dataIndex];
    if (!r) return;
    const spec = detailQc(r.key);
    if (spec) openDetail(spec);
  });
  return chart;
}
function makeCompletenessMatrix() {
  const comp = DATA.network.completeness || [];
  const rows = networkRows().map((r) => r.station).sort();
  const months = Array.from(new Set(comp.map((r) => r.month))).sort();
  const by = new Map(comp.map((r) => [`${r.station}|${r.month}`, r.pct]));
  const data = [];
  rows.forEach((st, yi) => months.forEach((mo, xi) => { const v = by.get(`${st}|${mo}`); data.push([xi, yi, v == null ? null : v, st, mo]); }));
  const chart = makeChart('chart-completeness-matrix', {
    aria: { enabled: true },
    grid: { left: 56, right: 18, top: 8, bottom: 34 },
    tooltip: { ...tooltipBase(), formatter: (p) => { const [x, y, v, st, mo] = p.value; return `<b>${esc(st)} · ${mo}</b><br>${v == null ? 'tidak ada data' : fmt(v, 1) + '% hari layak'}`; } },
    xAxis: { type: 'category', data: months.map((m) => monthLabel(m)), axisLabel: { color: C.muted, fontSize: 7, interval: 2 }, axisTick: { show: false } },
    yAxis: { type: 'category', data: rows, axisLabel: { color: C.navy, fontSize: 7.5 }, axisTick: { show: false } },
    visualMap: { show: false, dimension: 2, pieces: [{ lte: 80, color: C.terra }, { gt: 80, lte: 95, color: C.yellow }, { gt: 95, color: C.teal }] },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: C.paper, borderWidth: 1 } }],
  });
  pickByPixel(chart, document.getElementById('chart-completeness-matrix'), 'x', (xi, yiV) => {
    const yi = Math.round(Number(yiV));
    const st = rows[yi];
    const mo = months[xi];
    if (!st || !mo) return;
    const spec = detailCompleteness(st, mo);
    if (spec) openDetail(spec);
  });
}
function renderNetworkTables() {
  const rows = networkRows();
  const attention = $('#network-attention');
  if (attention) {
    const att = rows.filter((r) => r.gap > 20 || r.status !== 'Baik').sort((a, b) => b.gap - a.gap);
    attention.innerHTML = `<thead><tr><th>Stasiun</th><th class="num">Gap</th><th class="num">Rata-rata</th><th>Status</th></tr></thead><tbody>${att.map((r) => `<tr data-net-station="${esc(r.station)}" tabindex="0"><td class="mono">${esc(r.station)}</td><td class="num">${fmt(r.gap, 1)}%</td><td class="num">${fmt(r.mean_2026, 1)}</td><td><span class="st ${statusSlug(r.status)}">${esc(r.status)}</span></td></tr>`).join('')}</tbody>`;
  }
  const table = $('#network-table');
  if (table) {
    const sorted = rows.slice().sort((a, b) => a.usable_pct - b.usable_pct);
    table.innerHTML = `<thead><tr><th>Stasiun</th><th>Kota/Pulau</th><th class="num">Lolos</th><th class="num">Layak</th><th class="num">Gap</th><th class="num">Rata-rata</th><th class="num">Hari data</th><th>Status</th></tr></thead><tbody>${sorted.map((r) => { const st = DATA.stationsById.get(r.station); const valid = DATA.network.valid_pct_by_station[r.station]; return `<tr data-net-station="${esc(r.station)}" tabindex="0"><td class="mono">${esc(r.station)}</td><td>${esc(st ? st.city : '')} · ${esc(r.island)}</td><td class="num">${valid == null ? '—' : fmt(valid, 1)}%</td><td class="num">${fmt(r.usable_pct, 1)}%</td><td class="num">${fmt(r.gap, 1)}%</td><td class="num">${fmt(r.mean_2026, 1)}</td><td class="num">${fmtInt(r.days_2026)}</td><td><span class="st ${statusSlug(r.status)}">${esc(r.status)}</span></td></tr>`; }).join('')}</tbody>`;
  }
  bindRowActivate('[data-net-station]', 'data-net-station', detailNetworkStation);
}

function makePriorityChart(rows) {
  const pts = rows.filter((r) => r.mean_2026 != null).map((r) => [r.gap, r.mean_2026, r.days_2026, r.station, r.status]);
  const chart = makeChart('chart-priority', {
    aria: { enabled: true },
    grid: { left: 44, right: 16, top: 28, bottom: 30 },
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(p.value[3])}</b><br>gap ${fmt(p.value[0], 1)}%<br>mean ${fmt(p.value[1], 1)} µg/m³<br>${esc(p.value[4])}` },
    xAxis: { type: 'value', min: 0, max: 40, name: 'gap data (%)', nameLocation: 'middle', nameGap: 18, nameTextStyle: { fontSize: 8.5, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    yAxis: { type: 'value', name: 'µg/m³', nameGap: 14, nameTextStyle: { fontSize: 8.5, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    series: [{
      type: 'scatter',
      data: pts,
      symbolSize: (v) => 5 + Math.min(7, v[2] / 14),
      itemStyle: { color: (p) => p.data[4] === 'Baik' ? C.teal : p.data[4] === 'Perhatian' ? C.yellow : p.data[4] === 'Terbatas' ? C.terra : p.data[4] === 'Tidak memadai' ? '#C0453C' : C.red, borderColor: C.paper, borderWidth: 1 },
      label: { show: true, position: 'right', offset: [5, 0], align: 'left', verticalAlign: 'middle', fontSize: 7.5, color: C.muted, formatter: (p) => (p.value[1] > 150 || p.value[0] > 8) ? p.value[3] : '' },
      labelLayout: { hideOverlap: true },
      markLine: markLinePP(ppItem('y', 55, 'PP 55', C.yellow), { xAxis: 10, lineStyle: { type: [4, 3], width: 1, color: C.muted, opacity: .5 }, label: { show: false } }, { yAxis: 100, lineStyle: { type: [4, 3], width: 1, color: C.muted, opacity: .4 }, label: { show: false } }),
    }],
  });
  chart.on('click', (p) => {
    if (p.seriesType !== 'scatter') return;
    const id = p.value[3];
    if (!id) return;
    const spec = detailNetworkStation(id);
    if (spec) openDetail(spec);
  });
}

/* ------------------------------------------------------------------ methodology */
function defList(pairs) {
  return `<dl class="defs">${pairs.map(([k, v]) => `<div class="def"><dt>${esc(k)}</dt><span class="colon">:</span><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function renderMethod() {
  const m = DATA.method;
  const d = m.data_quality;
  const meta = `metrics.json · ${m.metrics_sha256.slice(0, 12)}… · ${m.generated_at}`;
  return `${pageHead('Metodologi', meta, `<input class="method-search" id="method-search" type="search" placeholder="Cari definisi" aria-label="Cari definisi">`)}
  <div class="page-body">
    <section class="card method-card">
      <div class="method-scroll" id="method-scroll">
        <div class="method-intro"><span class="pill">hash ${m.metrics_sha256.slice(0, 12)}…</span><span class="pill">${m.generated_at}</span><span class="card-sub">Semua angka di preview berasal dari file ini.</span></div>
        <details class="acc" open><summary><span class="chev">›</span>Definisi KPI</summary><div class="acc-body">${defList(m.definitions)}</div></details>
        <details class="acc"><summary><span class="chev">›</span>Aturan QC</summary><div class="acc-body">${defList(m.qc)}</div></details>
        <details class="acc"><summary><span class="chev">›</span>Data contract</summary><div class="acc-body">
          <table><thead><tr><th>Item</th><th class="num">Nilai</th></tr></thead><tbody>
            <tr><td>Baris mentah</td><td class="num">${fmtInt(d.raw_rows)}</td></tr>
            <tr><td>Baris hourly</td><td class="num">${fmtInt(d.hourly_rows)}</td></tr>
            <tr><td>Baris lolos pemeriksaan</td><td class="num">${fmtInt(d.valid_rows)}</td></tr>
            <tr><td>Hari-stasiun</td><td class="num">${fmtInt(d.daily_station_days)}</td></tr>
            <tr><td>Hari-stasiun layak</td><td class="num">${fmtInt(d.usable_station_days)}</td></tr>
            <tr><td>Stasiun / RS / provinsi</td><td class="num">${d.stations} / ${d.hospitals} / ${d.provinces}</td></tr>
            <tr><td>Ambang WHO 15</td><td class="num">${fmt(m.exceed.who15_pct, 1)}%</td></tr>
            <tr><td>Ambang 55</td><td class="num">${fmt(m.exceed.pp55_pct, 1)}%</td></tr>
            <tr><td>Ambang 100</td><td class="num">${fmt(m.exceed.gt100_pct, 1)}%</td></tr>
          </tbody></table>
        </div></details>
        <details class="acc"><summary><span class="chev">›</span>Alur data</summary><div class="acc-body"><ol>${m.pipeline.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div></details>
        <details class="acc"><summary><span class="chev">›</span>Batasan &amp; larangan klaim</summary><div class="acc-body"><ul>${m.limitations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></details>
        <details class="acc"><summary><span class="chev">›</span>Changelog</summary><div class="acc-body"><p><b>${esc(m.generated_at)}</b> — metrics.json hash <code>${m.metrics_sha256}</code>.</p><p>Status: ${STATUS_ORDER.map((s) => `${s} ${m.status_counts[s] || 0}`).join(' · ')}.</p></div></details>
        <details class="acc"><summary><span class="chev">›</span>Sitasi</summary><div class="acc-body"><ul>${m.citations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></details>
      </div>
    </section>
  </div>`;
}

function afterMethod() {
  const search = $('#method-search');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim();
      $$('.acc').forEach((el) => {
        const hit = !q || el.textContent.toLowerCase().includes(q);
        el.hidden = !hit;
        if (hit && q) el.open = true;
      });
    });
  }
  $$('.acc').forEach((el) => {
    el.addEventListener('toggle', () => {
      if (el.open) $$('.acc').forEach((other) => { if (other !== el) other.open = false; });
    });
  });
}

/* ------------------------------------------------------------------ charts */
function tooltipBase() {
  return {
    appendToBody: true,
    confine: false,
    backgroundColor: 'rgba(19,26,56,.92)',
    borderWidth: 0,
    padding: [9, 11],
    textStyle: { color: '#FFFFFF', fontFamily: 'Plus Jakarta Sans', fontSize: 10.5 },
    extraCssText: 'border-radius:12px;box-shadow:0 18px 40px -18px rgba(19,26,56,.75);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);z-index:9999',
  };
}

function areaGradient(color, from = 0.24, to = 0.01) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: hexA(color, from) },
    { offset: 1, color: hexA(color, to) },
  ]);
}

function hexA(hex, alpha) {
  const h = String(hex).replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function axisX(extra = {}) {
  return {
    axisLine: { lineStyle: { color: C.line } },
    axisTick: { show: false },
    axisLabel: { color: C.muted, fontSize: 9 },
    ...extra,
  };
}

function axisY(extra = {}) {
  return {
    splitLine: { lineStyle: { color: C.grid, type: 'solid' } },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: C.muted, fontSize: 9 },
    ...extra,
  };
}

function makeChart(id, option) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return null;
  const chart = echarts.init(el, null, { renderer: 'canvas' });
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  chart.setOption({
    textStyle: { fontFamily: 'Plus Jakarta Sans', color: C.muted },
    animation: !reduced,
    animationDuration: reduced ? 0 : 420,
    animationEasing: 'cubicOut',
    ...option,
  });
  charts.push(chart);
  return chart;
}

function monthLabel(m) {
  const [y, mo] = String(m).split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${names[Number(mo) - 1]} ${String(y).slice(2)}`;
}

// Shared threshold line for charts whose value axis is µg/m³.
function ppItem(axis, value, text, color, pos = 'insideEndTop') {
  return {
    [axis === 'y' ? 'yAxis' : 'xAxis']: value,
    lineStyle: { color, type: [4, 3], width: 1, opacity: 0.9 },
    label: {
      show: true,
      formatter: text,
      position: pos,
      rotate: 0,
      distance: 3,
      fontFamily: 'IBM Plex Mono',
      fontSize: 8,
      color,
      backgroundColor: 'rgba(255,255,255,.78)',
      padding: [1, 2],
      borderRadius: 2,
    },
  };
}

function markLinePP(...items) {
  const data = items.filter(Boolean);
  if (!data.length) return undefined;
  return { silent: true, symbol: 'none', animation: false, data };
}

function ppLines(extra = []) {
  return markLinePP(ppItem('y', 55, 'PP 55', C.yellow), ...extra);
}

function makeMonthlyChart(id, rows, opts = {}) {
  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const years = Array.from(new Set(rows.map((r) => Number(r.year || String(r.month).slice(0, 4))))).sort();
  const by = new Map(rows.map((r) => [r.month, r.pm25]));
  const idxByYear = new Map();
  months.forEach((m, i) => {
    const y = Number(m.slice(0, 4));
    if (!idxByYear.has(y)) idxByYear.set(y, []);
    idxByYear.get(y).push(i);
  });
  // One continuous path: each year's series starts on the previous year's last month
  // so the line never breaks at Jan. Colour changes per year, newest year is emphasised.
  const series = years.map((y, si) => {
    const idx = idxByYear.get(y) || [];
    if (!idx.length) return null;
    const from = Math.max(0, idx[0] - 1);
    const to = idx[idx.length - 1];
    const isLast = si === years.length - 1;
    const data = months.map((m, i) => (i >= from && i <= to && by.has(m) ? by.get(m) : null));
    if (isLast) {
      for (let i = data.length - 1; i >= 0; i -= 1) {
        if (data[i] != null) {
          data[i] = { value: data[i], symbolSize: 7, itemStyle: { borderWidth: 1.6 } };
          break;
        }
      }
    }
    return {
      name: String(y),
      type: 'line',
      data,
      connectNulls: false,
      showSymbol: isLast,
      symbol: 'circle',
      symbolSize: 3.6,
      smooth: false,
      lineStyle: {
        width: isLast ? 2.6 : 1.9,
        color: YEAR_COLORS[y] || C.navy,
        shadowBlur: isLast ? 12 : 0,
        shadowColor: isLast ? hexA(YEAR_COLORS[y] || C.navy, 0.26) : 'transparent',
      },
      itemStyle: { color: YEAR_COLORS[y] || C.navy, borderColor: '#fff', borderWidth: 0.9 },
      areaStyle: isLast ? { color: areaGradient(YEAR_COLORS[y] || C.navy, 0.14, 0.005) } : undefined,
      z: isLast ? 3 : 1,
      markLine: isLast ? ppLines(opts.who15 ? [ppItem('y', 15, 'WHO 15', C.teal)] : []) : undefined,
      markArea: si === 0 ? {
        silent: true,
        itemStyle: { color: 'rgba(24,32,72,.032)' },
        data: years.filter((_, k) => k % 2 === 1).map((yy) => {
          const ix = idxByYear.get(yy);
          if (!ix || !ix.length) return null;
          return [{ xAxis: monthLabel(months[ix[0]]) }, { xAxis: monthLabel(months[ix[ix.length - 1]]) }];
        }).filter(Boolean),
      } : undefined,
    };
  }).filter(Boolean);
  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: { left: 36, right: 14, top: opts.compact ? 26 : 30, bottom: opts.compact ? 42 : 48 },
    legend: { top: 0, right: 0, itemWidth: 12, itemHeight: 7, itemGap: 12, icon: 'roundRect', textStyle: { fontSize: 9, color: C.muted } },
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      formatter: (ps) => {
        const p = ps.find((x) => x.value != null);
        if (!p) return '';
        const v = typeof p.value === 'object' && p.value ? p.value.value : p.value;
        return `<b>${monthLabel(months[p.dataIndex])}</b><br>${fmt(v, 1)} µg/m³`;
      },
    },
    xAxis: {
      type: 'category',
      data: months.map((m) => monthLabel(m)),
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 8, interval: opts.xInterval || 2, rotate: 45, align: 'right', verticalAlign: 'middle', margin: 8 },
    },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8.5 } },
    series,
  });
  if (chart && opts.onPick) {
    pickByPixel(chart, document.getElementById(id), 'x', (i) => {
      const m = months[i];
      if (m) opts.onPick(m);
    });
  }
  return chart;
}

function makeBarChart(id, rows, opts = {}) {
  const horizontal = opts.horizontal !== false;
  const data = rows.map((r) => r.value);
  const cats = rows.map((r) => r.id);
  const grid = opts.grid || { left: 50, right: 30, top: 8, bottom: 8 };
  const n = rows.length;
  const avail = Math.max(10, (opts.height || 0) || 0);
  const common = {
    aria: { enabled: true },
    grid,
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(cats[p.dataIndex])}</b><br>${fmt(p.value, 1)}` },
    xAxis: horizontal
      ? { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 9, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } }
      : { type: 'category', data: cats, axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: opts.yFont || 9 } },
    yAxis: horizontal
      ? { type: 'category', inverse: true, data: cats, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: opts.yFont || 9, interval: 0 } }
      : { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 9 } },
  };
  const chart = makeChart(id, {
    ...common,
    series: [{
      type: 'bar',
      data: data.map((v, i) => ({ value: v, itemStyle: { color: opts.color ? opts.color(rows[i]) : C.navy, borderRadius: horizontal ? [0, 8, 8, 0] : [8, 8, 0, 0] } })),
      barWidth: opts.barWidth || (horizontal ? 10 : 22),
      showBackground: horizontal && opts.track !== false,
      backgroundStyle: { color: 'rgba(24,32,72,.045)', borderRadius: 8 },
      label: { show: true, position: horizontal ? 'right' : 'top', fontFamily: 'IBM Plex Mono', fontSize: opts.labelFont || 9, color: C.navy, formatter: (p) => opts.label ? opts.label(rows[p.dataIndex]) : fmt(p.value, 1) },
      markLine: opts.pp55 ? markLinePP(ppItem(horizontal ? 'x' : 'y', 55, 'PP 55', C.yellow, horizontal ? 'start' : 'insideEndTop')) : undefined,
    }],
  });
  if (chart && opts.onPick) {
    pickByPixel(chart, document.getElementById(id), horizontal ? 'y' : 'x', (i) => {
      const row = rows[i];
      if (row) opts.onPick(row);
    });
  }
  return chart;
}

/* ------------------------------------------------------- overview charts */

/* Kurva 24 jam — satu pembangun untuk Ringkasan & Waktu.
   Ringkasan: ringkas (lokasi terpilih + 2 pembanding).
   Waktu: lebih rinci (lokasi terpilih + seluruh kelas lokasi + klik rincian).
   Satuan µg/m³; garis putus-putus = rata-rata harian cakupan terpilih. */
function makeCycleChart(id, opts = {}) {
  const detail = !!opts.detail;
  const curve = diurnalCurve();
  const classes = diurnalClassCurves();
  const mainColor = C.navy;
  const series = [curve.means];
  const allVals = curve.means.filter((v) => v != null);

  const compare = detail
    ? classes
    : classes.filter((c) => ['Traffic/Roadside', 'Peatland/Forest'].includes(c.cls));
  compare.forEach((c) => {
    series.push(c.vals);
    c.vals.forEach((v) => { if (v != null) allVals.push(v); });
  });
  if (!allVals.length) return null;

  const lo = Math.min(...allVals);
  const hi = Math.max(...allVals);
  const yMax = Math.ceil((hi + 6) / 10) * 10;
  const yMin = Math.max(0, Math.floor((lo - 6) / 10) * 10);

  const mk = (name, data, color, dashed, width) => ({
    name,
    type: 'line',
    data,
    smooth: false,
    connectNulls: true,
    showSymbol: !dashed,
    symbol: 'circle',
    symbolSize: dashed ? 0 : 3.4,
    lineStyle: { color, width, type: dashed ? [5, 4] : 'solid', opacity: dashed ? 0.9 : 1 },
    itemStyle: { color, borderColor: C.paper, borderWidth: 1 },
    z: dashed ? 2 : 4,
  });

  const lines = [
    mk(curve.label, curve.means, mainColor, false, 2.4),
    ...compare.map((c) => mk(c.label, c.vals, DIURNAL_COLORS[c.cls] || C.grey, true, 1.5)),
  ];

  const dailyLine = curve.daily == null ? [] : [{
    yAxis: curve.daily,
    lineStyle: { color: mainColor, type: [2, 3], width: 1.1, opacity: 0.55 },
    label: {
      show: true,
      position: 'insideStartTop',
      formatter: `rata-rata ${fmt(curve.daily, 1)}`,
      fontFamily: 'IBM Plex Mono',
      fontSize: 8,
      color: mainColor,
      backgroundColor: 'rgba(255,255,255,.8)',
      padding: [1, 3],
      borderRadius: 3,
    },
  }];

  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: { left: 40, right: 14, top: 32, bottom: 22 },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 7, itemGap: 9, icon: 'roundRect', textStyle: { fontSize: 8.5, color: C.muted } },
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(24,32,72,.18)' } },
      formatter: (ps) => {
        const i = ps[0] ? ps[0].dataIndex : 0;
        const body = ps
          .filter((p) => p.value != null)
          .map((p) => `<br>${esc(p.seriesName)} <b>${fmt(p.value, 1)} µg/m³</b>`)
          .join('');
        const foot = `<br><span style="opacity:.75">${esc(DATA.view.label)} · rata-rata ${fmt(curve.daily, 1)} µg/m³</span>`;
        return `<b>${HOUR_LABELS[i]}:00</b>${body}${foot}`;
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: HOUR_LABELS,
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 8.5, interval: detail ? 2 : 3 },
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      splitNumber: 3,
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { color: C.muted, fontSize: 8.5 },
    },
    series: [
      {
        ...lines[0],
        markLine: markLinePP(ppItem('y', 55, 'PP 55', C.yellow), ...dailyLine),
      },
      ...lines.slice(1),
    ],
  });

  if (chart && detail) {
    pickByPixel(chart, document.getElementById(id), 'x', (i) => {
      const spec = detailHour(i);
      if (spec) openDetail(spec);
    });
  }
  return chart;
}

const SITE_CLASSES = ['Peatland/Forest', 'Industrial', 'Urban Background', 'Traffic/Roadside', 'Clean/Regional'];

function siteClassRows() {
  const rows = filteredStations();
  return SITE_CLASSES.map((cls) => {
    const g = rows.filter((r) => r.site_class === cls);
    return {
      id: cls,
      n: g.length,
      baseline: average(g.map((r) => r.baseline)),
      mean: average(g.map((r) => r.mean_2026)),
      p95: average(g.map((r) => r.p95_2026)),
    };
  }).filter((r) => r.n > 0 && r.mean != null)
    .sort((a, b) => b.mean - a.mean);
}

function makeSiteClassChart(id) {
  const rows = siteClassRows();
  if (!rows.length) return null;
  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: { left: 102, right: 46, top: 26, bottom: 20 },
    legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 7, itemGap: 10, icon: 'roundRect', textStyle: { fontSize: 9, color: C.muted } },
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps[0] ? ps[0].dataIndex : 0;
        const r = rows[i];
        const ratio = r.baseline ? r.mean / r.baseline : null;
        return `<b>${esc(r.id)}</b><br>Baseline <b>${fmt(r.baseline, 1)}</b> µg/m³<br>Rata-rata <b>${fmt(r.mean, 1)}</b> µg/m³${ratio ? `<br>${fmt(ratio, 2)}× baseline` : ''}<br>${r.n} stasiun`;
      },
    },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { color: C.muted, fontSize: 8.5 },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((r) => r.id),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: C.navy, fontSize: 8.5, interval: 0 },
    },
    series: [
      { name: 'Baseline', type: 'bar', data: rows.map((r) => r.baseline), barWidth: 8, barGap: '30%', itemStyle: { color: '#8FA0C4', borderRadius: [0, 4, 4, 0] } },
      {
        name: 'Rata-rata',
        type: 'bar',
        data: rows.map((r) => r.mean),
        barWidth: 8,
        itemStyle: { color: C.terra, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 8.5, color: C.navy, formatter: (p) => fmt(p.value, 1) },
        labelLayout: { hideOverlap: true },
        markLine: markLinePP(ppItem('x', 55, 'PP 55', C.yellow, 'start')),
      },
    ],
  });
  if (chart) {
    pickByPixel(chart, document.getElementById(id), 'y', (i) => {
      const spec = detailSiteClass(rows[i].id);
      if (spec) openDetail(spec);
    });
  }
  return chart;
}

function detailHour(h) {
  const curve = diurnalCurve();
  const classes = diurnalClassCurves();
  const i = Number(h);
  const val = curve.means[i];
  if (val == null) return null;
  const prev = curve.means[(i + 23) % 24];
  const delta = prev == null ? null : val - prev;
  const rows = [
    { label: curve.label, value: val, color: C.navy },
    ...classes.map((c) => ({ label: c.label, value: c.vals[i], color: DIURNAL_COLORS[c.cls] || C.grey })),
  ].filter((r) => r.value != null);
  const label = `${HOUR_LABELS[i]}:00`;
  const body = `
    ${detailMetrics([
      ['Kadar', `${fmt(val, 1)}`, 'µg/m³'],
      ['Vs jam sebelumnya', delta == null ? '—' : `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta), 1)}`, 'µg/m³'],
      ['Rata-rata harian', curve.daily == null ? '—' : fmt(curve.daily, 1), 'µg/m³'],
    ])}
    <div class="detail-block"><div class="detail-label">Per lokasi · µg/m³</div>${detailBars(rows.map((r) => ({ ...r, display: fmt(r.value, 1) })))}</div>
    <div class="detail-note">${esc(DATA.view.label)} · garis PP 55 µg/m³ sebagai acuan</div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="waktu">Buka di Waktu</button>`;
  return {
    key: `hour:${i}`,
    kicker: `Siklus 24 jam · ${curve.label}`,
    title: label,
    chip: label,
    body,
    after: (root) => {
      const cta = root.querySelector('[data-detail-go]');
      if (cta) cta.addEventListener('click', () => jumpTo('waktu'));
    },
  };
}

function detailSiteClass(cls) {
  const rows = filteredStations().filter((r) => r.site_class === cls);
  if (!rows.length) return null;
  const baseline = average(rows.map((r) => r.baseline));
  const mean = average(rows.map((r) => r.mean_2026));
  const p95 = average(rows.map((r) => r.p95_2026));
  const ratio = baseline && mean ? mean / baseline : null;
  const sorted = rows.slice().sort((a, b) => (b.mean_2026 == null ? -1 : b.mean_2026) - (a.mean_2026 == null ? -1 : a.mean_2026));
  const body = `
    ${detailMetrics([
      ['Stasiun', String(rows.length), ''],
      ['Baseline', fmt(baseline, 1), 'µg/m³'],
      ['Rata-rata', fmt(mean, 1), 'µg/m³'],
    ])}
    <div class="detail-list">
      <div class="row"><span>Rasio mean / baseline</span><b>${ratio ? `${fmt(ratio, 2)}×` : '—'}</b></div>
      <div class="row"><span>P95 2026 rata-rata</span><b>${fmt(p95, 1)} µg/m³</b></div>
    </div>
    <div class="detail-block"><div class="detail-label">Stasiun · rata-rata</div>${detailBars(sorted.map((r) => ({ label: r.id, value: r.mean_2026 || 0, color: CAT_COLORS[categoryFromPm(r.mean_2026)] || C.navy })))}</div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="wilayah">Buka Stasiun</button>`;
  return {
    key: `class:${cls}`,
    kicker: `Kelas lokasi · ${DATA.view.label}`,
    title: cls,
    chip: cls,
    body,
    after: (root) => {
      const cta = root.querySelector('[data-detail-go]');
      if (cta) cta.addEventListener('click', () => jumpTo('wilayah'));
    },
  };
}

/* ------------------------------------------------------------------ maps */
let basemapPromise = null;
function loadBasemap() {
  if (!basemapPromise) {
    basemapPromise = fetch('data/geo/id_provinces.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return basemapPromise;
}

function addBasemap(map, beforeId) {
  loadBasemap().then((geo) => {
    if (!geo || !map || (map.isDisposed && map.isDisposed())) return;
    try {
      if (!map.getSource('basemap')) map.addSource('basemap', { type: 'geojson', data: geo });
      const anchor = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
      if (!map.getLayer('basemap-land')) {
        map.addLayer({
          id: 'basemap-land',
          type: 'fill',
          source: 'basemap',
          paint: { 'fill-color': '#FFFFFF', 'fill-antialias': true },
        }, anchor);
      }
      if (!map.getLayer('basemap-prov')) {
        map.addLayer({
          id: 'basemap-prov',
          type: 'line',
          source: 'basemap',
          paint: { 'line-color': 'rgba(24,32,72,.26)', 'line-width': 0.7 },
        }, anchor);
      }
    } catch (_) { /* map disposed mid-load */ }
  });
}

/* ------------------------------------------------ province choropleth */
const PROV_RAMP = ['#F8E9E0', '#F0CBB8', '#DFA184', '#C56C4C', '#9C3F26'];
const PROV_NODATA = 'rgba(198,205,219,.62)';

function provRows() {
  return DATA.hospitals.provinces || [];
}

function provMetricKey() {
  return state.provMetric === 'per100' ? 'per100beds' : 'actual';
}

function provValue(p) {
  return state.provMetric === 'per100' ? p.per100beds : p.actual.resp;
}

function provUnitLabel() {
  const days = (DATA.hospitals.meta && DATA.hospitals.meta.days) || '';
  return state.provMetric === 'per100'
    ? `kunjungan per 100 tempat tidur · ${days} hari`
    : `kasus · ${days} hari`;
}

function quantileBreaks(values, steps = 5) {
  const arr = values.filter((v) => v != null && !Number.isNaN(v)).slice().sort((a, b) => a - b);
  if (arr.length < 2) return [];
  const out = [];
  for (let i = 1; i < steps; i += 1) {
    const pos = ((arr.length - 1) * i) / steps;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const v = arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
    out.push(Math.max(1, Math.round(v)));
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function provBreaks() {
  return quantileBreaks(provRows().map(provValue), PROV_RAMP.length);
}

function provFillExpr(breaks) {
  const key = state.provMetric === 'per100' ? 'p' : 'a';
  let expr = ['step', ['get', key], PROV_RAMP[0]];
  breaks.forEach((b, i) => { expr = expr.concat([b, PROV_RAMP[Math.min(i + 1, PROV_RAMP.length - 1)]]); });
  return ['case', ['==', ['get', 'has'], 0], PROV_NODATA, expr];
}

function provLegendTitle() {
  const days = (DATA.hospitals.meta && DATA.hospitals.meta.days) || '';
  return state.provMetric === 'per100'
    ? `Kunjungan per 100 tempat tidur · ${days} hari`
    : `Kasus RS mitra · ${days} hari`;
}

function provLegendHtml(withStations = true) {
  const breaks = provBreaks();
  const edges = [0, ...breaks];
  const chips = edges.map((b, i) => {
    const next = edges[i + 1];
    const label = next == null ? `≥ ${fmtInt(b)}` : `${fmtInt(b)}–${fmtInt(next)}`;
    return `<span class="chip"><i style="background:${PROV_RAMP[i]}"></i>${label}</span>`;
  }).join('');
  const tail = withStations ? '<div class="legend-sub">titik = stasiun · ISPU</div>' : '';
  return `<div class="map-legend-title">${esc(provLegendTitle())}</div>
    <div class="legend-chips">${chips}<span class="chip"><i style="background:${PROV_NODATA}"></i>tanpa RS mitra</span></div>${tail}`;
}

function provinceTip(name) {
  const p = (DATA.hospitals.provinces || []).find((r) => r.province === name);
  if (!p) {
    return `<div class="map-tip-h"><b>${esc(name)}</b></div>`
      + '<div class="map-tip-s">Tanpa RS mitra</div>';
  }
  return `<div class="map-tip-h"><b>${esc(name)}</b></div>`
    + `<div class="map-tip-n">${fmtInt(p.actual.resp)}<small> kasus</small></div>`
    + `<div class="map-tip-s">${fmtInt(p.hospitals)} RS · ${fmtInt(p.beds)} tempat tidur</div>`
    + `<div class="map-tip-s">${fmt(p.per100beds, 0)} kunjungan per 100 tempat tidur</div>`;
}

function addChoropleth(map, cho) {
  loadBasemap().then((geo) => {
    if (!geo || !map || (map.isDisposed && map.isDisposed())) return;
    try {
      if (map.getSource('provcases')) return;
      const byName = new Map(provRows().map((p) => [p.province, p]));
      const features = (geo.features || []).map((f) => {
        const name = f.properties.name;
        const p = byName.get(name) || null;
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: { name, has: p ? 1 : 0, a: p ? p.actual.resp : 0, p: p ? p.per100beds || 0 : 0 },
        };
      });
      const breaks = provBreaks();
      map.addSource('provcases', { type: 'geojson', data: { type: 'FeatureCollection', features } });
      const anchor = map.getLayer('stations-halo') ? 'stations-halo' : undefined;
      map.addLayer({
        id: 'prov-fill',
        type: 'fill',
        source: 'provcases',
        paint: { 'fill-color': provFillExpr(breaks), 'fill-opacity': 0.72 },
      }, anchor);
      map.addLayer({
        id: 'prov-line',
        type: 'line',
        source: 'provcases',
        paint: { 'line-color': 'rgba(24,32,72,.30)', 'line-width': 0.8 },
      }, anchor);
      map.__choropleth = { breaks };
      const tip = map.__napasTip;
      map.on('mousemove', 'prov-fill', (e) => {
        const f = e.features && e.features[0];
        map.getCanvas().style.cursor = f && f.properties.has ? 'pointer' : '';
        if (!f || !tip) return;
        // Titik stasiun menang: biarkan tooltip stasiun yang tampil.
        if (map.queryRenderedFeatures(e.point, { layers: ['stations-hit'] }).length) return;
        tip.show(provinceTip(f.properties.name), e.point);
      });
      map.on('mouseleave', 'prov-fill', () => {
        map.getCanvas().style.cursor = '';
        if (tip) tip.hide();
      });
      map.on('click', 'prov-fill', (e) => {
        const f = e.features && e.features[0];
        if (!f || !f.properties.has) return;
        // A station dot may sit on top of the fill; the dot owns the click.
        if (map.queryRenderedFeatures(e.point, { layers: ['stations-hit'] }).length) return;
        if (cho && cho.onProvince) cho.onProvince(f.properties.name);
      });
    } catch (_) { /* map disposed mid-load */ }
  });
}

function applyProvMetric() {
  document.querySelectorAll('[data-provmetric]').forEach((b) => {
    b.classList.toggle('active', b.dataset.provmetric === state.provMetric);
    b.setAttribute('aria-pressed', String(b.dataset.provmetric === state.provMetric));
  });
  const breaks = provBreaks();
  maps.forEach((m) => {
    try {
      if (!m.getLayer('prov-fill')) return;
      m.setPaintProperty('prov-fill', 'fill-color', provFillExpr(breaks));
      m.__choropleth = { breaks };
    } catch (_) { /* disposed */ }
  });
  ['legend-overview', 'legend-health'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.dataset.kind === 'choro') el.innerHTML = provLegendHtml(el.dataset.dots === '1');
  });
}

function makeMap(id, rows, opts = {}) {  const el = document.getElementById(id);
  if (!el || !window.maplibregl) return null;
  const map = new maplibregl.Map({
    container: el,
    style: { version: 8, sources: {}, layers: [] },
    center: [118, -2],
    zoom: 3.1,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  maps.push(map);
  el.__napasMap = map;
  const tip = makeMapTip(el);
  map.__napasTip = tip;
  const byId = new Map();
  rows.forEach((r) => byId.set(r.id, r));
  map.on('load', () => {
    map.addLayer({ id: 'sea', type: 'background', paint: { 'background-color': '#EAF2FB' } });
    addBasemap(map, 'stations-halo');
    const features = rows.map((r) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: { id: r.id, color: r.color, r: r.r, selected: r.selected ? 1 : 0, popup: r.popup || '' },
    }));
    map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features } });
    map.addLayer({
      id: 'stations-halo',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': ['+', ['get', 'r'], 9],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.16,
        'circle-blur': 1,
      },
    });
    map.addLayer({
      id: 'stations',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': ['get', 'r'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.92,
        'circle-stroke-color': C.paper,
        'circle-stroke-width': 1.4,
      },
    });
    map.addLayer({
      id: 'stations-selected',
      type: 'circle',
      source: 'stations',
      filter: ['==', ['get', 'selected'], 1],
      paint: {
        'circle-radius': ['+', ['get', 'r'], 6],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': C.yellow,
        'circle-stroke-width': 2.5,
      },
    });
    map.addLayer({
      id: 'stations-hit',
      type: 'circle',
      source: 'stations',
      paint: {
        'circle-radius': ['+', ['get', 'r'], 8],
        'circle-color': '#000000',
        'circle-opacity': 0.01,
      },
    });
    map.on('click', 'stations-hit', (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      tip.hide();
      if (opts.onClick) opts.onClick(f.properties.id);
    });
    map.on('mousemove', 'stations-hit', (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features && e.features[0];
      const r = f && byId.get(f.properties.id);
      if (r) tip.show(r.tip || r.popup, e.point);
    });
    map.on('mouseleave', 'stations-hit', () => {
      map.getCanvas().style.cursor = '';
      tip.hide();
    });
    map.on('move', () => tip.hide());
    if (rows.length) {
      const b = new maplibregl.LngLatBounds();
      rows.forEach((r) => b.extend([r.lon, r.lat]));
      if (rows.length === 1) map.setCenter([rows[0].lon, rows[0].lat]);
      else map.fitBounds(b, { padding: 42, duration: 0, maxZoom: 5.2 });
    }
    if (opts.zoom !== false) addMapZoom(map);
    if (opts.labels) addStationLabels(map, rows);
    if (opts.islands !== false) addIslandLabels(map);
    if (opts.choropleth) addChoropleth(map, opts.choropleth === true ? {} : opts.choropleth);
  });
  const legend = document.getElementById(id.replace('map', 'legend'));
  if (legend) {
    legend.dataset.kind = opts.legendKind || (opts.choropleth ? 'choro' : '');
    legend.dataset.dots = rows.length ? '1' : '';
    legend.classList.toggle('is-choro', legend.dataset.kind === 'choro');
    if (opts.legend) legend.innerHTML = opts.legend;
  }
  return map;
}

function makeMapTip(el) {
  const node = document.createElement('div');
  node.className = 'map-tip';
  node.hidden = true;
  // Portal ke body: kartu map memakai backdrop-filter, yang membuat kartu menjadi
  // containing block position:fixed -> tooltip bergeser jauh dari kursor.
  document.body.appendChild(node);
  let timer = 0;
  let point = null;
  let html = '';
  const position = () => {
    if (node.hidden || !point) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let x = rect.left + point.x + 12;
    let y = rect.top + point.y - h - 14;
    if (y < 6) y = rect.top + point.y + 18;
    x = Math.max(6, Math.min(window.innerWidth - w - 6, x));
    y = Math.max(6, Math.min(window.innerHeight - h - 6, y));
    node.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  };
  const hide = () => {
    clearTimeout(timer);
    node.hidden = true;
    html = '';
  };
  const onScroll = () => hide();
  window.addEventListener('scroll', onScroll, true);
  return {
    show(next, nextPoint) {
      if (!next) return;
      point = nextPoint;
      if (next !== html) {
        html = next;
        node.innerHTML = next;
      }
      if (node.hidden) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          node.hidden = false;
          position();
        }, 90);
      } else {
        position();
      }
    },
    hide,
    destroy() {
      window.removeEventListener('scroll', onScroll, true);
      clearTimeout(timer);
      node.remove();
    },
  };
}

function addMapZoom(map) {
  const el = map.getContainer();
  const wrap = document.createElement('div');
  wrap.className = 'map-zoom';
  wrap.innerHTML = '<button type="button" data-zoom="in" aria-label="Perbesar peta" title="Perbesar">+</button>'
    + '<button type="button" data-zoom="out" aria-label="Perkecil peta" title="Perkecil">−</button>';
  el.appendChild(wrap);
  const btnIn = wrap.querySelector('[data-zoom="in"]');
  const btnOut = wrap.querySelector('[data-zoom="out"]');
  const sync = () => {
    const z = map.getZoom();
    btnIn.disabled = z >= 7;
    btnOut.disabled = z <= 2.8;
  };
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const z = map.getZoom();
    const next = b.dataset.zoom === 'in' ? Math.min(7, z + 0.8) : Math.max(2.8, z - 0.8);
    map.easeTo({ zoom: next, duration: 260 });
  });
  sync();
  map.on('zoom', sync);
}

function addStationLabels(map, rows) {
  const el = map.getContainer();
  const layer = document.createElement('div');
  layer.className = 'map-labels';
  el.appendChild(layer);
  const nodeById = new Map();
  rows.forEach((r) => {
    const n = document.createElement('span');
    n.className = 'map-label';
    n.dataset.id = r.id;
    n.hidden = true;
    layer.appendChild(n);
    nodeById.set(r.id, n);
  });

  let clusters = [];
  let placed = [];
  let frame = 0;

  const chrome = () => {
    const base = el.getBoundingClientRect();
    const out = [];
    [el, el.parentElement].filter(Boolean).forEach((scope) => {
      scope.querySelectorAll('.map-legend,.map-badge,.map-zoom').forEach((s) => {
        const b = s.getBoundingClientRect();
        if (!b.width || !b.height) return;
        out.push({ x: b.left - base.left - 2, y: b.top - base.top - 2, w: b.width + 4, h: b.height + 4 });
      });
    });
    return out;
  };

  const group = (pts, merges) => {
    const parent = pts.map((_, i) => i);
    const find = (i) => {
      let j = i;
      while (parent[j] !== j) {
        parent[j] = parent[parent[j]];
        j = parent[j];
      }
      return j;
    };
    pts.forEach((a, i) => {
      pts.forEach((b, j) => {
        if (j <= i) return;
        if (Math.hypot(a.x - b.x, a.y - b.y) >= 14) return;
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[rj] = ri;
      });
    });
    const groups = new Map();
    pts.forEach((p, i) => {
      const k = find(i);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    });
    let list = [...groups.values()].map((g) => ({
      pts: g,
      rep: g.reduce((best, cur) => ((cur.r.mean || 0) > (best.r.mean || 0) ? cur : best), g[0]),
    }));
    for (let guard = 0; guard < 60; guard += 1) {
      const index = new Map(list.map((c) => [c.rep.r.id, c]));
      let acted = false;
      for (const c of list) {
        const target = merges.get(c.rep.r.id);
        if (!target) continue;
        const dst = index.get(target);
        if (!dst || dst === c) continue;
        dst.pts = dst.pts.concat(c.pts);
        merges.forEach((v, k) => {
          if (v === c.rep.r.id) merges.set(k, dst.rep.r.id);
        });
        list = list.filter((k) => k !== c);
        acted = true;
        break;
      }
      if (!acted) break;
    }
    return list.sort((a, b) => ((b.rep.r.selected ? 1e6 : 0) + (b.rep.r.mean || 0))
      - ((a.rep.r.selected ? 1e6 : 0) + (a.rep.r.mean || 0)));
  };

  const layout = (merges) => {
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!W || !H) return null;
    const pts = rows
      .map((r) => {
        const p = map.project([r.lon, r.lat]);
        return { r, x: p.x, y: p.y };
      })
      .filter((p) => p.x > -30 && p.x < W + 30 && p.y > -30 && p.y < H + 30);
    const list = group(pts, merges);
    const occupied = chrome();
    pts.forEach((p) => {
      const rad = 3;
      occupied.push({ id: p.r.id, x: p.x - rad, y: p.y - rad, w: rad * 2, h: rad * 2 });
    });
    nodeById.forEach((n) => {
      n.hidden = true;
      n.style.visibility = '';
    });
    const ok = [];
    const failed = [];
    list.forEach((c) => {
      const node = nodeById.get(c.rep.r.id);
      if (!node) return;
      node.innerHTML = esc(c.rep.r.id) + (c.pts.length > 1
        ? ` <span class="n" role="button" tabindex="0" aria-label="Zoom ke ${c.pts.length} stasiun di sekitar sini">+${c.pts.length - 1}</span>`
        : '');
      node.classList.toggle('is-sel', !!c.rep.r.selected);
      node.hidden = false;
      node.style.visibility = 'hidden';
      const lw = node.offsetWidth;
      const lh = node.offsetHeight;
      const x = c.rep.x;
      const y = c.rep.y;
      // Labels always sit ABOVE their dot (never below/side) so the eye never
      // re-scans the map. Horizontal nudge is allowed; if nothing fits the label
      // is merged into the nearest one as +n by the merge rounds in place().
      const cands = [];
      [-8, -12, -16].forEach((dy, row) => {
        const dxs = row === 0 ? [0, 4, -4, 8, -8, 12, -12, 16, -16] : [0, 4, -4, 8, -8, 12, -12];
        dxs.forEach((dx) => cands.push([x - lw / 2 + dx, y - lh + dy]));
      });
      let hit = null;
      for (const [lx, ly] of cands) {
        if (lx < 3 || ly < 3 || lx + lw > W - 3 || ly + lh > H - 3) continue;
        const box = { x: lx - 1, y: ly - 1, w: lw + 2, h: lh + 2 };
        const clash = occupied.some((o) => box.x < o.x + o.w && o.x < box.x + box.w
          && box.y < o.y + o.h && o.y < box.y + box.h);
        if (clash) continue;
        hit = [lx, ly];
        break;
      }
      if (!hit) {
        node.hidden = true;
        node.style.visibility = '';
        failed.push(c);
        return;
      }
      node.style.visibility = '';
      node.style.transform = `translate(${Math.round(hit[0])}px,${Math.round(hit[1])}px)`;
      occupied.push({ x: hit[0], y: hit[1], w: lw, h: lh });
      ok.push({ c, dx: hit[0] - x, dy: hit[1] - y, node });
    });
    return { ok, failed };
  };

  const place = () => {
    const merges = new Map();
    let res = layout(merges);
    if (!res) return;
    for (let round = 0; round < 4 && res.failed.length; round += 1) {
      if (!res.ok.length) break;
      res.failed.forEach((c) => {
        let best = null;
        res.ok.forEach((k) => {
          const d = Math.hypot(k.c.rep.x - c.rep.x, k.c.rep.y - c.rep.y);
          if (!best || d < best.d) best = { d, id: k.c.rep.r.id };
        });
        if (best) merges.set(c.rep.r.id, best.id);
      });
      const next = layout(merges);
      if (!next) break;
      res = next;
    }
    clusters = res.ok.map((k) => k.c).concat(res.failed);
    placed = res.ok.map((k) => ({ r: k.c.rep.r, dx: k.dx, dy: k.dy, node: k.node }));
  };

  const shift = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      placed.forEach((p) => {
        const q = map.project([p.r.lon, p.r.lat]);
        p.node.style.transform = `translate(${Math.round(q.x + p.dx)}px,${Math.round(q.y + p.dy)}px)`;
      });
    });
  };

  map.on('moveend', place);
  map.on('zoomend', place);
  map.on('resize', place);
  map.on('move', shift);

  layer.addEventListener('click', (e) => {
    const chip = e.target.closest('.n');
    if (!chip) return;
    e.stopPropagation();
    const host = chip.closest('.map-label');
    const c = clusters.find((k) => k.rep.r.id === (host && host.dataset.id));
    if (!c || c.pts.length < 2) return;
    const b = new maplibregl.LngLatBounds();
    c.pts.forEach((p) => b.extend([p.r.lon, p.r.lat]));
    map.fitBounds(b, { padding: 64, maxZoom: 6.4, duration: 520 });
  });
  layer.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const chip = e.target.closest('.n');
    if (!chip) return;
    e.preventDefault();
    chip.click();
  });

  place();
}

function addIslandLabels(map) {
  const labels = [
    ['SUMATERA', 101.4, -0.6],
    ['KALIMANTAN', 113.6, -0.6],
    ['JAWA', 111.4, -8.7],
    ['SULAWESI', 122.4, -5.6],
    ['PAPUA', 138.2, -4.6],
  ];
  labels.forEach(([text, lon, lat]) => {
    const el = document.createElement('div');
    el.className = 'map-island-label';
    el.textContent = text;
    new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lon, lat]).addTo(map);
  });
}

/* ------------------------------------------------------------------ tip */
function initTip() {
  const tip = $('#tip');
  let current = null;
  const show = (el) => {
    const html = el.dataset.tipHtml;
    const text = el.dataset.tip;
    if (!html && !text) return;
    current = el;
    if (html) tip.innerHTML = html; else tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const pad = 8;
    const x = Math.min(window.innerWidth - tw - pad, Math.max(pad, r.left + r.width / 2 - tw / 2));
    // taruh di bawah pemicu; kalau ruang bawah kurang (mis. filterbar mobile menempel di bawah
    // layar) balik ke atas supaya tooltip tidak terpotong
    const below = window.innerHeight - r.bottom - pad;
    let y;
    if (below >= th) y = r.bottom + 6;
    else if (r.top - th - 6 >= pad) y = r.top - th - 6;
    else y = Math.max(pad, Math.min(window.innerHeight - th - pad, r.bottom + 6));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => { current = null; tip.hidden = true; };
  document.addEventListener('mouseover', (e) => {
    // di layar sentuh, Chromium tetap memancarkan mouseover tiruan setelah tap — kalau tidak
    // dibatasi, tooltip muncul menutupi sheet filter setiap kali opsi rentang dipilih
    if (!window.matchMedia('(hover: hover)').matches) return;
    const el = e.target.closest('[data-tip],[data-tip-html]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tip],[data-tip-html]');
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip],[data-tip-html]');
    // hanya muncul untuk fokus keyboard: tap di layar sentuh juga memicu focusin dan
    // tooltip akan menutupi sheet filter
    if (el && el.matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true);
}

/* ------------------------------------------------------------------ start */
boot();
