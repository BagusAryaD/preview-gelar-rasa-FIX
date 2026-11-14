"""
Build compact preview JSON from the canonical metrics + analysis tables.

Source of truth:
  - metrics.json (hash is copied into meta.json)
  - daily_station.csv, station_mean.csv (same pipeline as analysis.py)

Run:
  python build_preview_data.py
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
OUT = HERE / "data"
OUT.mkdir(parents=True, exist_ok=True)

# The analysis artefacts live outside the workspace. Override with env vars if needed.
REPORT = Path(r"C:\Users\Bagus AD\AppData\Local\Temp\opencode\napas_report")
METRICS = REPORT / "metrics.json"
DAILY = REPORT / "daily_station.csv"
STATION_MEAN = REPORT / "station_mean.csv"
HEALTH = REPORT / "health_with_station.csv"
LAG = REPORT / "lag_merged.csv"
DATASET = HERE.parent / "Dataset"

if not METRICS.exists():
    raise SystemExit(f"metrics.json not found at {METRICS}")

raw_metrics = METRICS.read_bytes()
metrics = json.loads(raw_metrics.decode("utf-8"))
sha = hashlib.sha256(raw_metrics).hexdigest()

# Keep a copy next to the preview for the download button and traceability.
shutil.copyfile(METRICS, OUT / "metrics.json")

daily = pd.read_csv(DAILY, parse_dates=["date"])
station_mean = pd.read_csv(STATION_MEAN)
health_raw = pd.read_csv(HEALTH, parse_dates=["date"])
lag_raw = pd.read_csv(LAG, parse_dates=["date"])

# ---------------------------------------------------------------- helpers
OUTCOMES = [
    ("resp", "Respirasi", "Respirasi"),
    ("resp_admissions_under5", "Balita", "Balita"),
    ("resp_admissions_over60", "Lansia", "Lansia"),
    ("asthma_emergency_cases", "Asma", "Asma"),
    ("copd_admissions", "PPOK", "PPOK"),
    ("cvd", "Kardiovaskular", "Kardiovaskular"),
    ("death", "Kematian", "Kematian"),
]
STATUS_ORDER = ["Baik", "Perhatian", "Terbatas", "Tidak memadai", "Gagal"]
ISPU_ORDER = ["Baik", "Sedang", "Tidak Sehat", "Sangat Tidak Sehat", "Berbahaya"]

usable = daily[daily["usable"] == True].copy()
usable["date"] = pd.to_datetime(usable["date"])
usable["dow"] = usable["date"].dt.dayofweek
usable["is_weekend"] = usable["dow"] >= 5


def category_from_pm25(x):
    if pd.isna(x):
        return "Tanpa data"
    if x <= 15.5:
        return "Baik"
    if x <= 55.4:
        return "Sedang"
    if x <= 150.4:
        return "Tidak Sehat"
    if x <= 250.4:
        return "Sangat Tidak Sehat"
    return "Berbahaya"


def window_stats(frame):
    if frame.empty:
        return {"mean": None, "days": 0, "stations": 0, "above55_pct": None, "above55_n": 0, "severe_n": 0, "p95": None, "max": None}
    vals = frame["pm25"].astype(float)
    return {
        "mean": round(float(vals.mean()), 1),
        "days": int(len(frame)),
        "stations": int(frame["station"].nunique()),
        "above55_pct": round(float((vals > 55).mean() * 100), 1),
        "above55_n": int((vals > 55).sum()),
        "severe_n": int((vals > 150.4).sum()),
        "p95": round(float(vals.quantile(0.95)), 1),
        "max": round(float(vals.max()), 1),
    }


def ispu_composition(frame):
    counts = frame.groupby("kategori").size()
    total = int(counts.sum())
    return {cat: (round(float(counts.get(cat, 0) / total * 100), 1) if total else 0.0) for cat in ISPU_ORDER}

# ---------------------------------------------------------------- stations
station_table = pd.DataFrame(metrics["station_table"])
top26 = pd.DataFrame(metrics["top26"])
top26_by_station = top26.set_index("station")

# default station view (1 Jan–14 Okt 2026), matching Tanggal acuan 14 Okt + Rentang Tahun
haze = usable[(usable["date"] >= "2026-01-01") & (usable["date"] <= "2026-10-14")].copy()


def dominant_ispu(frame: pd.DataFrame) -> pd.DataFrame:
    counts = frame.groupby(["station", "kategori"]).size().reset_index(name="n")
    total = counts.groupby("station")["n"].transform("sum")
    counts["share"] = (counts["n"] / total * 100).round(1)
    return (
        counts.sort_values(["station", "n"], ascending=[True, False])
        .drop_duplicates("station")
        .set_index("station")[["kategori", "share"]]
    )


ispu_dom = dominant_ispu(haze)

# station stats for the canonical haze window
def station_window(frame: pd.DataFrame) -> pd.DataFrame:
    return (
        frame.groupby("station")
        .agg(mean=("pm25", "mean"), p95=("pm25", lambda x: x.quantile(.95)), max=("pm25", "max"), days=("pm25", "size"))
        .round(1)
    )


win_haze = station_window(haze)

# per-station monthly 2026 (for the profile sparkline)
m26 = usable[usable["date"].dt.year == 2026].copy()
m26["month"] = m26["date"].dt.strftime("%Y-%m")
monthly_station = (
    m26.groupby(["station", "month"]).agg(pm25=("pm25", "mean"), days=("pm25", "size")).reset_index()
)
monthly_station["pm25"] = monthly_station["pm25"].round(1)
monthly_map = {
    st: [{"m": r.month, "v": float(r.pm25), "n": int(r.days)} for r in g.itertuples()]
    for st, g in monthly_station.groupby("station")
}

stations = []

# sensor hardware + instrument inventory (from sensors.csv / sites.csv)
INSTRUMENTS = [
    ("pm25", "PM2.5"),
    ("pm10", "PM10"),
    ("so2", "SO2"),
    ("co", "CO"),
    ("o3", "O3"),
    ("no2", "NO2"),
]
_sensors = pd.read_csv(DATASET / "sensors.csv")
_sites_raw = pd.read_csv(DATASET / "sites.csv")
_sites_raw["station"] = _sites_raw["location_id"].str.replace("LOC-", "", regex=False)
_sensors["station"] = _sensors["location_id"].str.replace("LOC-", "", regex=False)


def _pretty(text):
    return str(text).replace("_", " ").strip()


sensor_by_station = {}
for r in _sensors.to_dict(orient="records"):
    sensor_by_station[r["station"]] = {
        "id": r["sensor_id"],
        "name": _pretty(r["nama_sensor"]),
        "model": _pretty(r["model_sensor"]),
        "mounting": _pretty(r["tipe_pemasangan"]),
        "status": _pretty(r["status_operasional"]),
        "installed": str(r["tanggal_instalasi"])[:10],
    }

instruments_by_station = {}
for r in _sites_raw.to_dict(orient="records"):
    rows = []
    for key, label in INSTRUMENTS:
        equipment = r.get(f"{key}_equipment")
        if not equipment or pd.isna(equipment):
            continue
        unit = str(r.get(f"{key}_unit") or "ug/m3")
        rows.append(
            {
                "pollutant": label,
                "equipment": _pretty(equipment),
                "unit_raw": unit,
                "converted": unit == "ppm",
            }
        )
    meteo = r.get("meteo_equipment")
    if meteo and not pd.isna(meteo):
        rows.append({"pollutant": "Meteo", "equipment": _pretty(meteo), "unit_raw": "—", "converted": False})
    instruments_by_station[r["station"]] = rows

for row in station_table.to_dict(orient="records"):
    st = row["station"]
    t = top26_by_station.loc[st] if st in top26_by_station.index else None
    dom = ispu_dom.loc[st] if st in ispu_dom.index else None
    s_haze = win_haze.loc[st] if st in win_haze.index else None
    stations.append(
        {
            "id": st,
            "city": row["city"],
            "province": row["province"],
            "island": row["island"],
            "site_type": row["site_type"],
            "site_class": row["site_class"],
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
            "baseline": float(row["baseline"]),
            "traffic": float(row["traffic"]),
            "distance": float(row["distance"]),
            "status": row["status"],
            "issues": row["issues"],
            "usable_days": int(row["usable_days"]),
            "total_days": int(row["total_days"]),
            "usable_pct": float(row["usable_pct"]),
            "valid_pct": float(row["valid_pct"]),
            "mean_2026": None if s_haze is None else float(s_haze["mean"]),
            "p95_2026": None if s_haze is None else float(s_haze["p95"]),
            "max_2026": None if s_haze is None else float(s_haze["max"]),
            "days_2026": 0 if s_haze is None else int(s_haze["days"]),
            "lower_bound": st == "SM2-01",
            "ispu_dominant": None if dom is None else str(dom["kategori"]),
            "ispu_share": None if dom is None else float(dom["share"]),
            "monthly_2026": monthly_map.get(st, []),
            "sensor": sensor_by_station.get(st),
            "instruments": instruments_by_station.get(st, []),
        }
    )

status_counts = {s: int((station_table["status"] == s).sum()) for s in STATUS_ORDER}

# ---------------------------------------------------------------- overview
# Default view: Tanggal acuan 14 Okt 2026, Rentang Tahun (1 Jan–14 Okt 2026).
# Every other date/range is recomputed in the browser from time.json.
EXCLUDED = {"JMB-02", "MER-01"}
DEFAULT_END = pd.Timestamp("2026-10-14")
default_frame = usable[
    ~usable["station"].isin(EXCLUDED)
    & (usable["date"] >= pd.Timestamp("2026-01-01"))
    & (usable["date"] <= DEFAULT_END)
]
same_span_2024 = usable[
    ~usable["station"].isin(EXCLUDED)
    & (usable["date"] >= pd.Timestamp("2024-01-01"))
    & (usable["date"] <= pd.Timestamp("2024-10-14"))
]
ratio_2024 = round(float(default_frame["pm25"].mean() / same_span_2024["pm25"].mean()), 2)
stats_all = window_stats(default_frame)
stats_by_island = {str(isl): window_stats(g) for isl, g in default_frame.groupby("island")}
stats_by_station = {str(st): window_stats(g) for st, g in default_frame.groupby("station")}
island26 = [
    {"island": isl, "mean": s["mean"], "max": s["max"], "days": s["days"], "stations": s["stations"]}
    for isl, s in stats_by_island.items()
]
island_by_name = {r["island"]: r for r in island26}
ratio_kal_jawa = round(island_by_name["Kalimantan"]["mean"] / island_by_name["Jawa"]["mean"], 2)
top26 = []
for st, g in default_frame.groupby("station"):
    s = window_stats(g)
    top26.append(
        {
            "station": str(st),
            "island": str(g["island"].iloc[0]),
            "site_class": str(g["site_class"].iloc[0]),
            "mean": s["mean"],
            "p95": s["p95"],
            "max": s["max"],
            "days": s["days"],
        }
    )
top26.sort(key=lambda r: r["mean"], reverse=True)

kpis = [
    {
        "id": "national",
        "value": stats_all["mean"],
        "unit": "µg/m³",
        "label": "Rata-rata nasional",
        "baseline": f"{ratio_2024:.1f}× 2024".replace(".", ","),
        "note": f'1 Jan–14 Okt 2026 · {stats_all["days"]:,} hari-stasiun · {stats_all["stations"]} stasiun'.replace(",", "."),
        "ratio": ratio_2024,
    },
    {
        "id": "kalimantan",
        "value": island_by_name["Kalimantan"]["mean"],
        "unit": "µg/m³",
        "label": "Kalimantan",
        "baseline": f"{ratio_kal_jawa:.1f}× Jawa".replace(".", ","),
        "note": "1 Jan–14 Okt 2026 · Kalimantan",
        "ratio": ratio_kal_jawa,
    },
]

# daily national series (equal station-day weighting, same as monthly aggregate)
daily_nat = usable.groupby("date").agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
daily_nat["pm25"] = daily_nat["pm25"].round(1)
daily_series = [[d.strftime("%Y-%m-%d"), float(v), int(n)] for d, v, n in daily_nat.itertuples(index=False)]

# daily by island (for the heatmap filter)
daily_island = {}
for isl, g in usable.groupby("island"):
    gg = g.groupby("date").agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
    daily_island[isl] = [[d.strftime("%Y-%m-%d"), round(float(v), 1), int(n)] for d, v, n in gg.itertuples(index=False)]

# station daily 2026 (for the selected-station line)
station_daily_2026 = {}
for st, g in m26.groupby("station"):
    gg = g.groupby("date").agg(pm25=("pm25", "mean")).reset_index()
    station_daily_2026[st] = [[d.strftime("%Y-%m-%d"), round(float(v), 1)] for d, v in gg.itertuples(index=False)]

# station daily/monthly, all years (heatmap + episode + station trend)
station_daily = {}
station_monthly = {}
for st, g in usable.groupby("station"):
    dd = g.groupby("date").agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
    station_daily[st] = [[d.strftime("%Y-%m-%d"), round(float(v), 1), int(n)] for d, v, n in dd.itertuples(index=False)]
    mm = g.groupby("month").agg(pm25=("pm25", "mean"), days=("pm25", "size")).reset_index()
    station_monthly[st] = [
        {"month": r.month, "pm25": round(float(r.pm25), 1), "days": int(r.days), "year": int(r.month[:4])}
        for r in mm.itertuples()
    ]

# island monthly series
island_monthly = []
for (month, isl), g in usable.groupby(["month", "island"]):
    island_monthly.append(
        {
            "month": month,
            "island": isl,
            "pm25": round(float(g["pm25"].mean()), 1),
            "stations": int(g["station"].nunique()),
            "days": int(len(g)),
        }
    )

# weekday vs weekend, same 1 Aug - 14 Oct window in each year
weekday = []
for y in [2024, 2025, 2026]:
    sub = usable[(usable["date"] >= f"{y}-08-01") & (usable["date"] <= f"{y}-10-14")]
    if sub.empty:
        continue
    weekday.append(
        {
            "year": y,
            "weekday": round(float(sub.loc[~sub["is_weekend"], "pm25"].mean()), 1),
            "weekend": round(float(sub.loc[sub["is_weekend"], "pm25"].mean()), 1),
        }
    )

# ---------------------------------------------------------------- sources
episode_by_station = {
    str(st): int(len(g[g["pm25"] > 55]))
    for st, g in usable.groupby("station")
}
island_of_station = dict(zip(station_table["station"], station_table["island"]))
all_scatter = station_mean[station_mean["days"] >= 500].merge(
    station_table[["station", "status"]], on="station", how="left"
)
all_rows = [
    {
        "station": r.station,
        "island": island_of_station.get(str(r.station)),
        "pm25": round(float(r.pm25), 1),
        "baseline": float(r.baseline_pm25),
        "distance": float(r.distance_to_road_m),
        "traffic": float(r.traffic_intensity_per_h),
        "days": int(r.days),
        "episode_days": episode_by_station.get(str(r.station), 0),
        "status": r.status,
    }
    for r in all_scatter.itertuples()
]

only26_rows = []
for r in top26:
    st = station_table[station_table["station"] == r["station"]].iloc[0]
    only26_rows.append(
        {
            "station": r["station"],
            "island": r["island"],
            "pm25": r["mean"],
            "baseline": float(st["baseline"]),
            "distance": float(st["distance"]),
            "traffic": float(st["traffic"]),
            "days": int(r["days"]),
            "episode_days": episode_by_station.get(str(r["station"]), 0),
            "status": st["status"],
        }
    )

# pooled pollutant correlation matrix from usable station-days
POLLUTANTS = ["pm25", "pm10", "so2", "no2", "o3", "co"]
pollutant_matrix = usable[POLLUTANTS + ["kategori"]].corr(numeric_only=True).round(3)
POLLUTANT_LABELS = {"pm25": "PM2.5", "pm10": "PM10", "so2": "SO2", "no2": "NO2", "o3": "O3", "co": "CO"}
POLLUTANT_UNITS = {"pm25": "µg/m³", "pm10": "µg/m³", "so2": "µg/m³", "no2": "µg/m³", "o3": "µg/m³", "co": "µg/m³"}
pollutant_matrix_payload = {
    "labels": [POLLUTANT_LABELS[p] for p in POLLUTANTS],
    "keys": POLLUTANTS,
    "matrix": [[None if pd.isna(v) else float(v) for v in row] for row in pollutant_matrix.values],
    "n": int(usable[POLLUTANTS].dropna().shape[0]),
}

pollutants = []
for key, label, unit in [
    ("pm25", "PM2.5", "µg/m³"),
    ("pm10", "PM10", "µg/m³"),
    ("so2", "SO2", "µg/m³"),
    ("no2", "NO2", "µg/m³"),
    ("o3", "O3", "µg/m³"),
    ("co", "CO", "µg/m³"),
]:
    val = haze[key].dropna().mean()
    pollutants.append({"key": key, "label": label, "value": round(float(val), 1), "unit": unit, "n": int(haze[key].notna().sum())})

meteo = []
for key, label, unit in [("temp", "Suhu", "°C"), ("hum", "Kelembapan", "%"), ("wind", "Angin", "m/s")]:
    val = haze[key].dropna().mean()
    meteo.append({"key": key, "label": label, "value": round(float(val), 1), "unit": unit, "n": int(haze[key].notna().sum())})

pollutants_by_island = {}
meteo_by_island = {}
for isl, g in haze.groupby("island"):
    pollutants_by_island[str(isl)] = [
        {"key": key, "label": label, "value": round(float(g[key].dropna().mean()), 1), "unit": unit, "n": int(g[key].notna().sum())}
        for key, label, unit in [
            ("pm25", "PM2.5", "µg/m³"),
            ("pm10", "PM10", "µg/m³"),
            ("so2", "SO2", "µg/m³"),
            ("no2", "NO2", "µg/m³"),
            ("o3", "O3", "µg/m³"),
            ("co", "CO", "µg/m³"),
        ]
    ]
    meteo_by_island[str(isl)] = [
        {"key": key, "label": label, "value": round(float(g[key].dropna().mean()), 1), "unit": unit, "n": int(g[key].notna().sum())}
        for key, label, unit in [("temp", "Suhu", "°C"), ("hum", "Kelembapan", "%"), ("wind", "Angin", "m/s")]
    ]

# ---------------------------------------------------------------- health
OUTCOME_KEYS = [k for k, _, _ in OUTCOMES]


def actual_for(frame: pd.DataFrame, year: int) -> dict:
    """Actual hospital visits for the same calendar span as the default range (1 Jan–14 Okt)."""
    g = frame[(frame["date"].dt.year == year) & (frame["date"].dt.strftime("%m-%d") <= "10-14")]
    nat = g.groupby("date")[OUTCOME_KEYS].sum()
    return {
        "year": year,
        "days": int(len(nat)),
        "actual": {o: int(nat[o].sum()) for o in OUTCOME_KEYS},
    }


health_by_island = {}
for isl, g in health_raw.groupby("island"):
    health_by_island[str(isl)] = [actual_for(g, y) for y in (2024, 2025, 2026)]

# lag by island (same method as analysis.py: shift within station)
island_of = dict(zip(station_table["station"], station_table["island"]))
lag_raw["island"] = lag_raw["station"].map(island_of)
lag_by_island = {}
for isl, g in lag_raw.groupby("island"):
    out = {}
    for lag in range(0, 15):
        tmp = g.copy()
        tmp["pm_lag"] = tmp.groupby("station")["pm25"].shift(lag)
        row = {}
        for o in OUTCOME_KEYS:
            sub = tmp.dropna(subset=["pm_lag", o])
            row[o] = round(float(sub["pm_lag"].corr(sub[o])), 3) if len(sub) > 10 else None
        out[str(lag)] = row
    lag_by_island[str(isl)] = out

health_station = pd.DataFrame(metrics["excess_station"]).sort_values("resp", ascending=False).head(15)
health_station = health_station[["station", "island", "days", "resp", "resp_admissions_under5", "resp_admissions_over60", "asthma_emergency_cases", "copd_admissions", "cvd", "death", "usable_pct", "status"]]

# ---------------------------------------------------------------- network
network_stations = []
for r in station_table.to_dict(orient="records"):
    t = top26_by_station.loc[r["station"]] if r["station"] in top26_by_station.index else None
    network_stations.append(
        {
            "station": r["station"],
            "island": r["island"],
            "province": r["province"],
            "status": r["status"],
            "usable_pct": float(r["usable_pct"]),
            "gap": round(100.0 - float(r["usable_pct"]), 1),
            "mean_2026": None if t is None else float(t["mean"]),
            "days_2026": 0 if t is None else int(t["days"]),
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
        }
    )

blind = [s.strip() for s in metrics["coverage"]["no_station_examples"].split(",") if s.strip()]

# ---------------------------------------------------------------- revision derivations
ispu_haze26_pct = {
    str(isl): ispu_composition(g) for isl, g in default_frame.groupby("island")
}
ispu_year_pct = metrics.get("ispu_year_pct", {})
ispu_station_pct = {str(st): ispu_composition(g) for st, g in haze.groupby("station")}
ispu_month_national = {
    str(month): {"days": int(len(g)), "pct": ispu_composition(g)} for month, g in usable.groupby("month")
}
ispu_month_island = [
    {"month": str(month), "island": str(isl), "days": int(len(g)), "pct": ispu_composition(g)}
    for (month, isl), g in usable.groupby(["month", "island"])
]

episode_monthly_islands = []
for (month, isl), g in usable.groupby(["month", "island"]):
    episode_monthly_islands.append(
        {
            "month": str(month),
            "island": str(isl),
            "episode": int((g["pm25"] > 55).sum()),
            "days": int(len(g)),
            "mean": round(float(g["pm25"].mean()), 1),
        }
    )

weekday_island = []
for (year, isl), g in usable.groupby([usable["date"].dt.year, "island"]):
    weekday_island.append(
        {
            "year": int(year),
            "island": str(isl),
            "weekday": round(float(g.loc[~g["is_weekend"], "pm25"].mean()), 1)
            if len(g.loc[~g["is_weekend"]])
            else None,
            "weekend": round(float(g.loc[g["is_weekend"], "pm25"].mean()), 1)
            if len(g.loc[g["is_weekend"]])
            else None,
        }
    )

episode_stats = {}
for st, g in usable.sort_values(["station", "date"]).groupby("station"):
    longest = current = 0
    for value in g["pm25"].to_numpy():
        if value > 55:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    episode_stats[str(st)] = {
        "episode": int((g["pm25"] > 55).sum()),
        "longest": int(longest),
        "total": int(len(g)),
    }

# health monthly actual per day and station actual/lag
health_raw["date"] = pd.to_datetime(health_raw["date"])
health_raw["month"] = health_raw["date"].dt.strftime("%Y-%m")
health_monthly = []
for month, g in health_raw.groupby("month"):
    days = max(1, g["date"].nunique())
    health_monthly.append(
        {
            "month": str(month),
            "days": int(days),
            "resp": round(float(g["resp"].sum() / days), 1),
            "under5": round(float(g["resp_admissions_under5"].sum() / days), 1),
            "over60": round(float(g["resp_admissions_over60"].sum() / days), 1),
            "resp_total": int(g["resp"].sum()),
            "under5_total": int(g["resp_admissions_under5"].sum()),
            "over60_total": int(g["resp_admissions_over60"].sum()),
        }
    )
health_monthly_island = []
for (month, isl), g in health_raw.groupby(["month", "island"]):
    days = max(1, g["date"].nunique())
    health_monthly_island.append(
        {
            "month": str(month),
            "island": str(isl),
            "days": int(days),
            "resp": round(float(g["resp"].sum() / days), 1),
            "under5": round(float(g["resp_admissions_under5"].sum() / days), 1),
            "over60": round(float(g["resp_admissions_over60"].sum() / days), 1),
        }
    )

# station actual health counts for haze window
haze_health = health_raw[(health_raw["date"] >= "2026-08-01") & (health_raw["date"] <= "2026-10-14")].copy()
actual_by_station = {
    str(st): g
    for st, g in haze_health.groupby("station")
}
lag_station = {}
for st, g in lag_raw.groupby("station"):
    gg = g.sort_values("date").copy()
    gg["month_key"] = gg["date"].dt.strftime("%Y-%m")
    gg["pm_anom"] = gg["pm25"] - gg.groupby("month_key")["pm25"].transform("mean")
    for o in OUTCOME_KEYS:
        gg[o + "_anom"] = gg[o] - gg.groupby("month_key")[o].transform("mean")
    row = {}
    for o in OUTCOME_KEYS:
        sub = gg.dropna(subset=["pm_anom", o + "_anom"])
        row[o] = round(float(sub["pm_anom"].corr(sub[o + "_anom"])), 3) if len(sub) >= 30 else None
    lag_station[str(st)] = row

# station actual health counts for the default range (1 Jan–14 Okt 2026)
_health_known = health_raw[health_raw["date"] >= "2024-01-01"]
_default_health = _health_known[
    (_health_known["date"] >= "2026-01-01") & (_health_known["date"] <= "2026-10-14")
]
_default_episode = (
    default_frame[default_frame["pm25"] > 55].groupby("station").size().to_dict()
)
_station_meta = station_table.set_index("station")
health_stations_all = []
for st, g in _default_health.groupby("station"):
    resp = int(g["resp"].sum())
    u5 = int(g["resp_admissions_under5"].sum())
    o60 = int(g["resp_admissions_over60"].sum())
    lag0 = lag_station.get(str(st), {})
    meta_row = _station_meta.loc[st] if st in _station_meta.index else None
    health_stations_all.append(
        {
            "station": str(st),
            "island": str(g["island"].iloc[0]),
            "days": int(g["date"].nunique()),
            "resp_actual": resp,
            "resp_under5_actual": u5,
            "resp_over60_actual": o60,
            "under5_share": round(u5 / resp * 100, 1) if resp else None,
            "over60_share": round(o60 / resp * 100, 1) if resp else None,
            "lag0": lag0,
            "lag0_resp": lag0.get("resp"),
            "episode_days": int(_default_episode.get(str(st), 0)),
            "usable_pct": float(meta_row["usable_pct"]) if meta_row is not None else None,
            "status": str(meta_row["status"]) if meta_row is not None else None,
        }
    )
health_stations_all.sort(key=lambda r: r["resp_actual"], reverse=True)

# ------------------------------------------------------------ hospitals
_hosp_meta = pd.read_csv(DATASET / "hospitals.csv")
_hosp_meta["kapasitas_tempat_tidur"] = pd.to_numeric(_hosp_meta["kapasitas_tempat_tidur"], errors="coerce")
_hosp_meta = _hosp_meta.rename(
    columns={
        "hospital_id": "id",
        "nama_rumah_sakit": "name",
        "kota_kabupaten": "city",
        "kelas_faskes": "kelas",
        "kapasitas_tempat_tidur": "beds",
    }
)
_station_of = dict(zip(_hosp_meta["id"], _hosp_meta["station"])) if "station" in _hosp_meta else {}
# station mapping comes from the analysis output (geographic join)
_station_by_hosp = health_raw.drop_duplicates("hospital_id").set_index("hospital_id")["station"].to_dict()
_island_by_hosp = health_raw.drop_duplicates("hospital_id").set_index("hospital_id")["island"].to_dict()
_siteclass_by_hosp = health_raw.drop_duplicates("hospital_id").set_index("hospital_id")["site_class"].to_dict()

HZ_START, HZ_END = pd.Timestamp("2026-01-01"), pd.Timestamp("2026-10-14")
_hz = health_raw[(health_raw["date"] >= HZ_START) & (health_raw["date"] <= HZ_END)]
_hz_days = int(_hz["date"].nunique())
_actual_all = _hz.groupby("hospital_id")[OUTCOME_KEYS].sum()
_monthly_hosp = {}
for (hosp, month), g in health_raw.groupby(["hospital_id", health_raw["date"].dt.strftime("%Y-%m")]):
    _monthly_hosp.setdefault(hosp, {})[month] = {
        "resp": int(g["resp"].sum()),
        "days": int(g["date"].nunique()),
    }

hospitals_payload = []
for r in _hosp_meta.to_dict(orient="records"):
    hid = r["id"]
    beds = None if pd.isna(r["beds"]) else float(r["beds"])
    actual_row = _actual_all.loc[hid] if hid in _actual_all.index else None
    actual = {o: int(actual_row[o]) for o in OUTCOME_KEYS} if actual_row is not None else {o: 0 for o in OUTCOME_KEYS}
    months = []
    for m in sorted(_monthly_hosp.get(hid, {})):
        entry = _monthly_hosp[hid][m]
        months.append({"m": m, "v": entry["resp"], "days": entry["days"], "partial": entry["days"] < 15})
    hospitals_payload.append(
        {
            "id": hid,
            "name": r["name"],
            "city": r["city"],
            "kecamatan": r["kecamatan"],
            "province": r["provinsi"],
            "kelas": r["kelas"],
            "beds": beds,
            "station": _station_by_hosp.get(hid),
            "island": _island_by_hosp.get(hid),
            "site_class": _siteclass_by_hosp.get(hid),
            "days": _hz_days,
            "actual": actual,
            "per100beds": round(actual["resp"] / beds * 100, 1) if beds else None,
            "monthly": months,
        }
    )

hospitals_payload.sort(key=lambda h: h["actual"]["resp"], reverse=True)


def _province_rows(rows):
    out = {}
    for h in rows:
        p = h["province"]
        agg = out.setdefault(
            p,
            {"province": p, "hospitals": 0, "beds": 0.0, "actual": {o: 0 for o in OUTCOME_KEYS}},
        )
        agg["hospitals"] += 1
        agg["beds"] += h["beds"] or 0
        for o in OUTCOME_KEYS:
            agg["actual"][o] += h["actual"][o]
    result = []
    for p, agg in out.items():
        actual = agg["actual"]
        result.append(
            {
                "province": p,
                "hospitals": agg["hospitals"],
                "beds": round(agg["beds"], 0),
                "island": _island_by_hosp.get(next((h["id"] for h in rows if h["province"] == p), None)),
                "actual": actual,
                "per100beds": round(actual["resp"] / agg["beds"] * 100, 1) if agg["beds"] else None,
            }
        )
    result.sort(key=lambda r: r["actual"]["resp"], reverse=True)
    return result


hospital_provinces = _province_rows(hospitals_payload)
_hosp_island = {}
for _h in hospitals_payload:
    _hosp_island.setdefault(_h["island"], []).append(_h)
hospital_provinces_by_island = {str(k): _province_rows(v) for k, v in _hosp_island.items()}

hospitals_payload_meta = {
    "count": len(hospitals_payload),
    "beds_total": round(sum((h["beds"] or 0) for h in hospitals_payload), 0),
    "provinces": len(hospital_provinces),
    "days": _hz_days,
    "window": "1 Jan–14 Okt 2026",
    "per_bed_unit": "kasus per 100 tempat tidur",
}

# QC totals and completeness
QC_ORDER = ["VALID", "SUSPECT", "MISSING", "CALIBRATING", "WARMUP", "MAINTENANCE", "PARSER_FAIL", "FATAL_ERR", "GARBAGE", "COMM_LOST", "CORRUPT", "SENSOR_DEAD"]
qc_counts = {q: 0 for q in QC_ORDER}
station_valid_pct = {}
for path in sorted(DATASET.glob("*_AQMS.csv")):
    table = pd.read_csv(path, usecols=["qc_flag"])
    total = len(table)
    counts = table["qc_flag"].value_counts().to_dict()
    for q, n in counts.items():
        qc_counts[q] = qc_counts.get(q, 0) + int(n)
    station_valid_pct[path.name.split("_")[0]] = round(float(counts.get("VALID", 0) / total * 100), 1) if total else 0.0

qc_totals = {
    "VALID": int(qc_counts.get("VALID", 0)),
    "SUSPECT": int(qc_counts.get("SUSPECT", 0)),
    "MISSING": int(qc_counts.get("MISSING", 0)),
    "NONAKTIF": int(qc_counts.get("CALIBRATING", 0) + qc_counts.get("WARMUP", 0) + qc_counts.get("MAINTENANCE", 0)),
    "ERROR": int(
        qc_counts.get("PARSER_FAIL", 0)
        + qc_counts.get("FATAL_ERR", 0)
        + qc_counts.get("GARBAGE", 0)
        + qc_counts.get("COMM_LOST", 0)
        + qc_counts.get("CORRUPT", 0)
        + qc_counts.get("SENSOR_DEAD", 0)
    ),
}
qc_detail = {q: int(qc_counts.get(q, 0)) for q in QC_ORDER}

all_daily = daily.copy()
all_daily["date"] = pd.to_datetime(all_daily["date"])
all_daily["month"] = all_daily["date"].dt.strftime("%Y-%m")
all_daily["usable_flag"] = all_daily["usable"].fillna(False).astype(int)
completeness = []
for (st, month), g in all_daily.groupby(["station", "month"]):
    total_days = int(len(g))
    usable_days = int(g["usable_flag"].sum())
    completeness.append(
        {
            "station": str(st),
            "month": str(month),
            "usable_days": usable_days,
            "total_days": total_days,
            "pct": round(usable_days / total_days * 100, 1) if total_days else None,
        }
    )
completeness.sort(key=lambda r: (r["station"], r["month"]))

# hourly derivatives (P1 part, kept optional-safe)
NUM_SUFFIX = ("_ug_m3", "_c", "_pct", "_ms", "_deg")
PHYS = {
    "pm25_ug_m3": (0, 2000), "pm10_ug_m3": (0, 3000), "so2_ug_m3": (0, 2000),
    "co_ug_m3": (0, 50000), "o3_ug_m3": (0, 1000), "no2_ug_m3": (0, 2000),
    "temperature_c": (-10, 50), "humidity_pct": (0, 100),
    "wind_speed_ms": (0, 60), "wind_direction_deg": (0, 360),
}

# ppm -> µg/m³ for gases: C[µg/m³] = C[ppm] × MW × 1000 / Vm(T), Vm = 0.082057 × T[K].
GAS_MW = {"so2": 64.07, "co": 28.01, "o3": 48.00, "no2": 46.01}
R_LATM = 0.082057
T_FALLBACK_K = 298.15


def convert_ppm_columns(df, ppm_cols, temp_col="temperature_c"):
    temp = pd.to_numeric(df[temp_col], errors="coerce") if temp_col in df else pd.Series(float("nan"), index=df.index)
    tk = temp.fillna(T_FALLBACK_K - 273.15) + 273.15
    vm = R_LATM * tk
    for col in ppm_cols:
        target = col.replace("_ppm", "_ug_m3")
        if target not in df:
            continue
        values = pd.to_numeric(df[target], errors="coerce")
        pollutant = col[:-4].lower()
        if pollutant in GAS_MW:
            df[target] = values * (GAS_MW[pollutant] * 1000.0) / vm
        else:
            df[target] = values * 1000.0
    return df


def load_station_hourly(path: Path):
    code = path.name.split("_")[0]
    df = pd.read_csv(path)
    ppm_cols = [c for c in df.columns if c.endswith("_ppm")]
    df = df.rename(columns={c: c.replace("_ppm", "_ug_m3") for c in ppm_cols})
    numeric_cols = [c for c in df.columns if c.endswith(NUM_SUFFIX)]
    for c in numeric_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    if ppm_cols:
        df = convert_ppm_columns(df, ppm_cols)
    df["timestamp_start"] = pd.to_datetime(df["timestamp_start"], errors="coerce")
    df = df[df["timestamp_start"].notna()].copy()
    df = df[df["timestamp_start"].dt.year >= 2024].copy()
    df["hour"] = df["timestamp_start"].dt.floor("h")
    agg = {**{c: "mean" for c in numeric_cols}, "qc_flag": "first"}
    df = df.groupby("hour", as_index=False)[numeric_cols + ["qc_flag"]].agg(agg)
    df["allowed_qc"] = df["qc_flag"].isin(["VALID", "SUSPECT"])
    if code in {"JMB-02", "MER-01"}:
        df["allowed_qc"] = df["qc_flag"].eq("VALID")
    if code == "BJB-01" and "pm25_ug_m3" in df:
        stuck = df["pm25_ug_m3"].round(1).isin([336.7, 3.5])
        df.loc[stuck, "allowed_qc"] = False
    for c, (lo, hi) in PHYS.items():
        if c in df:
            bad = (df[c] < lo) | (df[c] > hi)
            df.loc[bad, c] = np.nan
    df["pm25"] = np.where(df["allowed_qc"], df["pm25_ug_m3"], np.nan)
    df["station"] = code
    return df


hour_dow_all = []
hour_dow_by_island = {}
hour_dow_by_station = {}
station_hour = {}
station_hour_day = {}
meteo_corr = []
windrose = {}
try:
    frames = [load_station_hourly(p) for p in sorted(DATASET.glob("*_AQMS.csv"))]
    aq = pd.concat(frames, ignore_index=True)
    hour_dt = pd.to_datetime(aq["hour"])
    aq["dow"] = hour_dt.dt.dayofweek
    aq["date_key"] = hour_dt.dt.strftime("%Y-%m-%d")
    aq["hour"] = hour_dt.dt.hour
    aq["is_weekend"] = aq["dow"] >= 5
    clean = aq.dropna(subset=["pm25"]).copy()
    clean["island"] = clean["station"].map(island_of_station)
    for group_key, group_df, target in [
        ("all", clean, None),
        ("island", clean, clean),
        ("station", clean, clean),
    ]:
        _ = group_key  # retained for clarity; actual aggregation below
    hour_all = clean.groupby(["hour", "dow"]).agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
    hour_dow_all = [
        {"hour": int(r.hour), "dow": int(r.dow), "pm25": round(float(r.pm25), 1), "n": int(r.n)}
        for r in hour_all.itertuples()
    ]
    for isl, g in clean.groupby("island"):
        rows = g.groupby(["hour", "dow"]).agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
        hour_dow_by_island[str(isl)] = [
            {"hour": int(r.hour), "dow": int(r.dow), "pm25": round(float(r.pm25), 1), "n": int(r.n)}
            for r in rows.itertuples()
        ]
    for st, g in clean.groupby("station"):
        rows = g.groupby(["hour", "dow"]).agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
        hour_dow_by_station[str(st)] = [
            {"hour": int(r.hour), "dow": int(r.dow), "pm25": round(float(r.pm25), 1), "n": int(r.n)}
            for r in rows.itertuples()
        ]
        hour_rows = g.groupby("hour").agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
        station_hour[str(st)] = [
            {"hour": int(r.hour), "pm25": round(float(r.pm25), 1), "n": int(r.n)}
            for r in hour_rows.itertuples()
        ]
        day_rows = g.groupby(["hour", "is_weekend"]).agg(pm25=("pm25", "mean"), n=("pm25", "size")).reset_index()
        station_hour_day[str(st)] = [
            {"hour": int(r.hour), "day_type": "libur" if bool(r.is_weekend) else "kerja", "pm25": round(float(r.pm25), 1), "n": int(r.n)}
            for r in day_rows.itertuples()
        ]

    for st, g in aq.groupby("station"):
        sub = g.dropna(subset=["pm25", "temperature_c", "humidity_pct", "wind_speed_ms"])
        meteo_corr.append(
            {
                "station": str(st),
                "island": island_of_station.get(str(st)),
                "temp": round(float(sub["pm25"].corr(sub["temperature_c"])), 3) if len(sub) >= 30 else None,
                "hum": round(float(sub["pm25"].corr(sub["humidity_pct"])), 3) if len(sub) >= 30 else None,
                "wind": round(float(sub["pm25"].corr(sub["wind_speed_ms"])), 3) if len(sub) >= 30 else None,
                "n": int(len(sub)),
            }
        )
        w = g.dropna(subset=["wind_speed_ms", "wind_direction_deg"])
        w = w[(w["wind_direction_deg"] >= 0) & (w["wind_direction_deg"] < 360)]
        cats = pd.cut(
            w["wind_speed_ms"],
            bins=[-0.01, 0.5, 1.5, 3.3, 5.5, np.inf],
            labels=[0, 1, 2, 3, 4],
        ).astype(int)
        dirs = ((w["wind_direction_deg"] // 22.5) % 16).astype(int)
        matrix = [[0 for _ in range(5)] for _ in range(16)]
        for d, c in zip(dirs.to_numpy(), cats.to_numpy()):
            matrix[int(d)][int(c)] += 1
        windrose[str(st)] = {"matrix": matrix, "total": int(len(w)), "n": int(len(w))}
except Exception as exc:  # keep build usable if raw AQMS are unavailable
    print(f"hourly derivatives skipped: {exc}")

# ---------------------------------------------------------------- write
def dump(name: str, obj) -> None:
    path = OUT / name
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{name:20s} {path.stat().st_size/1024:8.1f} KB")


dump(
    "meta.json",
    {
        "generated_at": metrics["generated_at"],
        "metrics_sha256": sha,
        "data_quality": metrics["data_quality"],
        "exceed": metrics["exceed"],
        "status_counts": status_counts,
        "thresholds": {"who15": 15, "pp55": 55, "gt100": 100},
        "periods": {
            "data_start": "1 Jan 2024",
            "data_end": "14 Okt 2026",
            "data_start_iso": "2024-01-01",
            "data_end_iso": "2026-10-14",
        },
        "default_date": "2026-10-14",
        "default_range": "tahun",
    },
)

dump(
    "overview.json",
    {
        "kpis": kpis,
        "island26": island26,
        "top26": top26,
        "monthly": metrics["monthly"],
        "status_counts": status_counts,
        "stats_window": {"all": stats_all, "by_island": stats_by_island, "by_station": stats_by_station},
        "ispu_haze26_pct": ispu_haze26_pct,
        "ispu_year_pct": ispu_year_pct,
        "ispu_station_pct": ispu_station_pct,
        "ispu_month_national": ispu_month_national,
        "ispu_month_island": ispu_month_island,
    },
)

dump(
    "stations.json",
    {"stations": stations, "status_counts": status_counts},
)

dump(
    "time.json",
    {
        "monthly": metrics["monthly"],
        "daily": daily_series,
        "daily_island": daily_island,
        "station_daily": station_daily,
        "station_daily_2026": station_daily_2026,
        "station_monthly": station_monthly,
        "island_monthly": island_monthly,
        "diurnal": metrics["diurnal_index"],
        "diurnal_class": metrics["diurnal_class"],
        "weekday": weekday,
        "weekday_island": weekday_island,
        "episode_monthly_island": episode_monthly_islands,
        "episode_stats": episode_stats,
        "hour_dow_all": hour_dow_all,
        "hour_dow_by_island": hour_dow_by_island,
        "hour_dow_by_station": hour_dow_by_station,
        "station_hour": station_hour,
        "station_hour_day": station_hour_day,
    },
)

dump(
    "sources.json",
    {
        "all": all_rows,
        "only2026": only26_rows,
        "corr": {
            "all": metrics["corr_drivers"],
            "only2026": { **metrics["corr_variants"]["only_2026_ge30"], "n": len(only26_rows) },
        },
        "pollutants": pollutants,
        "meteo": meteo,
        "pollutants_by_island": pollutants_by_island,
        "meteo_by_island": meteo_by_island,
        "pollutant_matrix": pollutant_matrix_payload,
        "meteo_corr": meteo_corr,
        "windrose": windrose,
    },
)

dump(
    "health.json",
    {
        "outcomes": [{"key": k, "label": lab, "short": short} for k, lab, short in OUTCOMES],
        "years": [actual_for(health_raw, y) for y in (2024, 2025, 2026)],
        "by_island": health_by_island,
        "stations": health_stations_all,
        "lag": metrics["lag"],
        "lag_by_island": lag_by_island,
        "monthly": health_monthly,
        "monthly_island": health_monthly_island,
        "window": "1 Jan–14 Okt 2026",
    },
)

dump(
    "hospitals.json",
    {
        "meta": hospitals_payload_meta,
        "hospitals": hospitals_payload,
        "provinces": hospital_provinces,
        "provinces_by_island": hospital_provinces_by_island,
        "outcomes": [{"key": k, "label": lab, "short": short} for k, lab, short in OUTCOMES],
    },
)

dump(
    "network.json",
    {
        "coverage": metrics["coverage"],
        "stations": network_stations,
        "blind_spots": blind,
        "status_counts": status_counts,
        "qc_totals": qc_totals,
        "qc_detail": qc_detail,
        "qc_order": QC_ORDER,
        "valid_pct_by_station": station_valid_pct,
        "completeness": completeness,
        "exclusions": {
            "BJB-01": "4.886 jam @336,7 · 2.443 jam @3,5",
            "MDN-01": "6 gap · 3.632 jam hilang",
            "PLB-01": "11.949 baris 15 menit",
            "SM2-01": "1.039 jam @999 · lower bound",
            "JMB-02": "122 jam lolos · 0 hari layak",
            "MER-01": "4.891 jam lolos · 2 hari layak",
        },
    },
)

dump(
    "method.json",
    {
        "metrics_sha256": sha,
        "generated_at": metrics["generated_at"],
        "data_quality": metrics["data_quality"],
        "exceed": metrics["exceed"],
        "status_counts": status_counts,
        "definitions": [
            ("Tanggal acuan", "Tanggal yang dipilih pada kontrol global. Peta stasiun, profil stasiun, dan tooltip harian menampilkan nilai persis pada tanggal ini."),
            ("Rentang", "Hari = tanggal acuan saja. Bulan = 1 sampai tanggal acuan pada bulan itu. Tahun = 1 Januari sampai tanggal acuan. Semua = 1 Jan 2024 sampai tanggal acuan. Satu aturan ini dipakai di semua halaman."),
            ("Rata-rata nasional", "Rata-rata tertimbang hari-stasiun: setiap hari-stasiun layak memiliki bobot yang sama, dihitung pada rentang terpilih."),
            ("Hari-stasiun layak", "Hari dengan minimal 18 jam data lolos pemeriksaan mutu. Nilai 999 dipertahankan sebagai batas bawah."),
            ("Asosiasi", "Korelasi Pearson pada tingkat stasiun. Bukan klaim kausal."),
            ("Kategori ISPU", "Baik ≤15,5 · Sedang ≤55,4 · Tidak Sehat ≤150,4 · Sangat Tidak Sehat ≤250,4 · Berbahaya >250,4 µg/m³."),
            ("Wind rose", "Frekuensi arah angin 16 sektor × 5 kelas kecepatan dari data jam-jaman yang lolos pemeriksaan mutu."),
            ("Korelasi meteorologi", "Korelasi Pearson jam-jaman PM2.5 dengan suhu, kelembapan, dan kecepatan angin per stasiun."),
            ("Kelengkapan bulanan", "Hari layak dibagi hari kalender bulan per stasiun."),
            ("Lag per stasiun", "Korelasi Pearson anomali PM2.5 harian dengan anomali kunjungan rumah sakit (rata-rata bulanan dikeluarkan) pada lag 0, dengan minimal 30 hari tumpang tindih."),
            ("Pasangan RS–stasiun", "Setiap rumah sakit dipasangkan ke stasiun pada kota/kabupaten dan kecamatan yang sama (27 dari 27 cocok), bukan urutan abjad."),
            ("Kasus per 100 tempat tidur", "Kunjungan respirasi pada rentang terpilih dibagi kapasitas tempat tidur rumah sakit, dikali 100. Beban layanan, bukan insidensi penduduk."),
            ("Kasus rumah sakit", "Kunjungan/rawat inap yang tercatat, bukan kasus yang diatribusikan ke PM2.5. Data 31 Des 2023 dikecualikan karena hanya 5 dari 27 rumah sakit yang melapor."),
        ],
        "qc": [
            ("Pemeriksaan mutu", "Data dipakai bila lolos pemeriksaan rentang fisik dan tidak ditandai rusak. Stasiun dengan rekaman terbatas hanya memakai data yang paling bersih."),
            ("Konversi ppm", "Gas (SO2, CO, O3, NO2): ppm × berat molekul × 1000 / volume molar pada suhu baris (0,082057 × T). Partikulat (PM2.5, PM10): ppm tidak lazim, nilai diperlakukan sebagai mg/m³ (×1000) — asumsi, bukan konversi fisik."),
            ("Stasiun ppm", "BJB-01, MDN-01, PSW-01 melaporkan semua polutan dalam ppm; gas dikonversi per suhu, partikulat memakai asumsi mg/m³."),
            ("PLB-01", "Resolusi 15 menit dirapatkan ke jam (11.949 baris)."),
            ("BJB-01", "Sensor macet: 4.886 jam pada 336,7 dan 2.443 jam pada 3,5; dikeluarkan dari agregat."),
            ("SM2-01", "1.039 jam pada 999; rata-rata 336,0 adalah batas bawah."),
        ],
        "limitations": [
            "Tidak ada dataset eksternal; seluruh angka berasal dari 33 file panitia.",
            "Korelasi dan estimasi kesehatan bersifat asosiatif, bukan kausal.",
            "Peta memakai basemap 38 provinsi; warna provinsi mengikuti rumah sakit mitra, bukan sensus kasus.",
            "Oktober 2026 parsial (1–14 Okt); semua label bulanan memakai penanda parsial.",
        ],
        "pipeline": [
            "Dataset mentah → normalisasi unit → filter tanggal → floor ke jam → QC tier",
            "→ exclude fault → physical range → agregasi harian → ISPU → status → join RS",
            "→ daily_station.csv + metrics.json → preview/data/*.json",
        ],
        "citations": [
            "Gelar Rasa. (2026). Booklet case study: Dashboard Analysis Gelar Rasa 2026. Panitia Gelar Rasa 2026.",
            "Gelar Rasa. (2026). Handbook preliminary round: Dashboard Analysis Gelar Rasa 2026. Panitia Gelar Rasa 2026.",
            "Kementerian Lingkungan Hidup dan Kehutanan. (2020). Peraturan Menteri Lingkungan Hidup dan Kehutanan Nomor P.14/MENLHK/SETJEN/KUM.1/7/2020 tentang Indeks Standar Pencemar Udara.",
            "Kementerian Lingkungan Hidup dan Kehutanan. (2021). Peraturan Menteri Lingkungan Hidup dan Kehutanan Nomor 27 Tahun 2021 tentang Indeks Kualitas Lingkungan Hidup.",
            "Presiden Republik Indonesia. (2021). Peraturan Pemerintah Republik Indonesia Nomor 22 Tahun 2021 tentang Penyelenggaraan Perlindungan dan Pengelolaan Lingkungan Hidup.",
            "World Health Organization. (2021). WHO global air quality guidelines: Particulate matter (PM2.5 and PM10), ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide. World Health Organization.",
        ],
    },
)

# ------------------------------------------------------- daily range exports
# hourly curve per date and scope (national + islands), for the 24-hour cycle
class_of_station = dict(zip(station_table["station"], station_table["site_class"]))
hourly_payload = {"dates": [], "scopes": {}, "classes": [], "class_scopes": {}}
if "clean" in globals():
    cl = clean.dropna(subset=["pm25"]).copy()
    cl["site_class"] = cl["station"].map(class_of_station)
    dates = sorted(cl["date_key"].unique())
    groups = [("Nasional", cl)] + [(str(i), g) for i, g in cl.groupby("island")]
    for name, g in groups:
        mat = g.groupby(["date_key", "hour"])["pm25"].mean().unstack("hour")
        mat = mat.reindex(index=dates, columns=list(range(24)))
        hourly_payload["scopes"][name] = [
            [None if pd.isna(v) else round(float(v), 1) for v in row] for row in mat.to_numpy()
        ]
        per_class = {}
        for cls, gc in g.groupby("site_class"):
            if not isinstance(cls, str):
                continue
            cmat = gc.groupby(["date_key", "hour"])["pm25"].mean().unstack("hour")
            cmat = cmat.reindex(index=dates, columns=list(range(24)))
            per_class[cls] = [
                [None if pd.isna(v) else round(float(v), 1) for v in row] for row in cmat.to_numpy()
            ]
        hourly_payload["class_scopes"][name] = per_class
    hourly_payload["dates"] = dates
    hourly_payload["classes"] = sorted(
        {c for per in hourly_payload["class_scopes"].values() for c in per.keys()}
    )

# Matriks jam per stasiun (kurva 24 jam + mode Hari untuk stasiun terpilih).
# Dipisah dari hourly.json supaya halaman tetap ringan saat dimuat.
hourly_stations_payload = {"dates": [], "stations": {}}
if "clean" in globals():
    _hs = clean.dropna(subset=["pm25"])
    _hs_dates = sorted(_hs["date_key"].unique())
    for _st, _g in _hs.groupby("station"):
        _mat = _g.groupby(["date_key", "hour"])["pm25"].mean().unstack("hour")
        _mat = _mat.reindex(index=_hs_dates, columns=list(range(24)))
        hourly_stations_payload["stations"][str(_st)] = [
            [None if pd.isna(v) else round(float(v), 1) for v in row] for row in _mat.to_numpy()
        ]
    hourly_stations_payload["dates"] = _hs_dates

# daily pollutants + meteorology per station (Tanggal acuan / Rentang)
POLL_KEYS = ["pm10", "so2", "no2", "o3", "co", "temp", "hum", "wind"]
pollutants_payload = {"keys": POLL_KEYS, "stations": {}}
for st, g in usable.sort_values(["station", "date"]).groupby("station"):
    rows = []
    for rec in g[["date"] + POLL_KEYS].itertuples(index=False):
        rows.append(
            [rec[0].strftime("%Y-%m-%d")]
            + [None if pd.isna(v) else round(float(v), 1) for v in rec[1:]]
        )
    pollutants_payload["stations"][str(st)] = rows

# daily hospital visits per hospital (Rentang), 31 Des 2023 excluded
health_daily_payload = {"keys": OUTCOME_KEYS, "hospitals": {}}
for hid, g in _health_known.sort_values(["hospital_id", "date"]).groupby("hospital_id"):
    rows = []
    for rec in g[["date"] + OUTCOME_KEYS].itertuples(index=False):
        rows.append([rec[0].strftime("%Y-%m-%d")] + [int(v) for v in rec[1:]])
    health_daily_payload["hospitals"][str(hid)] = rows

dump("hourly.json", hourly_payload)
dump("hourly_stations.json", hourly_stations_payload)
dump("pollutants.json", pollutants_payload)
dump("health_daily.json", health_daily_payload)

print("done")
