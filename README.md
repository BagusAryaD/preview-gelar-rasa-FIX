# NAPAS — Preview Dashboard

Preview statis dashboard **NAPAS (Navigasi Polusi & Aksi Sehat)** untuk Gelar Rasa 2026.
Tujuannya mengunci visual, interaksi, dan angka sebelum dipindahkan ke Next.js.

Sistem visual: **Langit Kaca** — glassmorphism di atas kanvas aurora; detail token, resep kaca,
dan aturan chart ada di [`DESIGN.md`](DESIGN.md).

- Semua angka berasal dari `data/metrics.json` (hash `75f98f06…`) melalui `build_preview_data.py`.
- Chart memakai **ECharts 5** dan peta memakai **MapLibre GL 4** dari CDN, jadi opsi chart bisa dipakai hampir 1:1 di `echarts-for-react`.
- Layout dikunci 1440×900 lalu diskalakan dengan `transform: scale()`; di bawah 900px beralih ke layout mobile (bottom nav + filter sheet).

## Menjalankan

Dari folder `preview`:

```powershell
python -m http.server 8765
```

Buka <http://localhost:8765/>. Jangan membuka `index.html` langsung (`file://`) karena `fetch` JSON akan diblokir browser.

Contoh URL state:

```
?page=wilayah&station=KTG-02
?page=ringkasan&island=Kalimantan
?page=sumber&island=Kalimantan
?mode=story&scene=3
```

## Struktur

```
preview/
├─ index.html                 shell: aurora, sidebar, topbar, filterbar, mobile nav/sheet, story
├─ DESIGN.md                  token, resep kaca, aturan chart, checklist aksesibilitas
├─ assets/
│  ├─ app.js                  render 7 halaman, section terpisah, filter, chart, peta, URL state
│  ├─ style.css               sistem kaca, layout 1440×900, responsive, motion
│  ├─ fonts.css               @font-face self-host
│  ├─ fonts/                  Fraunces, Plus Jakarta Sans, IBM Plex Mono (woff2)
│  └─ logo.png                logo Gelar Rasa (480 px, sudah di-trim)
├─ _backup_2026-11-09/        salinan index.html, style.css, app.js sebelum redesign
├─ data/
│  ├─ meta.json               hash metrics.json, data quality, periode
│  ├─ overview.json           KPI, ranking, tren bulanan, per pulau
│  ├─ stations.json           metadata 27 stasiun + koordinat
│  ├─ time.json               harian/bulanan stasiun & pulau, diurnal, hour×dow, episode
│  ├─ sources.json            korelasi, polutan, meteorologi, wind rose
│  ├─ health.json             observed/expected, lag, beban per stasiun, bulanan
│  ├─ network.json            status, QC, completeness, blind spot
│  ├─ method.json             definisi KPI, QC, batasan, sitasi
│  └─ metrics.json            salinan kanonis untuk tombol unduh
├─ build_preview_data.py      generator seluruh JSON di atas
├─ download_fonts.py          unduh font Google (sekali saja)
└─ optimize_assets.py         trim logo + resize
```

## Regenerasi data

`build_preview_data.py` membaca artefak pipeline di folder kerja analisis
(`metrics.json`, `daily_station.csv`, `station_mean.csv`, `health_with_station.csv`,
`lag_merged.csv`). Path default ada di bagian atas skrip dan bisa diubah.

```powershell
python build_preview_data.py
```

Skrip akan menyalin `metrics.json`, menghitung SHA-256, lalu menulis ulang semua
JSON. Setelah itu muat ulang browser. Jangan mengedit angka di `index.html` atau
`app.js`: semua nilai wajib lewat JSON.

## Peta tanpa token

Peta memakai style kosong `{version: 8, sources: {}, layers: []}` dan hanya
menambahkan titik GeoJSON dari `stations.json`. Tidak ada MapTiler/Mapbox token.
Label pulau adalah Marker DOM, bukan layer basemap.

## Catatan port ke Next.js

1. Pindahkan `assets/app.js` menjadi komponen/hook (`useEffect` + `echarts.init`).
   Opsi chart bisa disalin langsung; ganti `makeChart()` dengan `setOption()`.
2. `fetch('data/*.json')` menjadi impor statis atau route handler.
3. Peta: `maplibre-gl` React wrapper dengan style kosong yang sama.
4. Filter sudah disimpan di URL (`page`, `island`, `station`, `mode`, `scene`);
   pertahankan kontrak ini agar tautan yang sudah dibagikan tetap valid. Chart yang
   berbeda tidak memakai tab/switch; tampil sebagai section terpisah yang bisa di-scroll.
5. Token warna, kaca, dan tipografi ada di [`DESIGN.md`](DESIGN.md) dan bagian atas
   `style.css` — jadikan Tailwind theme atau CSS variables di `globals.css`.
6. Layout: shell grid `232px 1fr` pada desktop; di bawah 900px sidebar diganti bottom
   nav 5 item, filter jadi bottom sheet, dan Story memakai kolom tunggal.
7. Jaga anggaran performa: maksimum 14 elemen `backdrop-filter` per halaman; jangan
   menaruh kaca di dalam kaca.

## Deployment preview

Preview statis bisa langsung diunggah:

- **Netlify Drop** — seret folder `preview` ke <https://app.netlify.com/drop>.
- **Vercel** — `vercel deploy preview --prod` dari folder `preview`.
- **GitHub Pages** — unggah isi `preview/` ke branch `gh-pages`.

Tidak ada build step dan tidak ada environment variable.
