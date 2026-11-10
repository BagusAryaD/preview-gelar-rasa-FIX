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
| Page title | Fraunces 28 / 600, tracking −.015em |
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
      grid clamp(200..264)px + 1fr, gap clamp(10..16), transparan
  .sidebar     kaca strong, radius 24, nav 42px
  .workspace   rows 58 / 46 / 1fr, gap 12
    .topbar    kaca, radius 18
    .filterbar kaca putih 72%, radius 16
    .main > .page  scroll internal
```

Aurora: tiga orb blur 90px (mint kiri-atas, lavender kanan-atas, peach kanan-bawah) + grain 5%.
Animasi drift 46–62 detik; mati saat `prefers-reduced-motion`.

**Layout fluid, tanpa skala.** `fit()` tidak lagi memakai `transform:scale`; stage mengisi lebar & tinggi viewport
(1280–2000 px) sehingga tidak ada gutter kiri-kanan di laptop. Breakpoint: 1180 (sidebar 208), 900 (mobile),
420 (mobile kecil), plus `max-height:880` untuk laptop pendek yang mengecilkan tinggi kartu satu tingkat.

## 6. Komponen

- **KPI**: ikon tint 24px + label + info; nilai 34; baseline chip + window mono. Glow radial per `data-id`.
- **Card**: head 42px dengan hairline; body chart penuh; tanpa footer naratif.
- **Badge ISPU**: pill 21px, border + latar lembut, dot 5px.
- **Pill filter**: 28px, kaca putih, mono untuk nilai.
- **Select filter**: 32px, latar putih solid, border `rgba(24,32,72,.16)`, teks 11.5px/650; label 9.5px uppercase `--brand` 58% + garis pemisah `1px --hairline` antar grup. Kontrol harus terbaca sebagai kontrol, bukan teks.
- **Tabel**: header sticky putih 94%, 9px uppercase, `th.num` rata kanan agar lurus dengan `td.num`; padding 6–10px; angka mono; `border-collapse:separate`.
- **Peta**: kanvas `#EAF2FB` + basemap GeoJSON lokal (34 provinsi, `fill` putih, garis `rgba(24,32,72,.26)` 0.7px) + label pulau 8px. Legenda/badge putih 88% tanpa blur. Tanpa tile server / API key.
- **Story**: panel kaca penuh, progress kuning, kartu 7 halaman di adegan 6.
- **Mobile**: bottom nav 5 item (4 halaman + Lainnya), filter bottom sheet, more sheet 6 item.
- **Panel detail**: 380px di kanan (top 84, bottom 14), radius 22, latar opaque `rgba(255,255,255,.95)`, judul Fraunces 22, body scroll internal. Mobile: bottom sheet `max-height:78vh`, latar `rgba(252,253,255,.98)` tanpa blur, radius atas 22, scrim `rgba(19,26,56,.22)`.
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

## 9. Jangan

- Kaca di dalam kaca, blur pada tabel/metric, atau bayangan gelap pekat.
- Headline interpretif, paragraf insight, kalimat di bawah KPI.
- Angka hardcode di markup; semua dari `data/*.json`.
- Dua tema chart (terang/gelap) dalam satu halaman.
