# NAPAS — Design System "Langit Kaca"

Acuan visual untuk port ke Next.js. Semua nilai di sini sudah dipakai di `preview/assets/style.css`.

## 1. Arah

Kaca frosted di atas kanvas aurora mint–lavender–peach. Terang, lapang, presisi.
Kaca hanya di permukaan level atas; tidak ada kaca di dalam kaca.

Referensi bentuk: Nova (shell mengambang), FundMind (KPI + glow), Ultraleads (kartu statistik),
Channel Analytics (sidebar ringkas), Minimalist Light (tipografi editorial), WhatsApp dashboard (kepadatan data).

## 2. Palet

| Token | Nilai | Pakai |
|---|---|---|
| `--brand` | `#182048` | teks utama, KPI, chart 2026 |
| `--brand-2` | `#2A3568` | gradient tombol primer |
| `--brand-3` | `#3B4784` | aksen KPI respirasi |
| `--accent` | `#F8E028` | progress Story, fokus, dot nav aktif |
| `--ink` | `#131A38` | teks isi |
| `--muted` | `#5B6484` | label, sumbu |
| `--muted-2` | `#7A82A0` | meta, mono |
| `--teal` | `#0F9D8A` | Baik |
| `--moss` | `#6B9B2E` | Sedang |
| `--amber` | `#E3A008` | Tidak Sehat |
| `--terra` | `#D9663F` | Sangat Tidak Sehat |
| `--red` | `#B3261E` | Berbahaya |
| `--grey` | `#A8B0C2` | Tanpa data |

Turunan lembut: `--teal-soft #DFF6F1`, `--moss-soft #EEF5DC`, `--amber-soft #FFF2CC`,
`--terra-soft #FBE8E1`, `--red-soft #F8E1DE`.

Jangan menambah warna kategori baru. Untuk seri non-ISPU pakai navy, teal, terra, amber, atau ungu `#7B6BB0`.

## 3. Kaca

```css
--glass: rgba(255,255,255,.58);
--glass-strong: rgba(255,255,255,.74);
--glass-soft: rgba(255,255,255,.42);
--glass-border: rgba(255,255,255,.76);
--shadow-glass: 0 18px 40px -24px rgba(19,26,56,.38), 0 2px 10px rgba(19,26,56,.05);
--shadow-lift: 0 24px 52px -26px rgba(19,26,56,.45), 0 4px 14px rgba(19,26,56,.07);
--inner: inset 0 1px 0 rgba(255,255,255,.9);
```

Resep permukaan:

```css
background: var(--glass);
border: 1px solid var(--glass-border);
box-shadow: var(--inner), var(--shadow-glass);
backdrop-filter: blur(22px) saturate(150%);
-webkit-backdrop-filter: blur(22px) saturate(150%);
border-radius: 20px;
```

Radius: shell 24, card 20, control 10–12, chip 999.
Blur: sidebar 24, topbar/card 22, filterbar 20, KPI 20, story 26.

### Anggaran performa
- Maksimum **14 elemen** ber-`backdrop-filter` per halaman.
- Elemen di dalam kaca (tabel, metric, stat-block, chip, badge, legend peta) **tanpa** blur.
- Scrim mobile tanpa blur; sheet memakai latar opaque `rgba(252,253,255,.98)`.
- Fallback `@supports not (backdrop-filter)`: putih 93%.

## 4. Tipografi

- `--serif`: Fraunces — judul halaman, brand, angka KPI Story, nama stasiun.
- `--sans`: Plus Jakarta Sans — UI, label, chart, isi.
- `--mono`: IBM Plex Mono — meta, satuan, tabel numerik, hash, kode.

Skala:

| Peran | Ukuran / berat |
|---|---|
| Page title | Fraunces 24 / 600, tracking −.015em |
| Story title | Fraunces 48 / 600, leading 1.03 |
| Card title | 13 / 700 |
| Body | 12–12,5 / 400–550 |
| Label mikro | 9–9,5 / 700, uppercase, tracking .1em |
| KPI value | 34 / 700, tabular, tracking −.035em |
| Story KPI | Fraunces 34 / 600 |
| Meta/tabel | Mono 8,5–10 |

## 5. Shell

```
.app  width:100% (max 2000), height:100%, padding clamp(10..16),
      grid clamp(168..224)px + 1fr, gap clamp(10..16), transparan
  .sidebar     kaca strong, radius 24, nav 42px
  .workspace   rows 58 / 46 / 1fr, gap 12
    .topbar    kaca, radius 18
    .filterbar kaca putih 72%, radius 16
    .main > .page  scroll internal
```

Aurora: tiga orb blur 90px (mint kiri-atas, lavender kanan-atas, peach kanan-bawah) + grain 5%.
Animasi drift 46–62 detik; mati saat `prefers-reduced-motion`.

**Layout fluid, tanpa skala.** `fit()` tidak lagi memakai `transform:scale`; stage mengisi lebar & tinggi viewport
(1280–2000 px) sehingga tidak ada gutter kiri-kanan di laptop. Breakpoint: 1180 (sidebar 184), 900 (mobile),
420 (mobile kecil), plus `max-height:880` untuk laptop pendek yang mengecilkan tinggi kartu satu tingkat.

## 6. Komponen

- **KPI**: ikon tint 24px + label + info; nilai 34; baseline chip + window mono. Glow radial per `data-id`.
- **Card**: head 42px dengan hairline; body chart penuh; tanpa footer naratif.
- **Badge ISPU**: pill 21px, border + latar lembut, dot 5px.
- **Pill filter**: 28px, kaca putih, mono untuk nilai.
- **Select filter**: 32px, latar putih solid, border `rgba(24,32,72,.16)`, teks 11.5px/650; label 9.5px uppercase `--brand` 58% + garis pemisah `1px --hairline` antar grup. Kontrol harus terbaca sebagai kontrol, bukan teks.
- **Tabel**: header sticky putih 94%, 9px uppercase, `th.num` rata kanan agar lurus dengan `td.num`; padding 6–10px; angka mono; `border-collapse:separate`.
- **Peta**: kanvas `#EAF2FB` + basemap GeoJSON lokal (34 provinsi, `fill` putih, garis `rgba(24,32,72,.26)` 0.7px) + label pulau 8px. Legenda putih 88% tanpa blur, **ukuran kecil**: padding 6×8, swatch 8px, teks 9px, judul `.map-legend-title` 8px uppercase (menggantikan badge "ISPU dominan" yang dihapus). Tanpa tile server / API key.
- **Label stasiun di peta**: mono 8px + halo putih; **selalu di atas titik** (`dy` −8 / −12 / −16, boleh geser ±16px horizontal agar tidak menabrak). Yang tidak muat digabung ke label terdekat sebagai chip `+n` (klik → `fitBounds` gumpalan). Titik stasiun tidak boleh tertutup label.
- **Story**: panel kaca penuh, progress kuning, kartu 7 halaman di adegan 6.
- **Mobile**: bottom nav 5 item (4 halaman + Lainnya), filter bottom sheet, more sheet 6 item.
- **Panel detail**: 368px di kanan (top 84, bottom 14), radius 22, latar opaque `rgba(255,255,255,.95)`, judul Fraunces 22, body scroll internal. Varian **`.is-wide`** = `min(680px, 100% − 2×pad)` untuk tabel/profil berpasangan (perbandingan stasiun). Mobile: bottom sheet `max-height:78vh`, latar `rgba(252,253,255,.98)` tanpa blur, radius atas 22, scrim `rgba(19,26,56,.22)`; `.is-wide` kembali `width:auto`.
- **KPI clickable**: KPI yang punya destinasi dirender `role="link"`, `tabindex="0"`, `data-kpi`, Enter/Space aktif; KPI tanpa destinasi dirender biasa (tanpa affordance link).
- **Garis ambang P55**: `ppItem()`/`markLinePP()` → garis putus amber 1px + label mono 8px "PP 55" (posisi `insideEndTop`, tidak diputar). Dipakai di semua plot µg/m³; chart % / heatmap / kasus dikecualikan.
- **Tombol ghost di head kartu** (`Bandingkan`): 24px, border 1px `--hairline`, teks 10.5/700, membuka panel detail lebar.
- **Chip kembali**: pill 32px di topbar, ikon panah 14, teks 11px, maks 300px (mobile 150px), animasi `chip-in` 260ms. Dua mode: konteks panel (`Okt 2026`, `KTG-02`, `Angin TGR`) dan halaman asal (`.to-page`, `← Ringkasan`). Saat mode halaman aktif, `body.has-back` menyembunyikan brand di mobile.
- **Baris daftar di panel**: label mono 9.5 + track 6px + nilai mono; hover putih 85%; baris ber-`data-station` membuka profil stasiun.
- **Stack ISPU di panel**: tinggi 9px, segmen ber-radius penuh, border putih 0.55 antar segmen, legenda 10px.
- **Baris tabel interaktif**: `cursor:pointer` + `tabindex="0"`; aktivasi klik **dan** Enter/Space lewat `bindRowActivate()`. Atribut per tabel: `data-geo-station`, `data-meteo`, `data-health-station`, `data-net-station`.

## 7. Chart

- ECharts 5, font Plus Jakarta Sans; tooltip navy `rgba(19,26,56,.92)` radius 12 + blur 14.
- Sumbu: label 9px `--muted`, garis `rgba(24,32,72,.075)`, tanpa tick.
- Bar: radius 8 ujung luar, lebar 10 horizontal / 22 vertikal; track horizontal `rgba(24,32,72,.045)`.
- Bar bertumpuk: lebar 16, radius 4, border putih 1px.
- Line tren bulanan: **satu jalur kontinu** 2024-01 → 2026-10. Tiap seri tahun dimulai pada bulan terakhir tahun sebelumnya (`from = firstIndex − 1`) supaya garis tidak putus di Januari. Warna per tahun: 2024 `#B4BCCD`, 2025 `#5E6A93`, 2026 navy; lebar 1.9 → 2.8px; area gradient + shadow hanya 2026; pita tahun ganjil `rgba(24,32,72,.032)` sebagai `markArea`.
- Heatmap: border putih 1px; ramp mengikuti makna (mint→amber→terra untuk PM; terra→netral→navy untuk korelasi).
- Larangan: dual axis, 3D, pie >4 irisan, warna kategori di luar palet.
- Chart yang bisa diklik memakai `pickByPixel(chart, el, axis, onPick)` (konversi piksel → indeks, toleransi 1 baris/kolom penuh) atau `pickPolar()` untuk wind rose, bukan hit-test simbol; kursor pointer + callback ditunda satu frame agar dispose aman.
- Polar (`convertFromPixel({polarIndex:0})`) mengembalikan `[radius, angleIndex]` — urutan terbalik dari grid. Sudut tengah sektor = `90 − (i + 0.5) × 22,5` derajat.

## 8. Aksesibilitas

- Fokus terlihat: outline 2px `--accent`, offset 2.
- Kontras teks utama ≥ 7:1 di atas kaca; label ≥ 4.5:1.
- `aria-current="page"` pada nav aktif; `aria-expanded` pada sheet; tombol ikon punya `aria-label`.
- Target sentuh ≥ 32px; bottom nav 64px.
- `prefers-reduced-motion`: semua animasi/transisi dimatikan.
- Panel detail: `role="dialog"`, `aria-labelledby` judul, fokus pindah ke tombol × saat buka, Esc menutup, klik luar menutup, Back browser menutup.

## 9. Tata letak per halaman (kontrak 11 Nov 2026)

Grid 12 kolom; tinggi kartu dari token `h-*` (`h-460` = 420px desktop, 330px compact, `auto` di mobile). `.grid-55` = dua kolom `55fr/45fr` (jadi satu kolom di ≤900px).

**Ringkasan** — alur baca: seberapa buruk → di mana → sejak kapan → siapa → dampaknya.
1. `page-head` + 3 pill (rasio 2024, `valid_overall_pct`, wilayah tanpa stasiun).
2. KPI ×4, semuanya pintu: `mean`→Waktu, `above55`→Waktu, `heaviest`→panel stasiun, `resp`→Kesehatan.
3. `.grid-55`: Peta hotspot **55%** ∥ Tren nasional **45%** — keduanya `h-420`.
4. Baris 2 (`h-320`): Ranking pulau `span-3` ∥ Siklus 24 jam `span-4` ∥ Observed vs expected `span-5`.
5. Baris 3 (`h-280`): Komposisi ISPU per pulau `span-6` ∥ Perbandingan 5 kelas lokasi `span-6`.
- Tren: 2026 `#D9663F` + titik, 2024/2025 slate, label bulan miring 45°, garis `PP 55` + `WHO 15`.
- Siklus 24 jam: 3 garis indeks % (Nasional solid, Koridor jalan & Lahan gambut putus) + pita 06–08/17–19 + label puncak netral.
- Kelas lokasi: grouped bar baseline vs mean 2026, garis P55 vertikal, urut menurun, tanpa P95.
- Filter stasiun ter-scope ke KPI/peta/tren/komposisi/siklus/observed/kelas.
- Tidak ada lagi kartu "Beban kesehatan" dan "Ranking 10 stasiun".

**Waktu** — "Harian" `span-12 h-460` di baris pertama setelah KPI (fokus utama). Tidak ada kartu "Bulanan" (tren bulanan ada di Ringkasan). Kartu terakhir: Komposisi ISPU per tahun `span-12 h-280`, klik tahun → panel komposisi + selisih poin % vs tahun sebelumnya.

**Wilayah** — Peta stasiun `span-7 h-420` ∥ Profil stasiun `span-5 h-420` (tombol `Bandingkan` di head → panel `.is-wide`: select A/B + 2 profil + tabel selisih). Lalu Tren bulanan stasiun `span-12 h-280`, Kronis–akut `span-7 h-320` ∥ Ringkasan beban `span-5 h-320`, tabel 27 stasiun. Tidak ada kartu "Pilih pembanding"/"Bandingkan profil" di halaman.

**Sidebar** — `clamp(168px, 12.2vw, 224px)`, breakpoint ≤1180px → 184px.

## 10. Jangan

- Kaca di dalam kaca, blur pada tabel/metric, atau bayangan gelap pekat.
- Headline interpretif, paragraf insight, kalimat di bawah KPI.
- Angka hardcode di markup; semua dari `data/*.json`.
- Dua tema chart (terang/gelap) dalam satu halaman.
