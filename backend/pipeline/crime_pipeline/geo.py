"""SF police district and ZIP from coordinates, using boundary files in the data folder.

Boundary files live in <data folder>/boundaries/sf/ and are downloaded once with
`crime-pipeline fetch-boundaries`:

    sfpd_districts_2015_2026.geojson  SFPD districts in effect until 2026-09-30 (DataSF bj3n-hmgf)
    sfpd_districts_current.geojson    SFPD districts in effect from 2026-10-01 (DataSF d4vc-q76h)
    sf_zcta_2020.geojson              2020 Census ZIP Code Tabulation Areas around SF (Census TIGERweb)

SFPD redrew its district boundaries on 2026-10-01, so each crime is matched
against the district map in effect on its occurred_date.
"""

import json
import ssl
import urllib.parse
import urllib.request

import certifi
import numpy as np
import pandas as pd
import shapely

# The date SFPD's redrawn district boundaries took effect.
SF_DISTRICTS_REDRAWN = "2026-10-01"

SF_DISTRICT_MAPS = [
    # (file, first date in effect, last date in effect)
    ("sfpd_districts_2015_2026.geojson", None, "2026-09-30"),
    ("sfpd_districts_current.geojson", SF_DISTRICTS_REDRAWN, None),
]
SF_ZCTA_FILE = "sf_zcta_2020.geojson"

TIGERWEB_ZCTA_QUERY = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/7/query?"
    + urllib.parse.urlencode({
        "geometry": "-122.52,37.70,-122.35,37.84",  # bounding box around San Francisco
        "geometryType": "esriGeometryEnvelope", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "ZCTA5", "outSR": 4326, "f": "geojson",
    })
)

BOUNDARY_SOURCES = {
    "sfpd_districts_2015_2026.geojson": "https://data.sf.gov/resource/bj3n-hmgf.geojson",
    "sfpd_districts_current.geojson": "https://data.sf.gov/resource/d4vc-q76h.geojson",
    SF_ZCTA_FILE: TIGERWEB_ZCTA_QUERY,
}


def sf_boundary_dir(paths):
    return paths.boundaries_dir / "sf"


def fetch_boundaries(paths):
    """Download the SF boundary files into the data folder."""
    folder = sf_boundary_dir(paths)
    folder.mkdir(parents=True, exist_ok=True)
    # certifi's certificates: uv-installed Pythons on macOS don't see the system ones.
    context = ssl.create_default_context(cafile=certifi.where())
    for name, url in BOUNDARY_SOURCES.items():
        with urllib.request.urlopen(url, timeout=120, context=context) as response:
            data = json.load(response)
        if not data.get("features"):
            raise RuntimeError(f"{name}: download returned no features ({url})")
        (folder / name).write_text(json.dumps(data))
        print(f"Saved {len(data['features']):>3} areas to {folder.relative_to(paths.data_dir)}/{name}")


def read_areas(path, name_field):
    """(polygons, names) from a GeoJSON file."""
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing. Run `crime-pipeline fetch-boundaries` first.")
    features = json.loads(path.read_text())["features"]
    polygons = np.array([shapely.geometry.shape(f["geometry"]) for f in features])
    names = np.array([f["properties"][name_field] for f in features], dtype=object)
    return polygons, names


def locate(latitude, longitude, polygons, names):
    """Name of the polygon containing each point; missing where outside all polygons or no coordinates."""
    lat = pd.to_numeric(latitude, errors="coerce")
    lon = pd.to_numeric(longitude, errors="coerce")
    result = pd.Series(pd.NA, index=latitude.index, dtype="string")
    has_point = lat.notna() & lon.notna()
    if not has_point.any():
        return result

    points = shapely.points(lon[has_point].to_numpy(), lat[has_point].to_numpy())
    point_idx, polygon_idx = shapely.STRtree(polygons).query(points, predicate="within")
    # A point on a shared border can fall in two polygons; keep the first match.
    first = pd.Series(polygon_idx, index=point_idx).groupby(level=0).first()
    matched = pd.Series(names[first.to_numpy()], index=has_point[has_point].index[first.index])
    result.loc[matched.index] = matched.astype("string")
    return result


def sf_police_district(df, paths):
    """SFPD district for each row, from the district map in effect on its occurred_date."""
    district = pd.Series(pd.NA, index=df.index, dtype="string")
    for name, start, end in SF_DISTRICT_MAPS:
        in_effect = pd.Series(True, index=df.index)
        if start:
            in_effect &= df["occurred_date"] >= start
        if end:
            in_effect &= df["occurred_date"] <= end
        if in_effect.any():
            polygons, names = read_areas(sf_boundary_dir(paths) / name, "district")
            district[in_effect] = locate(df.loc[in_effect, "latitude"], df.loc[in_effect, "longitude"], polygons, names)
    return district.str.title()


def sf_zip(df, paths):
    polygons, names = read_areas(sf_boundary_dir(paths) / SF_ZCTA_FILE, "ZCTA5")
    return locate(df["latitude"], df["longitude"], polygons, names)
