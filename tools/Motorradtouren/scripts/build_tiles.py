#!/usr/bin/env python3
"""
Reads every GPX file in data/gpx/, and for each one:
  - computes distance + elevation gain
  - writes a lightweight point array to data/geo/<name>.json (used by the
    page to draw the track; the original .gpx stays untouched and is what
    the "GPX" download button on the page links to)
  - downloads any OSM tiles the track needs (3 zoom levels: a per-tour
    overview, and fixed village/street-name levels) into the *global*
    tile pool at ../tiles/{z}/{x}/{y}.png, skipping tiles already there

Then merges computed stats with manual overrides from data/tours_meta.json
and writes data/tours.json, which the frontend reads.

Run this again any time you add a new GPX file - already-downloaded tiles
and already-processed tours are left alone, only what's missing gets added.

OSM tile usage policy: this hits tile.openstreetmap.org directly, which is
fine for occasional personal use (adding a tour every now and then) but is
not meant for bulk scraping. Sets a descriptive User-Agent and a small
delay between requests, as the policy asks. See:
https://operations.osmfoundation.org/policies/tiles/
"""

import json
import math
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
GPX_DIR = BASE / "data" / "gpx"
GEO_DIR = BASE / "data" / "geo"
TILES_DIR = BASE / "tiles"
TOURS_META_PATH = BASE / "data" / "tours_meta.json"
TOURS_JSON_PATH = BASE / "data" / "tours.json"

TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
USER_AGENT = "jens-krause.github.io motorcycle-tours tile fetcher (personal, low-volume use)"
REQUEST_DELAY_S = 0.2

FIXED_ZOOMS = [12, 14]   # village names, main-road names
OVERVIEW_MIN_ZOOM = 6
OVERVIEW_MAX_ZOOM = 11
CORRIDOR_BUFFER_TILES = {12: 1, 14: 2}  # extra tile ring around the track at each fixed zoom

MAX_GEO_POINTS = 2000  # decimate long tracks for the client-side draw layer


def deg2num(lat, lon, zoom):
    lat_rad = math.radians(lat)
    n = 2 ** zoom
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def parse_gpx(path):
    tree = ET.parse(path)
    root = tree.getroot()
    points = []
    # Element.iter(tag) only does a plain string match, so "{*}trkpt" never
    # matches a real namespaced tag like "{http://...}trkpt" - the "{*}"
    # wildcard only works with the path syntax find()/findall() use.
    for trkpt in root.findall(".//{*}trkpt"):
        lat = float(trkpt.get("lat"))
        lon = float(trkpt.get("lon"))
        ele_el = trkpt.find("{*}ele")
        ele = float(ele_el.text) if ele_el is not None and ele_el.text else None
        points.append((lat, lon, ele))
    return points


def compute_stats(points):
    distance_km = 0.0
    elevation_gain_m = 0.0
    for (lat1, lon1, ele1), (lat2, lon2, ele2) in zip(points, points[1:]):
        distance_km += haversine_km(lat1, lon1, lat2, lon2)
        if ele1 is not None and ele2 is not None:
            delta = ele2 - ele1
            if delta > 1.0:  # ignore small deltas: GPS altitude noise, not real gain
                elevation_gain_m += delta
    return round(distance_km, 1), round(elevation_gain_m)


def bounding_box(points):
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    return min(lats), min(lons), max(lats), max(lons)


def overview_zoom(min_lat, min_lon, max_lat, max_lon, map_px=600):
    # map_px=600 is a conservative stand-in for the real .tour-map-wrap:
    # on most viewports its height (not its ~700-750px width) is the
    # tighter fit constraint for fitBounds, and this formula only checks
    # one dimension. floor() (not round()) on top of that so the result
    # always errs toward more zoomed out - a diagonal that just barely
    # rounds up to a tighter zoom would leave the track cramped right at
    # the container edge instead of comfortably inside it.
    diagonal_km = haversine_km(min_lat, min_lon, max_lat, max_lon)
    diagonal_km = max(diagonal_km, 1.0)
    meters_per_px_needed = (diagonal_km * 1000) / map_px
    z = math.log2(156543.03392 / meters_per_px_needed)
    return max(OVERVIEW_MIN_ZOOM, min(OVERVIEW_MAX_ZOOM, math.floor(z)))


def decimate(points, max_points):
    if len(points) <= max_points:
        return points
    step = math.ceil(len(points) / max_points)
    return points[::step]


def tiles_for_bbox(min_lat, min_lon, max_lat, max_lon, zoom, margin=0):
    x0, y0 = deg2num(max_lat, min_lon, zoom)  # top-left
    x1, y1 = deg2num(min_lat, max_lon, zoom)  # bottom-right
    x_lo, x_hi = min(x0, x1) - margin, max(x0, x1) + margin
    y_lo, y_hi = min(y0, y1) - margin, max(y0, y1) + margin
    n = 2 ** zoom
    return {
        (zoom, x % n, y % n)
        for x in range(x_lo, x_hi + 1)
        for y in range(y_lo, y_hi + 1)
    }


def tiles_along_track(points, zoom, margin):
    tiles = set()
    n = 2 ** zoom
    for lat, lon, _ in points:
        cx, cy = deg2num(lat, lon, zoom)
        for dx in range(-margin, margin + 1):
            for dy in range(-margin, margin + 1):
                tiles.add((zoom, (cx + dx) % n, (cy + dy) % n))
    return tiles


def download_tile(z, x, y, opener, retries=3):
    dest = TILES_DIR / str(z) / str(x) / f"{y}.png"
    if dest.exists():
        return False  # already in the pool, nothing to do
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = TILE_URL.format(z=z, x=x, y=y)
    last_exc = None
    for attempt in range(retries):
        try:
            with opener.open(url, timeout=15) as resp:
                dest.write_bytes(resp.read())
            time.sleep(REQUEST_DELAY_S)
            return True
        except Exception as exc:
            last_exc = exc
            time.sleep(0.5 * (attempt + 1))  # brief backoff before retrying
    print(f"  ! failed {url} after {retries} attempts: {last_exc}")
    return False


def slugify(name):
    return re.sub(r"[^a-z0-9\-]+", "-", name.lower()).strip("-")


def humanize(stem):
    return stem.replace("-", " ").replace("_", " ").strip().title()


def main():
    GEO_DIR.mkdir(parents=True, exist_ok=True)
    TILES_DIR.mkdir(parents=True, exist_ok=True)

    meta = {}
    if TOURS_META_PATH.exists():
        raw_meta = json.loads(TOURS_META_PATH.read_text())
        meta = {k: v for k, v in raw_meta.items() if not k.startswith("_")}

    gpx_files = sorted(GPX_DIR.glob("*.gpx"))
    if not gpx_files:
        print(f"No .gpx files found in {GPX_DIR} - nothing to do.")
        TOURS_JSON_PATH.write_text(json.dumps({"tours": []}, indent=2, ensure_ascii=False))
        return

    opener = urllib.request.build_opener()
    opener.addheaders = [("User-Agent", USER_AGENT)]

    tours = []
    downloaded_total = 0
    skipped_total = 0

    for gpx_path in gpx_files:
        stem = gpx_path.stem
        print(f"\n=== {gpx_path.name} ===")
        points = parse_gpx(gpx_path)
        if not points:
            print("  no track points found, skipping")
            continue

        distance_km, elevation_gain_m = compute_stats(points)
        min_lat, min_lon, max_lat, max_lon = bounding_box(points)
        ov_zoom = overview_zoom(min_lat, min_lon, max_lat, max_lon)
        print(f"  distance: {distance_km} km, elevation gain: {elevation_gain_m} m")
        print(f"  overview zoom: {ov_zoom}")

        needed = set()
        needed |= tiles_for_bbox(min_lat, min_lon, max_lat, max_lon, ov_zoom, margin=1)
        for z in FIXED_ZOOMS:
            needed |= tiles_along_track(points, z, CORRIDOR_BUFFER_TILES.get(z, 1))

        for (z, x, y) in sorted(needed):
            if download_tile(z, x, y, opener):
                downloaded_total += 1
            else:
                skipped_total += 1
        print(f"  tiles needed: {len(needed)}")

        geo_points = decimate(points, MAX_GEO_POINTS)
        geo_out = [[round(lat, 6), round(lon, 6)] for lat, lon, _ in geo_points]
        geo_filename = f"{slugify(stem)}.json"
        (GEO_DIR / geo_filename).write_text(json.dumps(geo_out, ensure_ascii=False))

        overrides = meta.get(gpx_path.name, {})
        tours.append({
            "id": slugify(stem),
            "title": overrides.get("title", humanize(stem)),
            "stars": overrides.get("stars", 0),
            "distance_km": distance_km,
            "elevation_gain_m": elevation_gain_m,
            "gpx": f"data/gpx/{gpx_path.name}",
            "geo": f"data/geo/{geo_filename}",
            "bounds": [[min_lat, min_lon], [max_lat, max_lon]],
            # The only 3 zoom levels tiles were actually downloaded for -
            # the frontend must never let the map drift to anything else,
            # or it hits zoom levels with no tiles in the pool.
            "zoom_levels": sorted(set([ov_zoom] + FIXED_ZOOMS)),
        })

    TOURS_JSON_PATH.write_text(json.dumps({"tours": tours}, indent=2, ensure_ascii=False))

    print(f"\nDone. {len(tours)} tour(s) processed.")
    print(f"Tiles downloaded this run: {downloaded_total}, already in pool: {skipped_total}")
    pool_size_mb = sum(f.stat().st_size for f in TILES_DIR.rglob("*.png")) / (1024 * 1024)
    print(f"Total tile pool size: {pool_size_mb:.1f} MB")


if __name__ == "__main__":
    main()
