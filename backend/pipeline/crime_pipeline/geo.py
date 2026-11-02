"""SF police district and ZIP from coordinates, and LAPD division polygons, from boundary files in the data folder.

Boundary files live in <data folder>/boundaries/ and are downloaded once with
`crime-pipeline fetch-boundaries`:

    sf/sfpd_districts_2015_2026.geojson  SFPD districts in effect until 2026-09-30 (DataSF bj3n-hmgf)
    sf/sfpd_districts_current.geojson    SFPD districts in effect from 2026-10-01 (DataSF d4vc-q76h)
    sf/sf_zcta_2020.geojson              2020 Census ZIP Code Tabulation Areas around SF (Census TIGERweb)
    la/lapd_divisions.geojson            LAPD's 21 areas, merged from the reporting districts in the
                                         City of Los Angeles LAPD map service (LAPD_DIVISIONS_LAYER)

SFPD redrew its district boundaries on 2026-10-01, so each crime is matched
against the district map in effect on its occurred_date. LA crimes have no
coordinates, so the LAPD division polygons are only used by `export` for the map.
"""

import json
import ssl
import urllib.parse
import urllib.request

import certifi
import numpy as np
import pandas as pd
import shapely

from crime_pipeline import lookups

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

# LAPD reporting districts (about 1,135), each with its area number (1-21) in PREC.
LAPD_DIVISIONS_LAYER = "https://maps.lacity.org/lahub/rest/services/LAPD/MapServer/3"
LAPD_DIVISIONS_FILE = "lapd_divisions.geojson"
# The service returns at most about 1,000 features per query.
ARCGIS_PAGE_SIZE = 200


def sf_boundary_dir(paths):
    return paths.boundaries_dir / "sf"


def la_boundary_dir(paths):
    return paths.boundaries_dir / "la"


def download_json(url, context):
    """Parsed JSON from url. Raises RuntimeError when an ArcGIS service answers with an error object."""
    with urllib.request.urlopen(url, timeout=120, context=context) as response:
        data = json.load(response)
    if "error" in data:
        raise RuntimeError(f"{url} returned an error: {data['error']}")
    return data


def fetch_arcgis_features(layer_url, out_fields, context):
    """Every feature of an ArcGIS map service layer as GeoJSON features in longitude/latitude.

    Asks for all object IDs first, then fetches the features ARCGIS_PAGE_SIZE IDs at a time.
    """
    ids_query = urllib.parse.urlencode({"where": "1=1", "returnIdsOnly": "true", "f": "json"})
    object_ids = sorted(download_json(f"{layer_url}/query?{ids_query}", context)["objectIds"] or [])
    features = []
    for start in range(0, len(object_ids), ARCGIS_PAGE_SIZE):
        page = object_ids[start:start + ARCGIS_PAGE_SIZE]
        page_query = urllib.parse.urlencode({
            "objectIds": ",".join(map(str, page)), "outFields": out_fields, "outSR": 4326, "f": "geojson",
        })
        features += download_json(f"{layer_url}/query?{page_query}", context)["features"]
    return features


def dissolve_lapd_divisions(features, areas):
    """One polygon per LAPD area, merged from reporting-district features.

    features: GeoJSON features with the area number in properties.PREC
    areas: the lapd_areas lookup table; names and bureaus come from it, not from the service
    Returns a FeatureCollection in area-number order with properties area_number, area_name,
    area_full_name and bureau. Raises ValueError if an area in the table has no reporting
    district, or a reporting district's area number isn't in the table.
    """
    shapes_by_area = {}
    for feature in features:
        number = int(feature["properties"]["PREC"])
        shapes_by_area.setdefault(number, []).append(shapely.geometry.shape(feature["geometry"]))

    known = {int(number) for number in areas["area_number"]}
    missing = sorted(known - set(shapes_by_area))
    unknown = sorted(set(shapes_by_area) - known)
    if missing or unknown:
        raise ValueError(f"LAPD reporting districts don't match lapd_areas.csv: "
                         f"areas without districts {missing}, unknown area numbers {unknown}")

    divisions = []
    for area in areas.itertuples(index=False):
        number = int(area.area_number)
        properties = {"area_number": number, "area_name": area.area_name,
                      "area_full_name": area.area_full_name, "bureau": area.bureau}
        polygon = shapely.unary_union(shapes_by_area[number])
        divisions.append({"type": "Feature", "properties": properties, "geometry": shapely.geometry.mapping(polygon)})
    divisions.sort(key=lambda division: division["properties"]["area_number"])
    return {"type": "FeatureCollection", "features": divisions}


def fetch_boundaries(paths):
    """Download the SF boundary files and the LAPD division polygons into the data folder."""
    # certifi's certificates: uv-installed Pythons on macOS don't see the system ones.
    context = ssl.create_default_context(cafile=certifi.where())

    folder = sf_boundary_dir(paths)
    folder.mkdir(parents=True, exist_ok=True)
    for name, url in BOUNDARY_SOURCES.items():
        data = download_json(url, context)
        if not data.get("features"):
            raise RuntimeError(f"{name}: download returned no features ({url})")
        (folder / name).write_text(json.dumps(data))
        print(f"Saved {len(data['features']):>3} areas to {folder.relative_to(paths.data_dir)}/{name}")

    districts = fetch_arcgis_features(LAPD_DIVISIONS_LAYER, "PREC", context)
    divisions = dissolve_lapd_divisions(districts, lookups.read("lapd_areas"))
    folder = la_boundary_dir(paths)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / LAPD_DIVISIONS_FILE).write_text(json.dumps(divisions))
    print(f"Saved {len(divisions['features']):>3} areas, merged from {len(districts):,} reporting districts, "
          f"to {folder.relative_to(paths.data_dir)}/{LAPD_DIVISIONS_FILE}")


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
