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

# dominant ISPU category in the canonical 2026 haze window
haze = usable[(usable["date"] >= "2026-08-01") & (usable["date"] <= "2026-10-14")].copy()


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
        }
    )

status_counts = {s: int((station_table["status"] == s).sum()) for s in STATUS_ORDER}

# ---------------------------------------------------------------- overview
comp_year = metrics["comp_year"]
comp_by_year = {int(r["year"]): float(r["pm25"]) for r in comp_year}
ratio_2024 = round(comp_by_year[2026] / comp_by_year[2024], 2)
island26 = metrics["island26"]
island_by_name = {r["island"]: r for r in island26}
ratio_kal_jawa = round(island_by_name["Kalimantan"]["mean"] / island_by_name["Jawa"]["mean"], 2)

kpis = [
    {
        "id": "national",
        "value": comp_by_year[2026],
        "unit": "µg/m³",
        "label": "Rata-rata nasional",
        "baseline": f"{ratio_2024:.1f}× 2024".replace(".", ","),
        "note": "1 Sep–14 Okt 2026 · 685 hari-stasiun · 25 stasiun",
        "ratio": ratio_2024,
    },
    {
        "id": "kalimantan",
        "value": island_by_name["Kalimantan"]["mean"],
        "unit": "µg/m³",
        "label": "Kalimantan",
        "baseline": f"{ratio_kal_jawa:.1f}× Jawa".replace(".", ","),
        "note": "1 Agu–14 Okt 2026 · 450 hari-stasiun · 6 stasiun",
        "ratio": ratio_kal_jawa,
    },
    {
        "id": "resp",
        "value": metrics["excess_years"][2]["excess"]["resp"],
        "unit": "kasus",
        "label": "Kelebihan respirasi",
        "baseline": "estimasi asosiatif",
        "note": "1 Agu–14 Okt 2026 · 75 hari",
        "ratio": None,
    },
    {
        "id": "usable",
        "value": metrics["data_quality"]["valid_overall_pct"],
        "unit": "%",
        "label": "Hari-stasiun layak",
        "baseline": f'{metrics["data_quality"]["usable_station_days"]:,}/{metrics["data_quality"]["daily_station_days"]:,}'.replace(",", "."),
        "note": "seluruh periode",
        "ratio": None,
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
for r in top26.itertuples():
    st = station_table[station_table["station"] == r.station].iloc[0]
    only26_rows.append(
        {
            "station": r.station,
            "island": str(r.island),
            "pm25": round(float(r.mean), 1),
            "baseline": float(st["baseline"]),
            "distance": float(st["distance"]),
            "traffic": float(st["traffic"]),
            "days": int(r.days),
            "episode_days": episode_by_station.get(str(r.station), 0),
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


def excess_for(frame: pd.DataFrame, year: int) -> dict:
    nat = frame[frame["year"] == year].groupby("date")[OUTCOME_KEYS].sum().reset_index()
    nat["md"] = nat["date"].dt.strftime("%m-%d")
    base = nat[nat["md"].between("01-01", "06-30")][OUTCOME_KEYS].mean()
    hz = nat[nat["md"].between("08-01", "10-14")]
    actual = hz[OUTCOME_KEYS].sum()
    expected = base * len(hz)
    return {
        "year": year,
        "days": int(len(hz)),
        "actual": {o: int(actual[o]) for o in OUTCOME_KEYS},
        "expected": {o: int(round(expected[o])) for o in OUTCOME_KEYS},
        "excess": {o: int(round(actual[o] - expected[o])) for o in OUTCOME_KEYS},
    }


health_by_island = {}
for isl, g in health_raw.groupby("island"):
    health_by_island[str(isl)] = [excess_for(g, y) for y in (2024, 2025, 2026)]

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
EXCLUDED = {"JMB-02", "MER-01"}
comp = usable[
    ~usable["station"].isin(EXCLUDED)
    & (usable["date"].dt.month.isin([9, 10]))
    & (usable["date"].dt.day <= 14)
    & (usable["date"].dt.year == 2026)
].copy()
stats_all = window_stats(comp)
stats_by_island = {str(isl): window_stats(g) for isl, g in comp.groupby("island")}
stats_by_station = {str(st): window_stats(g) for st, g in comp.groupby("station")}
ispu_haze26_pct = metrics.get("ispu_haze26_pct", {})
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

health_stations_all = []
for r in pd.DataFrame(metrics["excess_station"]).to_dict(orient="records"):
    st = str(r["station"])
    actual_g = actual_by_station.get(st)
    actual_resp = int(actual_g["resp"].sum()) if actual_g is not None and len(actual_g) else None
    actual_under5 = int(actual_g["resp_admissions_under5"].sum()) if actual_g is not None and len(actual_g) else None
    actual_over60 = int(actual_g["resp_admissions_over60"].sum()) if actual_g is not None and len(actual_g) else None
    lag0 = lag_station.get(st, {})
    health_stations_all.append(
        {
            **r,
            "resp_actual": actual_resp,
            "resp_under5_actual": actual_under5,
            "resp_over60_actual": actual_over60,
            "under5_share": round(actual_under5 / actual_resp * 100, 1) if actual_resp else None,
            "over60_share": round(actual_over60 / actual_resp * 100, 1) if actual_resp else None,
            "lag0": lag0,
            "lag0_resp": lag0.get("resp"),
            "episode_days": episode_by_station.get(st, 0),
        }
    )

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


def load_station_hourly(path: Path):
    code = path.name.split("_")[0]
    df = pd.read_csv(path)
    ppm_cols = [c for c in df.columns if c.endswith("_ppm")]
    df = df.rename(columns={c: c.replace("_ppm", "_ug_m3") for c in ppm_cols})
    numeric_cols = [c for c in df.columns if c.endswith(NUM_SUFFIX)]
    for c in numeric_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    if ppm_cols:
        for c in [c for c in df.columns if c.endswith("_ug_m3")]:
            df[c] = df[c] * 1000.0
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
            "window": "1 Sep–14 Okt 2026",
            "haze": "1 Agu–14 Okt 2026",
            "data_end": "14 Okt 2026",
        },
    },
)

dump(
    "overview.json",
    {
        "kpis": kpis,
        "comp_year": comp_year,
        "island26": island26,
        "top26": metrics["top26"],
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
        "years": metrics["excess_years"],
        "by_island": health_by_island,
        "stations": health_stations_all,
        "lag": metrics["lag"],
        "lag_by_island": lag_by_island,
        "monthly": health_monthly,
        "monthly_island": health_monthly_island,
        "window": "1 Agu–14 Okt 2026",
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
            "JMB-02": "122 jam VALID · 0 hari layak",
            "MER-01": "4.891 jam VALID · 2 hari layak",
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
            ("Rata-rata nasional", "Rata-rata tertimbang hari-stasiun: setiap hari-stasiun layak memiliki bobot yang sama."),
            ("Hari-stasiun layak", "Hari dengan minimal 18 jam VALID setelah QC. Nilai 999 dipertahankan sebagai lower bound."),
            ("Kelebihan kasus", "Aktual − expected. Expected = rata-rata harian Jan–Jun tahun yang sama × jumlah hari jendela."),
            ("Asosiasi", "Korelasi Pearson pada tingkat stasiun. Bukan klaim kausal."),
            ("Kategori ISPU", "Baik ≤15,5 · Sedang ≤55,4 · Tidak Sehat ≤150,4 · Sangat Tidak Sehat ≤250,4 · Berbahaya >250,4 µg/m³."),
            ("Jendela sebanding", "Dalam metrics.json, jendela sebanding memakai 1–14 Sep + 1–14 Okt (28 hari) untuk 129,8 µg/m³ tahun 2026."),
            ("Wind rose", "Frekuensi arah angin 16 sektor × 5 kelas kecepatan dari hourly yang lolos QC."),
            ("Korelasi meteorologi", "Korelasi Pearson jam-jaman PM2.5 dengan suhu, kelembapan, dan kecepatan angin per stasiun."),
            ("Kelengkapan bulanan", "Hari layak dibagi hari kalender bulan per stasiun."),
            ("Lag per stasiun", "Korelasi Pearson anomali PM2.5 harian dengan anomali kunjungan rumah sakit (rata-rata bulanan dikeluarkan) pada lag 0, dengan minimal 30 hari tumpang tindih."),
        ],
        "qc": [
            ("Tier QC", "VALID + SUSPECT yang lolos physical range. JMB-02/MER-01 hanya VALID."),
            ("Unit", "Kolom ppm dikonversi ke µg/m³; PLB-01 di-floor ke jam."),
            ("BJB-01", "Sensor stuck: 4.886 jam pada 336,7 dan 2.443 jam pada 3,5; dikeluarkan dari agregat."),
            ("SM2-01", "1.039 jam pada 999; mean 336,0 adalah lower bound."),
        ],
        "limitations": [
            "Tidak ada dataset eksternal; seluruh angka berasal dari 33 file panitia.",
            "Korelasi dan estimasi kesehatan bersifat asosiatif, bukan kausal.",
            "Peta skematik tanpa basemap; posisi titik adalah koordinat stasiun.",
            "Oktober 2026 parsial (1–14 Okt); semua label bulanan memakai penanda parsial.",
        ],
        "pipeline": [
            "Dataset mentah → normalisasi unit → filter tanggal → floor ke jam → QC tier",
            "→ exclude fault → physical range → agregasi harian → ISPU → status → join RS",
            "→ daily_station.csv + metrics.json → preview/data/*.json",
        ],
        "citations": [
            "WHO. (2021). WHO global air quality guidelines: particulate matter (PM2.5 and PM10), ozone, nitrogen dioxide, sulfur dioxide and carbon monoxide.",
            "KLHK. (2020). Peraturan Menteri Lingkungan Hidup dan Kehutanan No. 14 Tahun 2020 tentang Indeks Standar Pencemar Udara.",
            "Gelar Rasa 2026. (2026). Booklet Case Study dan Handbook Preliminary Round.",
        ],
    },
)

print("done")
