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
  tab: {},
  sourceMode: 'all',
  lagOutcome: 'resp',
  story: false,
  scene: 1,
  compare: [],
  compareA: null,
  compareB: null,
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
let storyChart = null;

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

function downloadCSV(filename, rows) {
  const body = rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\n');
  const blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  if (!window.echarts || !window.maplibregl) {
    $('#page').innerHTML = `<div class="empty"><div>Library chart belum termuat.</div><div class="card-sub">Periksa koneksi CDN, lalu muat ulang.</div></div>`;
    return;
  }
  const files = ['meta', 'overview', 'stations', 'time', 'sources', 'health', 'network', 'method'];
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
  parseUrl();
  initShell();
  if (state.story) {
    openStory(state.scene, false);
  } else {
    render();
  }
  fit();
  window.addEventListener('resize', () => {
    fit();
    requestAnimationFrame(() => {
      charts.forEach((c) => { try { c.resize(); } catch (_) {} });
      maps.forEach((m) => { try { m.resize(); } catch (_) {} });
      if (storyChart) { try { storyChart.resize(); } catch (_) {} }
    });
  });
}

function fit() {
  const app = $('#app');
  if (app) app.style.transform = '';
}

function parseUrl() {
  const p = new URLSearchParams(location.search);
  const page = p.get('page');
  if (['ringkasan', 'waktu', 'wilayah', 'sumber', 'kesehatan', 'jaringan', 'metodologi'].includes(page)) state.page = page;
  const island = p.get('island');
  if (island && (island === 'Semua' || DATA.islands.includes(island))) state.island = island;
  const station = p.get('station');
  if (station && DATA.stationsById.has(station)) state.station = station;
  if (p.get('mode') === 'story') {
    state.story = true;
    const scene = Number(p.get('scene'));
    if (scene >= 1 && scene <= 6) state.scene = scene;
  }
  const tab = p.get('tab');
  if (tab) state.tab[state.page] = tab;
  const src = p.get('source');
  if (src === 'only2026' || src === 'all') state.sourceMode = src;
}

function updateUrl() {
  const p = new URLSearchParams();
  if (state.page !== 'ringkasan') p.set('page', state.page);
  if (state.island !== 'Semua') p.set('island', state.island);
  if (state.station) p.set('station', state.station);
  const t = state.tab[state.page];
  if (t) p.set('tab', t);
  if (state.sourceMode !== 'all') p.set('source', state.sourceMode);
  if (state.story) {
    p.set('mode', 'story');
    p.set('scene', String(state.scene));
  }
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
    render();
  });
  stationSel.addEventListener('change', () => {
    state.station = stationSel.value || null;
    if (!state.station && state.page === 'ringkasan') state.origin = null;
    render();
  });
  $('#btn-reset').addEventListener('click', () => {
    state.island = 'Semua';
    state.station = null;
    render();
  });
  $$('.nav-item').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    go(a.dataset.page);
  }));
  $$('#mode-switch button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'story') openStory(1);
    else { closeStory(); go('ringkasan'); }
  }));
  $('#btn-share').addEventListener('click', shareLink);
  $('#more-share').addEventListener('click', () => { closeMore(); shareLink(); });
  $('#btn-download').addEventListener('click', downloadMetrics);
  $('#more-download').addEventListener('click', () => { closeMore(); downloadMetrics(); });
  $('#story-close').addEventListener('click', closeStory);
  $('#story-prev').addEventListener('click', () => setScene(state.scene - 1));
  $('#story-next').addEventListener('click', () => {
    if (state.scene === 6) closeStory();
    else setScene(state.scene + 1);
  });
  $('#story-dots').innerHTML = Array.from({ length: 6 }, (_, i) => `<button class="story-dot" data-scene="${i + 1}" type="button" aria-label="Adegan ${i + 1}"></button>`).join('');
  $$('#story-dots .story-dot').forEach((b) => b.addEventListener('click', () => setScene(Number(b.dataset.scene))));
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
      else if (state.story) closeStory();
    }
    if (state.story) {
      if (e.key === 'ArrowRight') setScene(state.scene + 1);
      if (e.key === 'ArrowLeft') setScene(state.scene - 1);
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
  $('#more-story').addEventListener('click', () => { closeMore(); openStory(1); });
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

function downloadMetrics() {
  const a = document.createElement('a');
  a.href = 'data/metrics.json';
  a.download = 'metrics.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  go(dest.page);
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
  const src = e.target.closest('[data-source]');
  if (src) {
    state.sourceMode = src.dataset.source;
    render();
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
    if (a === 'export-station') exportStation();
    if (a === 'compare-station') {
      const spec = detailCompare();
      if (spec) openDetail(spec);
    }
    if (a === 'download-metrics') {
      const link = document.createElement('a');
      link.href = 'data/metrics.json';
      link.download = 'metrics.json';
      link.click();
    }
    if (a === 'download-stations') {
      const link = document.createElement('a');
      link.href = 'data/stations.json';
      link.download = 'stations.json';
      link.click();
    }
    if (a === 'download-overview') {
      downloadCSV('napas_ranking_2026.csv', [['station', 'island', 'mean_2026', 'p95_2026', 'max_2026', 'days_2026', 'status'], ...topRows().map((r) => [r.id, r.island, r.mean_2026, r.p95_2026, r.max_2026, r.days_2026, r.status])]);
    }
    if (a === 'download-time') {
      downloadCSV('napas_bulanan.csv', [['month', 'pm25', 'stations', 'days'], ...DATA.overview.monthly.map((r) => [r.month, r.pm25, r.stations, r.days])]);
    }
    if (a === 'download-source') {
      const rows = sourceRows();
      downloadCSV('napas_sumber.csv', [['station', 'pm25', 'baseline', 'distance', 'traffic', 'days', 'status'], ...rows.map((r) => [r.station, r.pm25, r.baseline, r.distance, r.traffic, r.days, r.status])]);
    }
    if (a === 'download-health') {
      downloadCSV('napas_kesehatan.csv', [['outcome', 'actual', 'expected', 'excess'], ...DATA.health.outcomes.map((o) => [o.label, DATA.health.years[2].actual[o.key], DATA.health.years[2].expected[o.key], DATA.health.years[2].excess[o.key]])]);
    }
    if (a === 'download-daily') {
      downloadCSV('napas_harian_nasional.csv', [['date', 'pm25', 'stations'], ...DATA.time.daily.map((r) => [r[0], r[1], r[2]])]);
    }
    if (a === 'download-network') {
      const rows = networkRows();
      downloadCSV('napas_jaringan.csv', [['station', 'island', 'status', 'usable_pct', 'mean_2026', 'gap'], ...rows.map((r) => [r.station, r.island, r.status, r.usable_pct, r.mean_2026, r.gap])]);
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
  ringkasan: 'Ringkasan', waktu: 'Waktu', wilayah: 'Wilayah', sumber: 'Sumber',
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
    sourceMode: state.sourceMode,
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
  state.sourceMode = origin.sourceMode;
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
    <div class="detail-note">Klik stasiun untuk membuka profil · 1 Agu–14 Okt 2026</div>`;
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
    <div class="detail-list"><div class="row"><span>Hari >55 µg/m³</span><b>${fmtInt(episode)}</b></div></div>`;
  return {
    key: `island:${name}`,
    kicker: 'Ranking pulau · 1 Agu–14 Okt 2026',
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

function scopeLabel() {
  return state.station || (state.island === 'Semua' ? 'Nasional' : state.island);
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

function detailDiurnalClass(cls) {
  const series = DATA.time.diurnal_class[cls] || {};
  const members = DATA.stations.stations.filter((s) => s.site_class === cls);
  const hours = Array.from({ length: 24 }, (_, h) => String(h));
  const vals = hours.map((h) => Number(series[h])).filter((v) => Number.isFinite(v));
  const peak = vals.length ? Math.max(...vals) : null;
  const low = vals.length ? Math.min(...vals) : null;
  const body = `
    ${detailMetrics([
      ['Kelas', esc(cls), ''],
      ['Puncak', peak == null ? '—' : fmt(peak, 1), '%'],
      ['Terendah', low == null ? '—' : fmt(low, 1), '%'],
    ])}
    <div class="detail-block"><div class="detail-label">Indeks 24 jam · 100 = rata-rata</div>
      ${detailBars(hours.map((h) => ({ label: `${String(h).padStart(2, '0')}`, value: Number(series[h]), color: Number(series[h]) >= 100 ? (DIURNAL_COLORS[cls] || C.navy) : C.grey2, display: `${fmt(series[h], 0)}%` })))}
    </div>
    <div class="detail-block"><div class="detail-label">Stasiun kelas ini</div>
      ${detailBars(members.map((s) => ({ label: s.id, value: s.mean_2026, id: s.id, color: CAT_COLORS[categoryFromPm(s.mean_2026)] || C.navy })))}
    </div>`;
  return {
    key: `diurnal:${cls}`,
    kicker: 'Siklus 24 jam per kelas lokasi',
    title: cls,
    chip: cls,
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
  const cat = s.ispu_dominant || '—';
  const val = `${s.lower_bound ? '≥' : ''}${fmt(s.mean_2026, 1)}`;
  return `<div class="map-tip-h"><span class="dot" style="background:${catColor(cat)}"></span><b>${esc(s.id)}</b><span class="cat">${esc(cat)}</span></div>`
    + `<div class="map-tip-n">${val}<small> µg/m³</small><small class="sep"> · P95 ${fmt(s.p95_2026, 1)}</small></div>`
    + `<div class="map-tip-s">${esc(s.city)}</div>`;
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
      ['PM2.5 2026', `${st.lower_bound ? '≥' : ''}${fmt(st.mean_2026, 1)}`, 'µg/m³'],
      ['P95', fmt(st.p95_2026, 1), 'µg/m³'],
      ['Maksimum', fmt(st.max_2026, 1), 'µg/m³'],
      ['Kelayakan', fmt(st.usable_pct, 1), '%'],
    ])}
    <div class="detail-block"><div class="detail-label">Komposisi ISPU</div>${detailStack(comp, st.days_2026)}</div>
    <div class="detail-block"><div class="detail-label">12 bulan terakhir</div>${detailBars(months.map((r) => ({ label: monthLabel(r.month), value: r.pm25, color: CAT_COLORS[categoryFromPm(r.pm25)] || C.navy })))}</div>
    <div class="detail-list">
      <div class="row"><span>Kota · provinsi</span><b>${esc(st.city)} · ${esc(st.province)}</b></div>
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
    <div class="detail-note">Korelasi jam-jaman antar polutan · r negatif berwarna jingga</div>`;
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
  const id = state.windStation || 'PLB-01';
  const w = DATA.sources.windrose[id];
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

function detailMeteo(id) {
  const row = (DATA.sources.meteo_corr || []).find((r) => r.station === id);
  if (!row) return null;
  const hasWind = filteredSourceStations().includes(id) && !!DATA.sources.windrose[id];
  const bars = [
    { label: 'Suhu', value: row.temp == null ? 0 : Math.abs(row.temp), display: fmtR(row.temp), color: C.terra },
    { label: 'Kelembapan', value: row.hum == null ? 0 : Math.abs(row.hum), display: fmtR(row.hum), color: C.teal },
    { label: 'Angin', value: row.wind == null ? 0 : Math.abs(row.wind), display: fmtR(row.wind), color: C.navy },
  ];
  const body = `
    ${detailMetrics([
      ['Observasi', fmtInt(row.n), 'jam'],
      ['r terkuat', bars.slice().sort((a, b) => b.value - a.value)[0].label, ''],
      ['Pulau', esc(row.island || '—'), ''],
    ])}
    <div class="detail-block"><div class="detail-label">Korelasi meteorologi · |r|</div>${detailBars(bars)}</div>
    ${hasWind ? `<button class="primary-btn detail-cta" type="button" data-wind="${esc(id)}">Lihat wind rose</button>` : '<div class="detail-note">Wind rose tidak tersedia untuk stasiun ini</div>'}`;
  return {
    key: `meteo:${id}`,
    kicker: 'Meteorologi · korelasi jam-jaman',
    title: id,
    chip: id,
    body,
    after: (root) => {
      const btn = root.querySelector('[data-wind]');
      if (btn) btn.addEventListener('click', () => {
        state.windStation = id;
        closeDetail(true);
        render();
      });
    },
  };
}

/* ------------------------------------------------------- detail: kesehatan */
function detailOutcome(key) {
  const o = (DATA.health.outcomes || []).find((x) => x.key === key);
  if (!o) return null;
  const years = healthYears();
  const y = years[years.length - 1];
  if (!y) return null;
  const a = y.actual[key];
  const e = y.expected[key];
  const ex = y.excess[key];
  const totalResp = y.actual.resp || 0;
  const scope = state.island === 'Semua' ? 'nasional' : state.island;
  const body = `
    ${detailMetrics([
      ['Aktual', fmtInt(a), 'kasus'],
      ['Expected', fmtInt(e), 'kasus'],
      ['Kelebihan', `+${fmtInt(ex)}`, 'kasus'],
    ])}
    <div class="detail-block"><div class="detail-label">Kelebihan per tahun</div>
      ${detailBars(years.map((r) => ({ label: String(r.year), value: r.excess[key], color: r.year === y.year ? C.navy : C.grey2, display: `+${fmtInt(r.excess[key])}` })))}
    </div>
    <div class="detail-list">
      <div class="row"><span>Rasio aktual / expected</span><b>${e ? `${fmt(a / e, 2)}×` : '—'}</b></div>
      <div class="row"><span>Porsi dari respirasi</span><b>${totalResp ? `${fmt(a / totalResp * 100, 1)}%` : '—'}</b></div>
      <div class="row"><span>Jendela</span><b>${y.days} hari</b></div>
    </div>
    <div class="detail-note">Estimasi asosiatif: aktual − expected, bukan klaim kausal</div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="kesehatan">Buka Kesehatan</button>`;
  return {
    key: `outcome:${key}`,
    kicker: `Observed vs expected · ${scope} · 1 Agu–14 Okt 2026`,
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
  const isl = (DATA.health.by_island || {});
  const islRows = Object.keys(isl).map((name) => {
    const row = (isl[name] || []).find((x) => x.year === year);
    return { label: name, value: row ? row.excess.resp : 0, color: ISLAND_COLORS[name] || C.navy, display: row ? `+${fmtInt(row.excess.resp)}` : '—' };
  }).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const body = `
    ${detailMetrics([
      ['Hari', fmtInt(r.days), 'hari'],
      ['Respirasi', `+${fmtInt(r.excess.resp)}`, 'kasus'],
      ['Kematian', `+${fmtInt(r.excess.death)}`, 'kasus'],
    ])}
    <div class="detail-block"><div class="detail-label">Kelebihan respirasi per pulau</div>${detailBars(islRows)}</div>
    <div class="detail-list">
      <div class="row"><span>Aktual respirasi</span><b>${fmtInt(r.actual.resp)}</b></div>
      <div class="row"><span>Expected respirasi</span><b>${fmtInt(r.expected.resp)}</b></div>
      <div class="row"><span>Aktual kematian</span><b>${fmtInt(r.actual.death)}</b></div>
    </div>`;
  return {
    key: `healthyear:${year}`,
    kicker: 'Kelebihan per tahun',
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
      ['Kunjungan aktual', fmtInt(r.resp_actual), 'kasus'],
      ['Kelebihan', `+${fmtInt(r.resp)}`, 'kasus'],
    ])}
    <div class="detail-block"><div class="detail-label">r lag 0 per outcome</div>${detailBars(bars)}</div>
    <div class="detail-list">
      <div class="row"><span>Hari episode</span><b>${fmtInt(r.episode_days)} hari</b></div>
      <div class="row"><span>Hari layak</span><b>${fmt(r.usable_pct, 1)}%</b></div>
      <div class="row"><span>Status</span><b>${esc(r.status)}</b></div>
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
function detailQc(segment) {
  const qc = DATA.network.qc_detail || {};
  const totals = DATA.network.qc_totals || {};
  const v = totals[segment];
  if (v == null) return null;
  const grand = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const bars = Object.entries(qc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ label: k, value: n, color: k === segment ? C.navy : C.grey2, display: fmtInt(n) }));
  const body = `
    ${detailMetrics([
      ['Baris', fmtInt(v), 'baris'],
      ['Porsi', fmt(v / grand * 100, 1), '%'],
      ['Segmen', esc(segment), ''],
    ])}
    <div class="detail-block"><div class="detail-label">Rincian status QC</div>${detailBars(bars)}</div>
    <div class="detail-note">Total baris tersegmentasi ${fmtInt(grand)}</div>`;
  return {
    key: `qc:${segment}`,
    kicker: 'Komposisi QC · 2024–2026',
    title: segment,
    chip: segment,
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
      ['Baris VALID', valid == null ? '—' : fmt(valid, 1), '%'],
    ])}
    <div class="detail-block"><div class="detail-label">Kelengkapan 12 bulan</div>
      ${detailBars(comp.map((r) => ({ label: monthLabel(r.month), value: r.pct, color: r.pct < 80 ? C.terra : r.pct < 95 ? C.yellow : C.teal, display: `${fmt(r.pct, 0)}%` })))}
    </div>
    <div class="detail-list">
      <div class="row"><span>Status</span><b>${esc(s.status)}</b></div>
      <div class="row"><span>Mean 2026</span><b>${fmt(s.mean_2026, 1)} µg/m³</b></div>
      <div class="row"><span>Hari 2026</span><b>${fmtInt(s.days_2026)} hari</b></div>
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
  maps.forEach((m) => { try { m.remove(); } catch (_) {} });
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
  $('#period-pill').textContent = periodLabel();
  $('#foot-hash').textContent = `metrics ${DATA.meta.metrics_sha256.slice(0, 12)}…`;
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
  switch (state.page) {
    case 'waktu': return '2024–2026';
    case 'wilayah': return DATA.meta.periods.haze;
    case 'sumber': return state.sourceMode === 'all' ? '2024–2026' : '2026';
    case 'kesehatan': return DATA.meta.periods.haze;
    case 'jaringan': return 'seluruh periode';
    case 'metodologi': return 'seluruh periode';
    default: return DATA.meta.periods.window;
  }
}

function syncFilters() {
  const islandPages = ['ringkasan', 'waktu', 'wilayah', 'sumber', 'kesehatan', 'jaringan'];
  const stationPages = ['ringkasan', 'waktu', 'wilayah'];
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
  return `<div class="page-head">
    <div><h1 class="page-title">${title}</h1><div class="page-meta">${meta}</div></div>
    <div class="page-actions">${actions}</div>
  </div>`;
}

function card(title, sub, body, opts = {}) {
  const id = opts.id ? ` id="${opts.id}"` : '';
  const cls = opts.cls ? ` ${opts.cls}` : '';
  const right = opts.right || `<div class="card-sub">${sub}</div>`;
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
const DIURNAL_COLORS = { 'Clean/Regional': '#0F9D8A', Industrial: '#D9663F', 'Peatland/Forest': '#6B9B2E', 'Traffic/Roadside': '#182048', 'Urban Background': '#E3A008' };

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
  const topLabel = topStation ? `${topStation.lower_bound ? '≥' : ''}${fmt(topStation.mean_2026 ?? scope.mean, 1)}` : '—';
  const health = healthYears()[2];
  const scopedHealth = state.station ? healthStationExcess(state.station) : null;
  const scopeName = state.station || (state.island === 'Semua' ? 'nasional' : state.island);
  const resp = scopedHealth ? scopedHealth.resp : health.excess.resp;
  const respDays = scopedHealth ? scopedHealth.days : health.days;
  return [
    {
      id: 'mean', label: 'Rata-rata PM2.5', value: scope.mean, unit: 'µg/m³',
      baseline: catBadge(cat), window: '1 Sep–14 Okt',
      note: `${scopeName} · n=${fmtInt(scope.days)} hari-stasiun · ${scope.stations} stasiun · exclude JMB-02/MER-01`,
    },
    {
      id: 'above55', label: 'Hari melampaui 55 µg/m³', value: scope.above55_pct, unit: '%',
      baseline: `${fmtInt(scope.severe_n)} hari >150,4`, window: '1 Sep–14 Okt',
      note: `${scopeName} · ${fmtInt(scope.above55_n)} hari-stasiun >55 dari ${fmtInt(scope.days)} hari`,
    },
    {
      id: 'heaviest', label: 'Stasiun terberat', value: topLabel, unit: topStation ? ` ${topStation.id}` : '',
      baseline: `${categoryFromPm(topStation ? topStation.mean_2026 : 0)} · ISPU`, window: '1 Agu–14 Okt',
      note: topStation ? `${topStation.id} · ${topStation.lower_bound ? '≥' : ''}${fmt(topStation.mean_2026, 1)} µg/m³ · 1 Agu–14 Okt 2026` : 'Tidak ada stasiun pada filter',
    },
    {
      id: 'resp', label: 'Estimasi kelebihan respirasi', value: resp, unit: 'kasus',
      baseline: 'estimasi asosiatif', window: '1 Agu–14 Okt',
      note: `${scopeName} · 1 Agu–14 Okt 2026 · ${respDays} hari · aktual − expected; bukan kausal`,
    },
  ];
}

function healthStationExcess(id) {
  const r = (DATA.health.stations || []).find((s) => s.station === id);
  if (!r) return null;
  return { resp: r.resp, days: r.days, excess: r };
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

function kpiCard2(k) {
  const value = k.id === 'resp' ? fmtInt(k.value) : k.value;
  const est = k.id === 'resp';
  const valHtml = typeof value === 'number' ? fmt(value, 1) : value;
  const dest = KPI_DEST[k.id];
  if (!dest) {
    return `<div class="kpi" data-id="${k.id}">
      <div class="kpi-top">${kpiIcon(k.id)}<div class="kpi-label">${k.label}</div><span class="info" tabindex="0" data-tip="${esc(k.note)}">i</span></div>
      <div class="kpi-value-row"><span class="kpi-value${k.id === 'heaviest' ? ' small' : ''}">${valHtml}</span><span class="kpi-unit">${k.unit}</span></div>
      <div class="kpi-bottom"><span class="kpi-base ${est ? 'est' : ''}">${k.baseline}</span>${k.window ? `<span class="kpi-window">${k.window}</span>` : ''}</div>
    </div>`;
  }
  const destLabel = `Buka ${PAGE_NAMES[dest.page] || 'rincian'}`;
  return `<div class="kpi is-link" data-id="${k.id}" data-kpi="${k.id}" role="link" tabindex="0" aria-label="${esc(`${k.label}: ${valHtml} ${k.unit || ''} — ${destLabel}`)}">
    <div class="kpi-top">${kpiIcon(k.id)}<div class="kpi-label">${k.label}</div><span class="info" tabindex="0" data-tip="${esc(k.note)}">i</span></div>
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
  if (state.island === 'Semua') return DATA.health.years;
  return DATA.health.by_island[state.island] || DATA.health.years;
}

function healthLag() {
  if (state.island === 'Semua') return DATA.health.lag;
  return DATA.health.lag_by_island[state.island] || DATA.health.lag;
}

function healthStations() {
  const rows = DATA.health.stations;
  if (state.island === 'Semua') return rows;
  return rows.filter((r) => r.island === state.island);
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
  return `<span class="pill static" data-tip="Rata-rata nasional 2026 dibanding 2024 · ${esc(DATA.meta.periods.window)}">${fmtRatio(ratio ? ratio.ratio : null)}× 2024</span>
    <span class="pill static" data-tip="Baris valid ${fmtInt(dq.valid_rows)} dari ${fmtInt(dq.raw_rows)} baris mentah">${fmt(dq.valid_overall_pct, 1)}% data layak</span>
    <span class="pill warning" data-tip="${esc((DATA.network.blind_spots || []).join(' · '))}">${blind} wilayah tanpa stasiun</span>`;
}

function renderOverview() {
  const d = DATA.meta.data_quality;
  const meta = `${DATA.meta.periods.window} · ${d.stations} stasiun · ${d.provinces} provinsi · data hingga ${DATA.meta.periods.data_end}`;
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
        <div class="card-head"><div class="card-title">Peta hotspot</div><div class="card-head-right"><div class="card-sub">ISPU dominan · 1 Agu–14 Okt 2026</div></div></div>
        <div class="card-body"><div class="map" id="map-overview"></div><div class="map-legend" id="legend-overview"></div></div>
      </section>
      ${card(trendTitle, 'µg/m³ · bulanan · garis PP 55 & WHO 15', `<div class="chart" id="chart-trend"></div>`, { cls: 'h-420', right: `<div class="card-sub">P95 ${fmt(trend.p95, 1)} · Okt ${trend.partialDays} hari</div>` })}
    </div>
    <div class="grid-12">
      ${card('Ranking pulau', 'µg/m³ · 1 Agu–14 Okt 2026', `<div class="chart" id="chart-rank-island"></div>`, { cls: 'span-3 h-320' })}
      ${card('Siklus 24 jam', 'indeks % · 100 = rata-rata harian', `<div class="chart" id="chart-cycle"></div>`, { cls: 'span-4 h-320' })}
      ${card('Observed vs expected', `kasus · ${healthYears()[2].days} hari`, `<div class="chart" id="chart-ov-health"></div>`, { cls: 'span-5 h-320', right: '<div class="card-sub">aktual / expected</div>' })}
    </div>
    <div class="grid-12">
      ${card(islandCompTitle, '% hari-stasiun', `<div class="chart" id="chart-ispu-island"></div>` + ispuStackLegend(), { cls: 'span-6 h-280' })}
      ${card('Perbandingan 5 kelas lokasi', 'baseline vs mean 2026 · µg/m³', `<div class="chart" id="chart-class"></div>`, { cls: 'span-6 h-280', right: '<div class="card-sub">klik untuk rincian</div>' })}
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
    color: catColor(s.ispu_dominant),
    r: s.mean_2026 == null ? 4.5 : 4 + Math.min(4, s.mean_2026 / 90),
    selected: s.id === state.station,
    mean: s.mean_2026,
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
    labels: true,
    islands: false,
    zoom: true,
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
    grid: { left: 78, right: 42, top: 6, bottom: 22 },
    yFont: 8.5,
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
  const sub = state.station ? `${state.station} · 2024–2026` : (state.island === 'Semua' ? 'Nasional 2024–2026' : `${state.island} 2024–2026`);
  const st = state.station ? DATA.stationsById.get(state.station) : null;
  const hours = st ? (DATA.time.station_hour[state.station] || []) : (state.island !== 'Semua' && DATA.time.hour_dow_by_island[state.island] ? aggregateHours(DATA.time.hour_dow_by_island[state.island]) : (DATA.time.hour_dow_all ? aggregateHours(DATA.time.hour_dow_all) : []));
  const peak = hours.length ? hours.slice().sort((a, b) => b.pm25 - a.pm25)[0] : null;
  const w26 = state.island === 'Semua' ? DATA.time.weekday.find((r) => r.year === 2026) : (DATA.time.weekday_island || []).find((r) => r.year === 2026 && r.island === state.island);
  const diff = w26 ? w26.weekend - w26.weekday : null;
  const episodeTotal = Object.values(DATA.time.episode_stats).reduce((a, r) => a + (r.episode || 0), 0);
  const hazeEpisode = (DATA.time.episode_monthly_island || []).filter((r) => /-(09|10|11)$/.test(r.month)).reduce((a, r) => a + (r.episode || 0), 0);
  let streak = 0; let streakStation = null;
  const streakId = state.station || (DATA.stationsById.get(defaultStationForIsland() || 'KTG-02') ? (defaultStationForIsland() || 'KTG-02') : null);
  if (streakId && DATA.time.episode_stats[streakId]) { streak = DATA.time.episode_stats[streakId].longest || 0; streakStation = streakId; }
  else Object.entries(DATA.time.episode_stats).forEach(([id, r]) => {
    if (state.island !== 'Semua') { const s = DATA.stationsById.get(id); if (!s || s.island !== state.island) return; }
    if ((r.longest || 0) > streak) { streak = r.longest; streakStation = id; }
  });
  const hazePct = episodeTotal ? hazeEpisode / episodeTotal * 100 : null;
  return [
    { id: 'peak', label: `Jam terburuk${st ? ' · ' + st.id : ''}`, value: peak ? `${String(peak.hour).padStart(2, '0')}:00` : '—', unit: '', baseline: peak ? `${fmt(peak.pm25, 1)} µg/m³` : '', window: '2024–2026', note: sub },
    { id: 'weekend', label: 'Selisih akhir pekan', value: diff == null ? '—' : (diff >= 0 ? '+' : '') + fmt(diff, 1), unit: 'µg/m³', baseline: w26 ? `libur ${fmt(w26.weekend, 1)} − kerja ${fmt(w26.weekday, 1)}` : '', window: '2026', note: 'mean akhir pekan − hari kerja, 1 Agu–14 Okt 2026' },
    { id: 'haze', label: 'Episode di musim asap', value: hazePct == null ? '—' : fmt(hazePct, 0), unit: '%', baseline: `${fmtInt(hazeEpisode)}/${fmtInt(episodeTotal)} hari`, window: '2024–2026', note: 'hari-stasiun >55 µg/m³ di Sep–Nov' },
    { id: 'streak', label: 'Rentetan episode terpanjang', value: streak ? fmtInt(streak) : '—', unit: 'hari', baseline: streakStation ? `${streakStation} · >55 µg/m³` : '', window: '2024–2026', note: 'hari berurutan >55 µg/m³' },
  ];
}
function aggregateHours(rows) {
  const map = new Map();
  rows.forEach((r) => {
    const cur = map.get(r.hour) || { sum: 0, n: 0 };
    cur.sum += r.pm25 * r.n; cur.n += r.n; map.set(r.hour, cur);
  });
  return Array.from(map.entries()).map(([hour, v]) => ({ hour, pm25: v.sum / v.n, n: v.n })).sort((a, b) => a.hour - b.hour);
}
function renderTime() {
  const d = DATA.meta.data_quality;
  const meta = `2024–2026 · ${d.stations} stasiun · data hingga ${DATA.meta.periods.data_end}`;
  const sub = state.station ? `${state.station} · 2024–2026` : (state.island === 'Semua' ? 'Nasional' : state.island);
  const kpis = timeKpis().map(kpiCard2).join('');
  return `${pageHead('Waktu', meta, `<span class="pill">2024–2026</span>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="grid-12">
      ${card('Harian', 'µg/m³', `<div class="chart" id="chart-daily"></div>`, { cls: 'span-12 h-460', right: '<div class="card-sub">µg/m³ · garis 15 / 55 / 100</div>' })}
    </div>
    <div class="grid-12">
      ${card('Kalender harian', `PM2.5 · ${sub}`, `<div class="chart" id="chart-heat"></div>`, { cls: 'span-7 h-340', right: `<div class="heat-legend" id="legend-heat"></div><div class="card-sub">${sub}</div>` })}
      ${card('Jam × hari', 'µg/m³', `<div class="chart" id="chart-hour-dow"></div>`, { cls: 'span-5 h-340', right: '<div class="card-sub">µg/m³ · jam × DOW</div>' })}
    </div>
    <div class="grid-12">
      ${card('Siklus 24 jam per kelas lokasi', '% rata-rata', `<div class="chart" id="chart-diurnal-class"></div>`, { cls: 'span-6 h-280', right: '<div class="card-sub">indeks % · 100 = rata-rata</div>' })}
      ${card('Bulanan per pulau', 'µg/m³', `<div class="chart" id="chart-month-island"></div>`, { cls: 'span-6 h-280', right: '<div class="card-sub">µg/m³ · garis 55</div>' })}
    </div>
    <div class="grid-12">
      ${card('Episode per bulan', 'hari-stasiun >55', `<div class="chart" id="chart-episode-month"></div>`, { cls: 'span-7 h-280', right: '<div class="card-sub">hari-stasiun >55</div>' })}
      ${card('Hari kerja vs akhir pekan', 'µg/m³', `<div class="chart" id="chart-weekday"></div>`, { cls: 'span-5 h-280', right: '<div class="card-sub">µg/m³ · per tahun</div>' })}
    </div>
    <div class="grid-12">
      ${card('Komposisi ISPU per tahun', '% hari-stasiun', `<div class="chart" id="chart-ispu-year"></div>` + ispuStackLegend(), { cls: 'span-12 h-280' })}
    </div>
  </div>`;
}

function afterTime() {
  makeHeatmap();
  makeHourDowChart();
  makeDiurnalClassChart();
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
function makeDiurnalClassChart() {
  const classes = Object.keys(DATA.time.diurnal_class || {});
  const hours = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const chart = makeChart('chart-diurnal-class', {
    aria: { enabled: true },
    grid: { left: 40, right: 12, top: 30, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 8, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: hours, axisLabel: { color: C.muted, fontSize: 8, interval: 2 }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 75, max: 140, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8, formatter: '{value}%' } },
    series: classes.map((cls) => ({ name: cls, type: 'line', data: hours.map((_, h) => DATA.time.diurnal_class[cls][String(h)]), smooth: false, symbol: 'none', lineStyle: { width: 1.6, color: DIURNAL_COLORS[cls] || C.navy }, itemStyle: { color: DIURNAL_COLORS[cls] || C.navy }, markLine: cls === classes[0] ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: 'dashed', color: C.muted, width: 1 }, data: [{ yAxis: 100 }] } : undefined })),
  });
  pickByPixel(chart, document.getElementById('chart-diurnal-class'), 'x', (hour, yVal) => {
    let best = null;
    classes.forEach((cls) => {
      const v = Number((DATA.time.diurnal_class[cls] || {})[String(hour)]);
      if (!Number.isFinite(v)) return;
      const d = Math.abs(v - yVal);
      if (!best || d < best.d) best = { cls, d };
    });
    if (best) openDetail(detailDiurnalClass(best.cls));
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
  const chart = makeChart('chart-daily', {
    aria: { enabled: true },
    grid: { left: 40, right: 16, top: 26, bottom: 28 },
    tooltip: { ...tooltipBase(), trigger: 'axis', formatter: (ps) => `<b>${ps[0].axisValue}</b><br>${fmt(ps[0].value[1], 1)} µg/m³` },
    xAxis: { type: 'time', axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 9 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 9 } },
    series: [{
      type: 'line',
      data: rows.map((r) => [r[0], r[1]]),
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.6, color: C.navy },
      areaStyle: { color: 'rgba(16,42,67,.06)' },
      markLine: markLinePP(
        ppItem('y', 55, 'PP 55', C.yellow),
        { yAxis: 15, lineStyle: { type: [4, 3], width: 1, color: C.teal, opacity: .5 }, label: { show: false } },
        { yAxis: 100, lineStyle: { type: [4, 3], width: 1, color: C.terra, opacity: .45 }, label: { show: false } },
      ),
    }],
  });
  pickByPixel(chart, document.getElementById('chart-daily'), 'x', (ts) => {
    const spec = detailDayNearest(ts);
    if (spec) openDetail(spec);
  });
  return chart;
}

function makeDiurnalChart() {
  const rows = Object.entries(DATA.time.diurnal).map(([h, v]) => [String(h).padStart(2, '0'), v]);
  const chart = makeChart('chart-time', {
    aria: { enabled: true },
    grid: { left: 40, right: 16, top: 26, bottom: 28 },
    tooltip: { ...tooltipBase(), trigger: 'axis', formatter: (ps) => `<b>${ps[0].axisValue}:00</b><br>${fmt(ps[0].value, 1)}%` },
    xAxis: { type: 'category', data: rows.map((r) => r[0]), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 8.5, interval: 1 } },
    yAxis: { type: 'value', min: 80, max: 140, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 9, formatter: '{value}%' } },
    series: [{
      type: 'line',
      data: rows.map((r) => r[1]),
      smooth: false,
      symbol: 'circle',
      symbolSize: 3,
      lineStyle: { width: 2, color: C.navy },
      itemStyle: { color: C.navy },
      areaStyle: { color: 'rgba(231,179,58,.16)' },
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { type: 'dashed', color: C.muted, width: 1 }, data: [{ yAxis: 100 }] },
      markPoint: {
        symbol: 'circle',
        symbolSize: 7,
        itemStyle: { color: C.yellow, borderColor: C.navy, borderWidth: 1.5 },
        label: { show: true, position: 'top', distance: 6, fontFamily: 'IBM Plex Mono', fontSize: 9, color: C.navy, formatter: (p) => `${fmt(p.value, 1)}%` },
        data: [
          { coord: ['07', DATA.time.diurnal['7']], value: DATA.time.diurnal['7'] },
          { coord: ['18', DATA.time.diurnal['18']], value: DATA.time.diurnal['18'] },
        ],
      },
    }],
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
  const meta = `${DATA.meta.periods.haze} · ${filteredStations().length} stasiun · ${DATA.meta.periods.data_end}`;
  return `${pageHead('Wilayah', meta, `<span class="pill">1 Agu–14 Okt 2026</span>`)}
  <div class="page-body">
    <div class="grid-12">
      <section class="card span-7 h-420">
        <div class="card-head"><div class="card-title">Peta stasiun</div><div class="card-head-right"><div class="card-sub">ISPU dominan</div></div></div>
        <div class="card-body"><div class="map" id="map-geo"></div><div class="map-legend" id="legend-geo"></div></div>
      </section>
      <section class="card span-5 h-420">
        <div class="card-head"><div class="card-title">Profil stasiun</div><div class="card-head-right">${st ? `<button class="ghost-btn" type="button" data-action="compare-station">Bandingkan</button>` : ''}<div class="card-sub">${st ? 'klik titik lain' : 'pilih stasiun'}</div></div></div>
        <div class="card-body" id="profile-body">${renderProfile(st)}</div>
      </section>
    </div>
    <div class="grid-12">
      ${card('Tren bulanan stasiun', 'µg/m³ · 2024–2026', `<div class="chart" id="chart-profile-trend"></div>`, { cls: 'span-12 h-280', right: '<div class="card-sub">µg/m³ · garis 55</div>' })}
    </div>
    <div class="grid-12">
      ${card('Kronis–akut', 'mean vs P95 harian · 1 Agu–14 Okt 2026', `<div class="chart" id="chart-chronic"></div>`, { cls: 'span-7 h-320', right: '<div class="card-sub">X mean · Y P95</div>' })}
      ${card('Ringkasan beban', 'µg/m³', `<div class="card-body" id="chronic-stats" style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px;align-content:start"></div>`, { cls: 'span-5 h-320', right: '<div class="card-sub">1 Agu–14 Okt 2026</div>' })}
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
        <input class="method-search" id="geo-table-search" type="search" placeholder="Cari stasiun/kota" value="${esc(state.tableSearch)}" aria-label="Cari stasiun">
        <label class="filter-group"><span class="filter-label">Urut</span><select class="select" id="geo-table-sort">${['mean','p95','usable','name'].map((k) => `<option value="${k}" ${state.tableSort === k ? 'selected' : ''}>${({mean:'Rata-rata',p95:'P95',usable:'Kelayakan',name:'Nama'})[k]}</option>`).join('')}</select></label>
        <button class="ghost-btn" type="button" data-action="download-overview">CSV</button>
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
  const mapped = rows.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, color: catColor(s.ispu_dominant), r: s.mean_2026 == null ? 4.5 : 3.5 + Math.min(3.5, s.mean_2026 / 100), selected: s.id === selectedId, popup: `<b>${esc(s.id)}</b><br>${esc(s.ispu_dominant || '—')} · ${s.ispu_share == null ? '—' : fmt(s.ispu_share, 1) + '% hari'}<br>${fmt(s.mean_2026, 1)} µg/m³ · ${esc(s.status)}` }));
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
    series: rows.map((s, si) => ({ type: 'scatter', data: [[s.mean_2026, s.p95_2026, s.ispu_dominant || '—', s.id, s.days_2026]], symbolSize: 8, itemStyle: { color: catColor(s.ispu_dominant), borderColor: C.paper, borderWidth: 1.2 }, label: { show: true, position: 'top', fontSize: 7.5, color: C.muted, formatter: (p) => (p.value[0] > 150 || p.value[1] > 400 || p.value[3] === 'SM2-01') ? p.value[3] : '', distance: 4 }, markLine: si === 0 ? markLinePP(ppItem('x', 55, '55', C.yellow), ppItem('y', 55, 'PP 55', C.yellow)) : undefined })),
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
      ['Mean terendah', kronis ? `${kronis.id} · ${fmt(kronis.mean_2026, 1)}` : '—', 'µg/m³'],
      ['Mean tertinggi', topRowsFull()[0] ? `${topRowsFull()[0].id} · ${fmt(topRowsFull()[0].mean_2026, 1)}` : '—', 'µg/m³'],
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
      <div class="row"><span>Validitas</span><b>${fmt(s.valid_pct, 1)}%</b></div>
      <div class="row"><span>Hari layak</span><b>${s.usable_days}/${s.total_days}</b></div>
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
    kicker: 'Perbandingan stasiun · 1 Agu–14 Okt 2026',
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

function renderProfile(st) {
  if (!st) {
    return `<div class="empty"><svg viewBox="0 0 24 24"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg><div>Pilih stasiun</div></div>`;
  }
  const rows = [
    ['Rata-rata', fmt(st.mean_2026, 1), 'µg/m³'],
    ['P95', fmt(st.p95_2026, 1), 'µg/m³'],
    ['Maks', fmt(st.max_2026, 1), 'µg/m³'],
    ['Hari', fmtInt(st.days_2026), 'hari'],
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
  return `<div class="profile">
    <div class="profile-head">
      <div><div class="profile-name">${esc(st.id)}</div><div class="profile-sub">${esc(st.city)} · ${esc(st.province)}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${catBadge(st.ispu_dominant, st.ispu_share)}${statusBadge(st.status)}${st.lower_bound ? '<span class="badge est">≥999 lower bound</span>' : ''}</div>
    </div>
    <div class="metric-grid">${rows.map(([k, v, u]) => `<div class="metric"><div class="metric-label">${k}</div><div class="metric-value">${v} <small>${u}</small></div></div>`).join('')}</div>
    <div class="detail-list">
      <div class="row"><span>Peringkat 2026</span><b>${rank}</b></div>
      <div class="row"><span>Vs nasional</span><b>${vs == null ? '—' : fmt(vs, 1) + '×'}</b></div>
      <div class="row"><span>Tipe situs</span><b>${esc(st.site_class)}</b></div>
      <div class="row"><span>Validitas</span><b>${fmt(st.valid_pct, 1)}%</b></div>
      <div class="row"><span>Hari layak</span><b>${st.usable_days}/${st.total_days}</b></div>
      ${st.issues ? `<div class="row"><span>Catatan QC</span><b>${esc(st.issues)}</b></div>` : ''}
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

function exportStation() {
  const st = state.station ? DATA.stationsById.get(state.station) : null;
  if (!st) return;
  downloadCSV(`napas_${st.id}.csv`, [['metric', 'value', 'unit'], ['mean_2026', st.mean_2026, 'µg/m³'], ['p95_2026', st.p95_2026, 'µg/m³'], ['max_2026', st.max_2026, 'µg/m³'], ['days_2026', st.days_2026, 'hari'], ['usable_pct', st.usable_pct, '%'], ['baseline', st.baseline, 'µg/m³'], ['traffic', st.traffic, '/jam'], ['distance', st.distance, 'm']]);
}

/* ------------------------------------------------------------------ sources */
function sourceRows() {
  const rows = state.sourceMode === 'all' ? DATA.sources.all : DATA.sources.only2026;
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
  const mode = state.sourceMode;
  const rows = sourceRows();
  const corr = {
    baseline: pearson(rows, 'baseline'),
    distance: pearson(rows, 'distance'),
    traffic: pearson(rows, 'traffic'),
  };
  const corrMeta = state.island === 'Semua' ? (mode === 'all' ? DATA.sources.corr.all : DATA.sources.corr.only2026) : null;
  const corrDisplay = {
    baseline: corrMeta ? { r: corrMeta.baseline, n: corrMeta.n } : corr.baseline,
    distance: corrMeta ? { r: corrMeta.distance, n: corrMeta.n } : corr.distance,
    traffic: corrMeta ? { r: corrMeta.traffic, n: corrMeta.n } : corr.traffic,
  };
  const pmCorr = DATA.sources.pollutant_matrix ? DATA.sources.pollutant_matrix.matrix[0][1] : null;
  const windNeg = (DATA.sources.meteo_corr || []).filter((r) => r.wind != null && r.wind < 0).length;
  const kpis = [
    { id: 'cb', label: 'r baseline', value: corrDisplay.baseline ? fmtR(corrDisplay.baseline.r) : '—', unit: '', baseline: corrDisplay.baseline ? `n=${corrDisplay.baseline.n}` : '', window: mode === 'all' ? '2024–2026' : '2026', note: 'Pearson baseline vs mean PM2.5; asosiasi, bukan kausal' },
    { id: 'cd', label: 'r jarak jalan', value: corrDisplay.distance ? fmtR(corrDisplay.distance.r) : '—', unit: '', baseline: corrDisplay.distance ? `n=${corrDisplay.distance.n}` : '', window: 'm', note: 'Pearson jarak ke jalan vs mean PM2.5; semakin jauh → cenderung lebih rendah' },
    { id: 'ct', label: 'r lalu lintas', value: corrDisplay.traffic ? fmtR(corrDisplay.traffic.r) : '—', unit: '', baseline: corrDisplay.traffic ? `n=${corrDisplay.traffic.n}` : '', window: '/jam', note: 'Pearson volume lalu lintas vs mean PM2.5' },
    { id: 'pm', label: 'r PM2.5–PM10', value: pmCorr == null ? '—' : fmtR(pmCorr), unit: '', baseline: DATA.sources.pollutant_matrix ? `n=${fmtInt(DATA.sources.pollutant_matrix.n)} hari-stasiun` : '', window: 'pooled', note: 'Korelasi pooled hari-stasiun PM2.5 vs PM10' },
  ].map(kpiCard2).join('');
  const pollutants = DATA.sources.pollutants;
  const windStations = filteredSourceStations();
  const windOptions = windStations.map((s) => `<option ${s === (state.windStation || 'PLB-01') ? 'selected' : ''}>${s}</option>`).join('');
  return `${pageHead('Sumber', `${mode === 'all' ? '2024–2026' : '2026'} · korelasi tingkat stasiun · asosiasi, bukan kausal`, `<span class="badge est" data-tip="Korelasi Pearson pada tingkat stasiun; bukan klaim kausal">Asosiasi, bukan kausal</span><div class="seg"><button type="button" data-source="all" class="${mode === 'all' ? 'active' : ''}">2024–2026</button><button type="button" data-source="only2026" class="${mode === 'only2026' ? 'active' : ''}">2026-only</button></div><button class="ghost-btn" type="button" data-action="download-source">Unduh CSV</button>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="grid-12">
      ${card('Baseline vs PM2.5', `X baseline µg/m³ · Y ${mode === 'all' ? '2024–2026' : '2026'} µg/m³`, `<div class="chart" id="scatter-baseline"></div>`, { cls: 'span-4 h-320', right: `<div class="card-sub">r ${corrDisplay.baseline ? fmtR(corrDisplay.baseline.r) : ''}</div>` })}
      ${card('Jarak jalan vs PM2.5', `X meter (log) · Y ${mode === 'all' ? '2024–2026' : '2026'} µg/m³`, `<div class="chart" id="scatter-distance"></div>`, { cls: 'span-4 h-320', right: `<div class="card-sub">r ${corrDisplay.distance ? fmtR(corrDisplay.distance.r) : ''}</div>` })}
      ${card('Lalu lintas vs PM2.5', `X kendaraan/jam · Y ${mode === 'all' ? '2024–2026' : '2026'} µg/m³`, `<div class="chart" id="scatter-traffic"></div>`, { cls: 'span-4 h-320', right: `<div class="card-sub">r ${corrDisplay.traffic ? fmtR(corrDisplay.traffic.r) : ''}</div>` })}
    </div>
    <div class="grid-12">
      ${card('Matriks korelasi polutan', 'Pearson · pooled hari-stasiun', `<div class="chart" id="chart-pollutant-matrix"></div>`, { cls: 'span-6 h-340', right: '<div class="card-sub">PM2.5 · PM10 · SO2 · NO2 · O3 · CO</div>' })}
      <section class="card span-6 h-340">
        <div class="card-head"><div class="card-title">Rata-rata polutan</div><div class="card-head-right"><div class="card-sub">1 Agu–14 Okt 2026</div></div></div>
        <div class="card-body"><div class="stat-grid">${pollutants.map((r) => `<div class="stat-block"><div class="k">${esc(r.label)}</div><div class="v">${fmt(r.value, 1)} <small>${esc(r.unit)}</small></div><div class="n">n = ${fmtInt(r.n)}</div></div>`).join('')}</div></div>
      </section>
    </div>
    <div class="grid-12">
      <section class="card span-6 h-340">
        <div class="card-head"><div class="card-title">Arah angin</div><div class="card-head-right"><label class="filter-group"><span class="filter-label">Stasiun</span><select class="select" id="wind-station">${windOptions}</select></label><div class="card-sub">16 sektor · 5 kelas</div></div></div>
        <div class="card-body"><div class="chart" id="chart-windrose"></div></div>
      </section>
      ${card('Korelasi meteorologi', 'r jam-jaman · per stasiun', `<div class="table-wrap" style="height:auto;max-height:340px"><table class="data" id="meteo-table"></table></div>`, { cls: 'span-6 h-auto', right: '<div class="card-sub">r = PM2.5 vs suhu/kelembapan/angin</div>' })}
    </div>
    <div class="grid-12">
      <section class="card span-12 h-auto">
        <div class="card-head"><div class="card-title">Meteorologi</div><div class="card-head-right"><div class="card-sub">rata-rata · 1 Agu–14 Okt 2026</div></div></div>
        <div class="card-body"><div class="stat-grid">${(DATA.sources.meteo || []).map((r) => `<div class="stat-block"><div class="k">${esc(r.label)}</div><div class="v">${fmt(r.value, 1)} <small>${esc(r.unit)}</small></div><div class="n">n = ${fmtInt(r.n)}</div></div>`).join('')}</div></div>
      </section>
    </div>
  </div>`;
}
function filteredSourceStations() {
  const rows = DATA.sources.all;
  return rows.filter((r) => state.island === 'Semua' || r.island === state.island).map((r) => r.station);
}

function afterSource() {
  const mode = state.sourceMode;
  const rows = sourceRows();
  const yName = mode === 'all' ? 'PM2.5 2024–2026 (µg/m³)' : 'PM2.5 2026 (µg/m³)';
  makeScatter('scatter-baseline', rows, 'baseline', false, 'Baseline (µg/m³)', yName);
  makeScatter('scatter-distance', rows, 'distance', true, 'Jarak ke jalan (m, log)', yName);
  makeScatter('scatter-traffic', rows, 'traffic', false, 'Lalu lintas (kendaraan/jam)', yName);
  makePollutantMatrix();
  makeWindrose();
  renderMeteoTable();
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
  const id = state.windStation || 'PLB-01';
  const w = DATA.sources.windrose[id];
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

function renderMeteoTable() {
  const el = $('#meteo-table');
  if (!el) return;
  const rows = (DATA.sources.meteo_corr || []).filter((r) => r.station !== 'JMB-02' && (state.island === 'Semua' || r.island === state.island)).slice().sort((a, b) => (Math.abs(b.wind || 0) - Math.abs(a.wind || 0)));
  el.innerHTML = `<thead><tr><th>Stasiun</th><th>Pulau</th><th class="num">r suhu</th><th class="num">r kelembapan</th><th class="num">r angin</th><th class="num">n jam</th></tr></thead><tbody>${rows.map((r) => `<tr data-meteo="${esc(r.station)}" tabindex="0"><td class="mono">${esc(r.station)}</td><td>${esc(r.island || '')}</td><td class="num">${r.temp == null ? '—' : fmtR(r.temp)}</td><td class="num">${r.hum == null ? '—' : fmtR(r.hum)}</td><td class="num">${r.wind == null ? '—' : fmtR(r.wind)}</td><td class="num">${fmtInt(r.n)}</td></tr>`).join('')}</tbody>`;
  bindRowActivate('#meteo-table tbody tr', 'data-meteo', detailMeteo);
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
        data: pts,
        symbolSize: (v) => 5 + Math.min(9, Math.sqrt(v[6] || v[2]) / 3.5),
        itemStyle: { color: (p) => ISLAND_COLORS[p.value[5]] || C.navy, borderColor: C.paper, borderWidth: 1 },
        emphasis: { itemStyle: { color: C.yellow, borderColor: C.navy } },
        label: { show: true, position: 'top', fontSize: 7.5, color: C.muted, distance: 4, formatter: (p) => (p.value[1] > 250 || p.value[0] > 400 || p.value[3] === 'KTG-02' || p.value[3] === 'KTG-01' || p.value[3] === 'SM2-01') ? p.value[3] : '' },
        markLine: markLinePP(ppItem('y', 55, 'PP 55', C.yellow)),
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
  const y = healthYears()[2];
  const scope = state.island === 'Semua' ? 'nasional' : state.island;
  const meta = `${DATA.health.window} · ${y.days} hari · ${scope} · baseline Jan–Jun tahun yang sama`;
  const stations = healthStations();
  const totalResp = stations.reduce((a, r) => a + (r.resp_actual || 0), 0);
  const totalUnder5 = stations.reduce((a, r) => a + (r.resp_under5_actual || 0), 0);
  const totalOver60 = stations.reduce((a, r) => a + (r.resp_over60_actual || 0), 0);
  const under5Share = totalResp ? totalUnder5 / totalResp * 100 : null;
  const over60Share = totalResp ? totalOver60 / totalResp * 100 : null;
  const lag0 = healthLag()['0'] ? healthLag()['0'].resp : null;
  const kpis = [
    { id: 'total', label: 'Total kunjungan respirasi', value: totalResp, unit: 'kasus', baseline: `${y.days} hari · 27 RS`, window: '1 Agu–14 Okt', note: `aktual ${scope} · 1 Agu–14 Okt 2026` },
    { id: 'under5', label: 'Balita', value: under5Share, unit: '%', baseline: `${fmtInt(totalUnder5)} kunjungan`, window: 'share respirasi', note: 'share kunjungan respirasi balita dari total respirasi' },
    { id: 'over60', label: 'Lansia', value: over60Share, unit: '%', baseline: `${fmtInt(totalOver60)} kunjungan`, window: 'share respirasi', note: 'share kunjungan respirasi lansia dari total respirasi' },
    { id: 'lag0', label: 'Asosiasi lag 0', value: lag0, unit: '', baseline: 'r anomali · hari sama', window: '2024–2026', note: 'Korelasi anomali PM2.5 dan kunjungan respirasi pada hari yang sama' },
  ].map((k) => ({ ...k, value: k.id === 'lag0' ? fmtR(k.value) : k.id === 'total' ? fmtInt(k.value) : fmt(k.value, 1) })).map(kpiCard2).join('');
  return `${pageHead('Kesehatan', meta, `<span class="badge est" data-tip="Estimasi asosiatif: aktual − expected. Expected = rata-rata harian Jan–Jun tahun yang sama × jumlah hari jendela.">Estimasi asosiatif</span><button class="ghost-btn" type="button" data-action="download-health">Unduh CSV</button>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="grid-12">
      ${card('Observed vs expected', `kasus · ${y.days} hari`, `<div class="chart" id="chart-health"></div>`, { cls: 'span-7 h-340', right: '<div class="card-sub">aktual / expected</div>' })}
      ${card('Kelebihan per tahun', 'kasus', `<div class="chart" id="chart-health-year"></div>`, { cls: 'span-5 h-340', right: '<div class="card-sub">2024–2026</div>' })}
    </div>
    <div class="grid-12">
      <section class="card span-12 h-320">
        <div class="card-head"><div class="card-title">PM2.5 dan kunjungan</div><div class="card-head-right"><div class="card-sub">dua panel · bukan dual axis</div></div></div>
        <div class="card-body" style="display:flex;flex-direction:column"><div class="legend-note" style="padding:5px 12px 0">atas: PM2.5 µg/m³ · bawah: kunjungan harian</div><div style="height:128px;position:relative"><div class="chart" id="chart-pm-month"></div></div><div style="height:128px;position:relative"><div class="chart" id="chart-resp-month"></div></div></div>
      </section>
    </div>
    <div class="grid-12">
      ${card('Lag 0–14', 'r anomali', `<div class="chart" id="chart-lag"></div>`, { cls: 'span-7 h-320', right: '<div class="card-sub">r · lag 0–14</div>' })}
      ${card('Kelompok rentan', 'kunjungan harian · bulanan', `<div class="chart" id="chart-vulnerable"></div>`, { cls: 'span-5 h-320', right: '<div class="card-sub">bulanan</div>' })}
    </div>
    <div class="grid-12">
      ${card('Top 10 stasiun', 'r lag 0 tertinggi', `<div class="table-wrap" style="height:auto;max-height:320px"><table class="data" id="health-top-table"></table></div>`, { cls: 'span-7 h-auto', right: '<div class="card-sub">lag 0</div>' })}
      ${card('Beban vs respons', 'X mean PM2.5 · Y r lag0', `<div class="chart" id="chart-health-scatter"></div>`, { cls: 'span-5 h-320', right: '<div class="card-sub">µg/m³ · r</div>' })}
    </div>
    <div class="grid-12">
      <section class="card span-12 h-auto">
        <div class="card-head"><div class="card-title">Estimasi kelebihan 7 outcome</div><div class="card-head-right"><div class="card-sub">${y.days} hari · 1 Agu–14 Okt 2026</div></div></div>
        <div class="card-body"><div class="stat-grid">${DATA.health.outcomes.map((o) => `<div class="stat-block"><div class="k">${esc(o.label)}</div><div class="v">+${fmtInt(y.excess[o.key])} <small>kasus</small></div><div class="n">aktual ${fmtInt(y.actual[o.key])} · expected ${fmtInt(y.expected[o.key])}</div></div>`).join('')}</div></div>
      </section>
    </div>
  </div>`;
}

function afterHealth() {
  makeObservedChart();
  makeHealthYearChart();
  makeHealthMonthlyCharts();
  makeLagMultiChart();
  makeVulnerableChart();
  renderHealthTopTable();
  makeHealthScatter();
}

function makeObservedChart(id = 'chart-health', opts = {}) {
  const el = document.getElementById(id);
  if (!el) return null;
  const y = healthYears()[2];
  const outcomes = DATA.health.outcomes;
  const actual = outcomes.map((o) => y.actual[o.key]);
  const expected = outcomes.map((o) => y.expected[o.key]);
  const excess = outcomes.map((o) => y.excess[o.key]);
  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: opts.grid || { left: 104, right: 64, top: 26, bottom: 20 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 9, color: C.muted } },
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (ps) => {
        const i = ps[0].dataIndex;
        return `<b>${outcomes[i].label}</b><br>aktual ${fmtInt(actual[i])}<br>expected ${fmtInt(expected[i])}<br>+${fmtInt(excess[i])}`;
      },
    },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8.5, formatter: (v) => fmtInt(v) } },
    yAxis: { type: 'category', inverse: true, data: outcomes.map((o) => o.label), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: opts.yFont || 9.5, interval: 0 } },
    series: [
      { name: 'Aktual', type: 'bar', data: actual, barWidth: 9, itemStyle: { color: C.navy, borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 8.5, color: C.navy, formatter: (p) => `+${fmtInt(excess[p.dataIndex])}` } },
      { name: 'Expected', type: 'bar', data: expected, barWidth: 9, itemStyle: { color: C.grey2, borderRadius: [0, 3, 3, 0] } },
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
    grid: { left: 42, right: 12, top: 28, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 6, textStyle: { fontSize: 9, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: years.map((r) => String(r.year)), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 9 } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8.5, formatter: (v) => fmtInt(v) } },
    series: [
      { name: 'Respirasi', type: 'bar', data: years.map((r) => r.excess.resp), barWidth: 22, itemStyle: { color: C.navy, borderRadius: [3, 3, 0, 0] } },
      { name: 'Kematian', type: 'bar', data: years.map((r) => r.excess.death), barWidth: 22, itemStyle: { color: C.terra, borderRadius: [3, 3, 0, 0] } },
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
  const chart = makeChart('chart-lag', {
    aria: { enabled: true },
    grid: { left: 42, right: 12, top: 30, bottom: 26 },
    legend: { top: 0, right: 0, itemWidth: 10, itemHeight: 7, textStyle: { fontSize: 8, color: C.muted } },
    tooltip: { ...tooltipBase(), trigger: 'axis' },
    xAxis: { type: 'category', data: keys, axisLabel: { color: C.muted, fontSize: 8 }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0.15, max: 0.4, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8, formatter: (v) => fmt(v, 2) } },
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
  const rows = healthStations().slice().sort((a, b) => (b.lag0_resp || 0) - (a.lag0_resp || 0)).slice(0, 10);
  el.innerHTML = `<thead><tr><th>Stasiun</th><th>Pulau</th><th class="num">Actual</th><th class="num">Excess</th><th class="num">r lag 0</th><th class="num">Hari episode</th><th>Status</th></tr></thead><tbody>${rows.map((r) => `<tr data-health-station="${esc(r.station)}" tabindex="0"><td class="mono">${esc(r.station)}</td><td>${esc(r.island)}</td><td class="num">${fmtInt(r.resp_actual)}</td><td class="num">${fmtInt(r.resp)}</td><td class="num">${r.lag0_resp == null ? '—' : fmtR(r.lag0_resp)}</td><td class="num">${fmtInt(r.episode_days)}</td><td><span class="st ${statusSlug(r.status)}">${esc(r.status)}</span></td></tr>`).join('')}</tbody>`;
  bindRowActivate('#health-top-table tbody tr', 'data-health-station', detailHealthStation);
}
function makeHealthScatter() {
  const st = DATA.stationsById;
  const rows = healthStations().map((r) => ({
    station: r.station, island: r.island, pm: st.get(r.station) ? st.get(r.station).mean_2026 : null, lag0: r.lag0_resp, episode: r.episode_days, actual: r.resp_actual, excess: r.resp,
  })).filter((r) => r.pm != null && r.lag0 != null);
  const pts = rows.map((r) => [r.pm, r.lag0, r.episode, r.station, r.island, r.actual, r.excess]);
  const chart = makeChart('chart-health-scatter', {
    aria: { enabled: true },
    grid: { left: 46, right: 16, top: 30, bottom: 34 },
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(p.value[3])}</b><br>PM2.5 ${fmt(p.value[0], 1)} µg/m³<br>r lag 0 ${fmtR(p.value[1])}<br>episode ${fmtInt(p.value[2])} hari · ${esc(p.value[4])}` },
    xAxis: { type: 'value', name: 'mean PM2.5 (µg/m³)', nameLocation: 'middle', nameGap: 20, nameTextStyle: { fontSize: 9, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8 } },
    yAxis: { type: 'value', name: 'r lag 0', nameGap: 16, nameTextStyle: { fontSize: 9, color: C.muted }, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 8, formatter: (v) => fmt(v, 2) } },
    series: [{
      type: 'scatter', data: pts, symbolSize: (v) => 5 + Math.min(9, Math.sqrt(v[2] || 1) / 3.5),
      itemStyle: { color: (p) => ISLAND_COLORS[p.value[4]] || C.navy, borderColor: C.paper, borderWidth: 1 },
      label: { show: true, position: 'top', fontSize: 7.5, color: C.muted, distance: 4, formatter: (p) => (p.value[1] > 0.45 || p.value[0] > 250 ? p.value[3] : '') },
      labelLayout: { hideOverlap: true },
      markLine: markLinePP(ppItem('x', 55, 'PP 55', C.yellow), { yAxis: 0.35, lineStyle: { type: [4, 3], width: 1, color: C.muted, opacity: .5 }, label: { show: false } }),
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
    const rows = healthStations().slice(0, 10).map((r) => ({ id: r.station, value: r.resp, status: r.status })).reverse();
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
        { name: 'Respirasi', type: 'bar', data: years.map((r) => r.excess.resp), barWidth: 26, itemStyle: { color: C.navy, borderRadius: [3, 3, 0, 0] } },
        { name: 'Kematian', type: 'bar', data: years.map((r) => r.excess.death), barWidth: 26, itemStyle: { color: C.terra, borderRadius: [3, 3, 0, 0] } },
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
    { id: 'valid', label: 'Baris VALID', value: fmt(validPct, 1), unit: '%', baseline: `${fmtInt(d.valid_rows)} baris`, window: 'QC', note: 'Baris lolos QC utama' },
    { id: 'usable', label: 'Hari-stasiun layak', value: fmt(usablePct, 1), unit: '%', baseline: `${fmtInt(d.usable_station_days)}/${fmtInt(d.daily_station_days)}`, window: '≥18 jam', note: 'Hari dengan minimal 18 jam VALID' },
    { id: 'fragile', label: 'Stasiun paling rapuh', value: worst ? worst.station : '—', unit: '', baseline: worst ? `${fmt(worst.usable_pct, 1)}% layak` : '', window: 'status', note: worst ? `${worst.station} · ${worst.status} · ${fmt(worst.usable_pct, 1)}% hari layak` : '' },
  ].map(kpiCard2).join('');
  const qc = DATA.network.qc_totals || {};
  const qcTotal = Object.values(qc).reduce((a, v) => a + v, 0) || 1;
  const qcLegend = Object.entries(qc).map(([k, v]) => `<span class="item"><span class="sw" style="background:${({ VALID: C.teal, SUSPECT: '#E3A008', MISSING: '#A8B0C2', NONAKTIF: '#7B6BB0', ERROR: C.red })[k] || C.grey}"></span>${k} ${fmt(v / qcTotal * 100, 1)}%</span>`).join('');
  const exclusions = DATA.network.exclusions || {};
  return `${pageHead('Jaringan', meta, `<span class="pill warning" data-tip="${esc(DATA.network.blind_spots.join(' · '))}">${DATA.network.blind_spots.length} wilayah tanpa stasiun</span><button class="ghost-btn" type="button" data-action="download-network">Unduh CSV</button>`)}
  <div class="page-body">
    <div class="kpi-row">${kpis}</div>
    <div class="network-strip">${strip}<span class="status-chip total">Total <b>${rows.length}</b></span></div>
    <div class="grid-12">
      <section class="card span-6 h-320">
        <div class="card-head"><div class="card-title">Peta status</div><div class="card-head-right"><div class="card-sub">status stasiun</div></div></div>
        <div class="card-body"><div class="map" id="map-network"></div><div class="map-legend" id="legend-network"></div></div>
      </section>
      ${card('Komposisi QC', 'proporsi baris', `<div class="chart" id="chart-qc"></div>` + `<div class="stack-legend">${qcLegend}</div>`, { cls: 'span-6 h-320', right: '<div class="card-sub">667.981 baris</div>' })}
    </div>
    <div class="grid-12">
      <section class="card span-6 h-240">
        <div class="card-head"><div class="card-title">Eksklusi & pengecualian</div><div class="card-head-right"><div class="card-sub">diagnostik</div></div></div>
        <div class="card-body"><div class="stat-grid">${Object.entries(exclusions).map(([k, v]) => `<div class="stat-block"><div class="k">${esc(k)}</div><div class="v" style="font-size:9px;white-space:normal">${esc(v)}</div></div>`).join('')}</div></div>
      </section>
      <section class="card span-6 h-240">
        <div class="card-head"><div class="card-title">Blind spot</div><div class="card-head-right"><div class="card-sub">tanpa stasiun</div></div></div>
        <div class="card-body" style="padding:12px;display:flex;flex-direction:column;gap:8px">${DATA.network.blind_spots.map((b) => `<span class="pill warning">${esc(b)}</span>`).join('')}</div>
      </section>
    </div>
    <div class="grid-12">
      ${card('Matriks kelengkapan stasiun × bulan', '% hari layak', `<div class="chart" id="chart-completeness-matrix"></div>`, { cls: 'span-12 h-420', right: '<div class="card-sub">hari layak / hari kalender</div>' })}
    </div>
    <div class="grid-12">
      ${card('Prioritas pemantauan', 'X gap data · Y mean 2026', `<div class="chart" id="chart-priority"></div>`, { cls: 'span-7 h-320', right: '<div class="card-sub">mean vs gap</div>' })}
      ${card('Titik perhatian', 'gap >20% atau status buruk', `<div class="table-wrap" style="height:auto;max-height:320px"><table class="data" id="network-attention"></table></div>`, { cls: 'span-5 h-auto', right: '<div class="card-sub">perhatian</div>' })}
    </div>
    <section class="card span-12 h-auto">
      <div class="card-head"><div class="card-title">Status 27 stasiun</div><div class="card-head-right"><div class="card-sub">kelengkapan terendah dulu</div></div></div>
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
function makeQcChart() {
  const qc = DATA.network.qc_totals || {};
  const rows = Object.entries(qc).map(([name, value]) => ({ name, value }));
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  const chart = makeChart('chart-qc', {
    aria: { enabled: true },
    grid: { left: 58, right: 24, top: 8, bottom: 24 },
    tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(p.name)}</b><br>${fmtInt(p.value)} baris · ${fmt(p.value / total * 100, 1)}%` },
    xAxis: { type: 'value', max: 100, axisLabel: { color: C.muted, fontSize: 8.5, formatter: '{value}%' }, splitLine: { lineStyle: { color: C.grid } } },
    yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: 9 } },
    series: [{ type: 'bar', data: rows.map((r) => ({ value: r.value / total * 100, itemStyle: { color: ({ VALID: C.teal, SUSPECT: '#E3A008', MISSING: '#A8B0C2', NONAKTIF: '#7B6BB0', ERROR: C.red })[r.name] || C.grey, borderRadius: [0, 4, 4, 0] } })), barWidth: 14, label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 8.5, color: C.navy, formatter: (p) => fmt(p.value, 1) + '%' } }],
  });
  chart.on('click', (p) => {
    const r = rows[p.dataIndex];
    if (!r) return;
    const spec = detailQc(r.name);
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
    attention.innerHTML = `<thead><tr><th>Stasiun</th><th class="num">Gap</th><th class="num">Mean 2026</th><th>Status</th></tr></thead><tbody>${att.map((r) => `<tr data-net-station="${esc(r.station)}" tabindex="0"><td class="mono">${esc(r.station)}</td><td class="num">${fmt(r.gap, 1)}%</td><td class="num">${fmt(r.mean_2026, 1)}</td><td><span class="st ${statusSlug(r.status)}">${esc(r.status)}</span></td></tr>`).join('')}</tbody>`;
  }
  const table = $('#network-table');
  if (table) {
    const sorted = rows.slice().sort((a, b) => a.usable_pct - b.usable_pct);
    table.innerHTML = `<thead><tr><th>Stasiun</th><th>Kota/Pulau</th><th class="num">Valid</th><th class="num">Layak</th><th class="num">Gap</th><th class="num">Mean 2026</th><th class="num">Hari</th><th>Status</th></tr></thead><tbody>${sorted.map((r) => { const st = DATA.stationsById.get(r.station); const valid = DATA.network.valid_pct_by_station[r.station]; return `<tr data-net-station="${esc(r.station)}" tabindex="0"><td class="mono">${esc(r.station)}</td><td>${esc(st ? st.city : '')} · ${esc(r.island)}</td><td class="num">${valid == null ? '—' : fmt(valid, 1)}%</td><td class="num">${fmt(r.usable_pct, 1)}%</td><td class="num">${fmt(r.gap, 1)}%</td><td class="num">${fmt(r.mean_2026, 1)}</td><td class="num">${fmtInt(r.days_2026)}</td><td><span class="st ${statusSlug(r.status)}">${esc(r.status)}</span></td></tr>`; }).join('')}</tbody>`;
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
  return `${pageHead('Metodologi', meta, `<input class="method-search" id="method-search" type="search" placeholder="Cari definisi" aria-label="Cari definisi"><button class="ghost-btn" type="button" data-action="download-metrics">metrics.json</button><button class="ghost-btn" type="button" data-action="download-stations">stations.json</button><button class="ghost-btn" type="button" data-action="download-daily">CSV harian</button>`)}
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
            <tr><td>Baris VALID</td><td class="num">${fmtInt(d.valid_rows)}</td></tr>
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
    backgroundColor: 'rgba(19,26,56,.92)',
    borderWidth: 0,
    padding: [9, 11],
    textStyle: { color: '#FFFFFF', fontFamily: 'Plus Jakarta Sans', fontSize: 10.5 },
    extraCssText: 'border-radius:12px;box-shadow:0 18px 40px -18px rgba(19,26,56,.75);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)',
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
function ppItem(axis, value, text, color) {
  return {
    [axis === 'y' ? 'yAxis' : 'xAxis']: value,
    lineStyle: { color, type: [4, 3], width: 1, opacity: 0.9 },
    label: {
      show: true,
      formatter: text,
      position: 'insideEndTop',
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
      ? { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 9 }, axisLine: { show: false }, axisTick: { show: false } }
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
      markLine: opts.pp55 ? markLinePP(ppItem(horizontal ? 'x' : 'y', 55, 'PP 55', C.yellow)) : undefined,
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

function cycleSeries() {
  const nat = DATA.time.diurnal || {};
  const byClass = DATA.time.diurnal_class || {};
  const hours = Array.from({ length: 24 }, (_, i) => String(i));
  const pick = (src) => hours.map((h) => (src && src[h] != null ? Number(src[h]) : null));
  return { hours, nat, natVals: pick(nat), road: pick(byClass['Traffic/Roadside']), peat: pick(byClass['Peatland/Forest']) };
}

function makeCycleChart(id) {
  const { hours, natVals, road, peat } = cycleSeries();
  if (!natVals.some((v) => v != null)) return null;
  const all = [...natVals, ...road, ...peat].filter((v) => v != null);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const yMin = Math.max(50, Math.floor((lo - 6) / 10) * 10);
  const yMax = Math.max(140, Math.ceil((hi + 6) / 10) * 10);
  const labels = hours.map((h) => String(h).padStart(2, '0'));
  const peak = (h) => {
    const v = natVals[Number(h)];
    if (v == null) return null;
    const pagi = Number(h) < 12;
    return {
      coord: [labels[Number(h)], v],
      value: v,
      symbol: 'circle',
      symbolSize: 6,
      itemStyle: { color: pagi ? C.terra : C.navy, borderColor: '#fff', borderWidth: 1.4 },
      label: {
        show: true,
        position: 'top',
        offset: pagi ? [10, 0] : [-24, 0],
        distance: 7,
        formatter: `${pagi ? 'Puncak pagi' : 'Puncak sore'}\n${fmt(v, 1)}%`,
        lineHeight: 11,
        align: 'center',
        fontFamily: 'IBM Plex Mono',
        fontSize: 8,
        fontWeight: 600,
        color: C.navy,
        backgroundColor: 'rgba(255,255,255,.82)',
        padding: [2, 3],
        borderRadius: 3,
      },
    };
  };
  const line = (name, data, color, dashed, z) => ({
    name,
    type: 'line',
    data,
    smooth: false,
    connectNulls: true,
    showSymbol: !dashed,
    symbol: 'circle',
    symbolSize: 3.4,
    lineStyle: { color, width: dashed ? 1.6 : 2.4, type: dashed ? [5, 4] : 'solid' },
    itemStyle: { color, borderColor: '#fff', borderWidth: 1 },
    z,
  });
  const chart = makeChart(id, {
    aria: { enabled: true },
    grid: { left: 34, right: 12, top: 28, bottom: 22 },
    legend: { top: 0, left: 0, itemWidth: 12, itemHeight: 7, itemGap: 10, icon: 'roundRect', textStyle: { fontSize: 9, color: C.muted } },
    tooltip: {
      ...tooltipBase(),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(24,32,72,.18)' } },
      formatter: (ps) => {
        const i = ps[0] ? ps[0].dataIndex : 0;
        return `<b>${labels[i]}:00</b>` + ps.map((p) => `<br>${esc(p.seriesName)} <b>${fmt(p.value, 1)}%</b>`).join('');
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: labels,
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: 8.5, interval: 3 },
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      splitNumber: 3,
      splitLine: { lineStyle: { color: C.grid } },
      axisLabel: { color: C.muted, fontSize: 8.5, formatter: '{value}%' },
    },
    series: [
      {
        ...line('Nasional', natVals, C.navy, false, 4),
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(217,102,63,.10)' },
          data: [[{ xAxis: '06' }, { xAxis: '08' }], [{ xAxis: '17' }, { xAxis: '19' }]],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          data: [{ yAxis: 100, lineStyle: { color: 'rgba(24,32,72,.32)', type: [4, 3], width: 1 }, label: { show: false } }],
        },
        markPoint: { silent: true, data: [peak(7), peak(18)].filter(Boolean) },
      },
      line('Koridor jalan', road, C.terra, true, 2),
      line('Lahan gambut', peat, C.teal, true, 2),
    ],
  });
  if (chart) {
    pickByPixel(chart, document.getElementById(id), 'x', (i) => {
      const spec = detailHour(hours[i]);
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
        return `<b>${esc(r.id)}</b><br>Baseline <b>${fmt(r.baseline, 1)}</b> µg/m³<br>Mean 2026 <b>${fmt(r.mean, 1)}</b> µg/m³${ratio ? `<br>${fmt(ratio, 2)}× baseline` : ''}<br>${r.n} stasiun`;
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
        name: 'Mean 2026',
        type: 'bar',
        data: rows.map((r) => r.mean),
        barWidth: 8,
        itemStyle: { color: C.terra, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 8.5, color: C.navy, formatter: (p) => fmt(p.value, 1) },
        markLine: markLinePP(ppItem('x', 55, 'PP 55', C.yellow)),
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
  const { natVals, road, peat } = cycleSeries();
  const i = Number(h);
  const nat = natVals[i];
  if (nat == null) return null;
  const prev = natVals[(i + 23) % 24];
  const delta = prev == null ? null : nat - prev;
  const rows = [
    { label: 'Nasional', value: nat, color: C.navy },
    { label: 'Koridor jalan', value: road[i], color: C.terra },
    { label: 'Lahan gambut', value: peat[i], color: C.teal },
  ].filter((r) => r.value != null);
  const label = `${String(i).padStart(2, '0')}:00`;
  const body = `
    ${detailMetrics([
      ['Indeks nasional', `${fmt(nat, 1)}%`, ''],
      ['Vs jam sebelumnya', delta == null ? '—' : `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta), 1)}`, 'poin'],
      ['Jam', label, ''],
    ])}
    <div class="detail-block"><div class="detail-label">Indeks per kelas · % rata-rata harian</div>${detailBars(rows.map((r) => ({ ...r, display: `${fmt(r.value, 1)}%` })))}</div>
    <div class="detail-note">100% = rata-rata harian masing-masing seri</div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="waktu">Buka di Waktu</button>`;
  return {
    key: `hour:${i}`,
    kicker: 'Siklus 24 jam · indeks %',
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
      ['Mean 2026', fmt(mean, 1), 'µg/m³'],
    ])}
    <div class="detail-list">
      <div class="row"><span>Rasio mean / baseline</span><b>${ratio ? `${fmt(ratio, 2)}×` : '—'}</b></div>
      <div class="row"><span>P95 2026 rata-rata</span><b>${fmt(p95, 1)} µg/m³</b></div>
    </div>
    <div class="detail-block"><div class="detail-label">Stasiun · mean 2026</div>${detailBars(sorted.map((r) => ({ label: r.id, value: r.mean_2026 || 0, color: CAT_COLORS[categoryFromPm(r.mean_2026)] || C.navy })))}</div>
    <button class="primary-btn detail-cta" type="button" data-detail-go="wilayah">Buka Wilayah</button>`;
  return {
    key: `class:${cls}`,
    kicker: 'Kelas lokasi · 1 Agu–14 Okt 2026',
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

function makeMap(id, rows, opts = {}) {
  const el = document.getElementById(id);
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
  });
  const legend = document.getElementById(id.replace('map', 'legend'));
  if (legend && opts.legend) legend.innerHTML = opts.legend;
  return map;
}

function makeMapTip(el) {
  const node = document.createElement('div');
  node.className = 'map-tip';
  node.hidden = true;
  el.appendChild(node);
  let timer = 0;
  let point = null;
  let html = '';
  const position = () => {
    if (node.hidden || !point) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!W || !H) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    let x = point.x + 12;
    let y = point.y - h - 14;
    if (y < 6) y = point.y + 18;
    x = Math.max(6, Math.min(W - w - 6, x));
    y = Math.max(6, Math.min(H - h - 6, y));
    node.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  };
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
    hide() {
      clearTimeout(timer);
      node.hidden = true;
      html = '';
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

/* ------------------------------------------------------------------ story */
const SCENES = [
  { title: 'Perbandingan pulau', kicker: '01 / 06', source: 'metrics.json · 1 Agu–14 Okt 2026' },
  { title: 'Perbandingan tahun', kicker: '02 / 06', source: 'metrics.json · 1 Sep–14 Okt' },
  { title: 'Pola 24 jam', kicker: '03 / 06', source: 'metrics.json · indeks diurnal' },
  { title: 'Estimasi kesehatan', kicker: '04 / 06', source: 'metrics.json · 1 Agu–14 Okt 2026' },
  { title: 'Kualitas jaringan', kicker: '05 / 06', source: 'metrics.json · seluruh periode' },
  { title: 'Jelajahi data', kicker: '06 / 06', source: 'metrics.json · 7 halaman' },
];

function openStory(scene = 1, push = true) {
  state.story = true;
  state.scene = Math.max(1, Math.min(6, scene));
  closeFilters();
  closeMore();
  $('#story').hidden = false;
  $('#mode-switch [data-mode=story]').classList.add('active');
  $('#mode-switch [data-mode=explore]').classList.remove('active');
  if (push) updateUrl();
  requestAnimationFrame(() => {
    if (!window.echarts) return;
    if (!storyChart) storyChart = echarts.init($('#story-chart'));
    renderStory();
  });
}

function closeStory() {
  state.story = false;
  $('#story').hidden = true;
  $('#mode-switch [data-mode=story]').classList.remove('active');
  $('#mode-switch [data-mode=explore]').classList.add('active');
  updateUrl();
  if (state.page) render();
}

function setScene(n) {
  state.scene = Math.max(1, Math.min(6, n));
  updateUrl();
  renderStory();
}

function renderStory() {
  const s = SCENES[state.scene - 1];
  $('#story-kicker').textContent = s.kicker;
  $('#story-title').textContent = s.title;
  $('#story-source').textContent = s.source;
  $$('#story-dots .story-dot').forEach((b) => b.classList.toggle('active', Number(b.dataset.scene) === state.scene));
  $('#story-prev').disabled = state.scene === 1;
  $('#story-next').textContent = state.scene === 6 ? 'Selesai' : 'Lanjut →';
  const kpis = storyKpis(state.scene);
  $('#story-kpis').innerHTML = kpis.map(([v, u, l]) => `<div class="story-kpi"><span class="v">${v}</span><span class="u">${u}</span><span class="l">${l}</span></div>`).join('');
  const chartEl = $('#story-chart');
  const cards = $('#story-cards');
  if (state.scene === 6) {
    chartEl.style.display = 'none';
    cards.hidden = false;
    const pages = [
      ['ringkasan', 'Ringkasan', 'Hotspot, tren, dan ranking stasiun', ['Peta', 'Tren', 'Ranking'], `${fmt(DATA.overview.kpis[0].value, 1)} µg/m³`, 'Sep–Okt 2026'],
      ['waktu', 'Waktu', 'Kalender harian sampai pola 24 jam', ['Kalender', 'Episode', '24 jam'], `${fmt(DATA.time.diurnal['7'], 1)}%`, 'puncak 07.00'],
      ['wilayah', 'Wilayah', 'Peta skematis dan profil per stasiun', ['PM2.5', 'ISPU', 'Profil'], `${DATA.meta.data_quality.stations}`, 'stasiun · 5 pulau'],
      ['sumber', 'Sumber', 'Korelasi tingkat stasiun dan polutan', ['Korelasi', 'Polutan', 'Meteo'], `r ${fmt(DATA.sources.corr.all.baseline, 2).replace('.', ',')}`, 'baseline 2024–2026'],
      ['kesehatan', 'Kesehatan', 'Observed vs expected dan lag paparan', ['Lag', 'Beban', 'Estimasi'], fmtInt(DATA.health.years[2].excess.resp), 'kasus respirasi'],
      ['jaringan', 'Jaringan', 'Status, cakupan, dan gap data stasiun', ['Status', 'Cakupan', 'Gap'], `${DATA.network.status_counts.Baik}/${DATA.meta.data_quality.stations}`, 'stasiun berstatus Baik'],
      ['metodologi', 'Metodologi', 'Definisi KPI, QC, dan batas klaim', ['QC', 'Definisi', 'Sitasi'], `hash ${DATA.meta.metrics_sha256 ? DATA.meta.metrics_sha256.slice(0, 8) : ''}…`, 'jejak data'],
    ];
    cards.innerHTML = pages.map(([page, t, d, tags, v, l], i) => `<button class="story-card" type="button" data-go="${page}"><span class="n">0${i + 1}</span><span class="t">${t}</span><span class="d">${d}</span><span class="tags">${tags.map((x) => `<i>${x}</i>`).join('')}</span><span class="m"><b>${v}</b>${l}</span><span class="go">Buka halaman →</span></button>`).join('');
    $$('.story-card', cards).forEach((b) => b.addEventListener('click', () => { closeStory(); go(b.dataset.go); }));
    return;
  }
  chartEl.style.display = '';
  cards.hidden = true;
  const option = storyOption(state.scene);
  if (option) {
    storyChart.setOption(option, true);
    storyChart.resize();
  }
}

function storyKpis(scene) {
  const isl = DATA.overview.island26;
  const kal = isl.find((r) => r.island === 'Kalimantan');
  const jaw = isl.find((r) => r.island === 'Jawa');
  const comp = DATA.overview.comp_year;
  const by = Object.fromEntries(comp.map((r) => [r.year, r.pm25]));
  const y = DATA.health.years[2];
  const counts = DATA.network.status_counts;
  if (scene === 1) return [[fmt(kal.mean, 1), 'µg/m³', 'Kalimantan'], [fmt(kal.mean / jaw.mean, 1), '×', 'Jawa']];
  if (scene === 2) return [[fmt(by[2026], 1), 'µg/m³', '2026'], [fmt(by[2026] / by[2024], 1), '×', '2024'], [fmt(by[2026] / by[2025], 1), '×', '2025']];
  if (scene === 3) return [[fmt(DATA.time.diurnal['7'], 1), '%', '07.00'], [fmt(DATA.time.diurnal['18'], 1), '%', '18.00'], [fmt(DATA.time.diurnal['12'], 1), '%', '12.00']];
  if (scene === 4) return [[fmtInt(y.excess.resp), 'kasus', 'Respirasi'], [fmtInt(y.excess.resp_admissions_under5), 'kasus', 'Balita'], [fmtInt(y.excess.resp_admissions_over60), 'kasus', 'Lansia'], [fmtInt(y.excess.death), 'kasus', 'Kematian']];
  if (scene === 5) return [[`${counts.Baik}/${DATA.meta.data_quality.stations}`, '', 'Baik'], [String(DATA.meta.data_quality.stations - counts.Baik), '', 'Bermasalah']];
  return [];
}

function storyOption(scene) {
  if (scene === 1) {
    const rows = DATA.overview.island26.slice().sort((a, b) => b.mean - a.mean);
    return {
      aria: { enabled: true },
      grid: { left: 90, right: 50, top: 20, bottom: 26 },
      tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(p.name)}</b><br>${fmt(p.value, 1)} µg/m³` },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 10 } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.island), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: 12 } },
      series: [{ type: 'bar', data: rows.map((r) => ({ value: r.mean, itemStyle: { color: r.island === 'Kalimantan' ? C.terra : C.navy, borderRadius: [0, 4, 4, 0] } })), barWidth: 18, label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 11, color: C.navy, formatter: (p) => fmt(p.value, 1) } }],
    };
  }
  if (scene === 2) {
    const rows = DATA.overview.comp_year;
    return {
      aria: { enabled: true },
      grid: { left: 56, right: 20, top: 20, bottom: 30 },
      tooltip: { ...tooltipBase(), formatter: (p) => `<b>${p.name}</b><br>${fmt(p.value, 1)} µg/m³` },
      xAxis: { type: 'category', data: rows.map((r) => String(r.year)), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: 12 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 10 } },
      series: [{ type: 'bar', data: rows.map((r) => ({ value: r.pm25, itemStyle: { color: r.year === 2026 ? C.yellow : C.navy, borderRadius: [4, 4, 0, 0] } })), barWidth: 46, label: { show: true, position: 'top', fontFamily: 'IBM Plex Mono', fontSize: 11, color: C.navy, formatter: (p) => fmt(p.value, 1) } }],
    };
  }
  if (scene === 3) {
    const rows = Object.entries(DATA.time.diurnal).map(([h, v]) => [String(h).padStart(2, '0'), v]);
    return {
      aria: { enabled: true },
      grid: { left: 56, right: 20, top: 24, bottom: 30 },
      tooltip: { ...tooltipBase(), trigger: 'axis', formatter: (ps) => `<b>${ps[0].axisValue}:00</b><br>${fmt(ps[0].value, 1)}%` },
      xAxis: { type: 'category', data: rows.map((r) => r[0]), axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 10, interval: 2 } },
      yAxis: { type: 'value', min: 80, max: 140, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 10, formatter: '{value}%' } },
      series: [{ type: 'line', data: rows.map((r) => r[1]), symbol: 'circle', symbolSize: 4, lineStyle: { width: 2.4, color: C.navy }, itemStyle: { color: C.navy }, areaStyle: { color: 'rgba(231,179,58,.18)' }, markPoint: { symbol: 'circle', symbolSize: 9, itemStyle: { color: C.yellow, borderColor: C.navy, borderWidth: 1.5 }, label: { show: true, position: 'top', fontFamily: 'IBM Plex Mono', fontSize: 10, color: C.navy, formatter: (p) => `${fmt(p.value, 1)}%` }, data: [{ coord: ['07', DATA.time.diurnal['7']], value: DATA.time.diurnal['7'] }, { coord: ['18', DATA.time.diurnal['18']], value: DATA.time.diurnal['18'] }] } }],
    };
  }
  if (scene === 4) {
    const y = DATA.health.years[2];
    const keys = ['resp', 'resp_admissions_under5', 'resp_admissions_over60', 'death'];
    return {
      aria: { enabled: true },
      grid: { left: 100, right: 60, top: 20, bottom: 26 },
      tooltip: { ...tooltipBase(), formatter: (p) => `<b>${OUTCOME_LABELS[keys[p.dataIndex]]}</b><br>+${fmtInt(p.value)}` },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 10, formatter: (v) => fmtInt(v) } },
      yAxis: { type: 'category', inverse: true, data: keys.map((k) => OUTCOME_LABELS[k]), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: 12 } },
      series: [{ type: 'bar', data: keys.map((k) => y.excess[k]), barWidth: 22, itemStyle: { color: C.terra, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 11, color: C.navy, formatter: (p) => '+' + fmtInt(p.value) } }],
    };
  }
  if (scene === 5) {
    const counts = DATA.network.status_counts;
    const rows = STATUS_ORDER.map((s) => ({ name: s, value: counts[s] || 0 }));
    return {
      aria: { enabled: true },
      grid: { left: 110, right: 50, top: 20, bottom: 26 },
      tooltip: { ...tooltipBase(), formatter: (p) => `<b>${esc(p.name)}</b><br>${p.value} stasiun` },
      xAxis: { type: 'value', splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 10 } },
      yAxis: { type: 'category', inverse: true, data: rows.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.navy, fontSize: 12 } },
      series: [{ type: 'bar', data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.name === 'Baik' ? C.teal : r.name === 'Perhatian' ? C.yellow : r.name === 'Terbatas' ? C.terra : r.name === 'Tidak memadai' ? '#C0453C' : C.red, borderRadius: [0, 4, 4, 0] } })), barWidth: 20, label: { show: true, position: 'right', fontFamily: 'IBM Plex Mono', fontSize: 11, color: C.navy } }],
    };
  }
  return null;
}

/* ------------------------------------------------------------------ tip */
function initTip() {
  const tip = $('#tip');
  let current = null;
  const show = (el) => {
    const text = el.dataset.tip;
    if (!text) return;
    current = el;
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 270, Math.max(8, r.left + r.width / 2 - 130));
    const y = Math.min(window.innerHeight - 80, r.bottom + 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const hide = () => { current = null; tip.hidden = true; };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('mouseout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) show(el);
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true);
}

/* ------------------------------------------------------------------ start */
boot();
