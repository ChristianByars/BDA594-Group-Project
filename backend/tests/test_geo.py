"""Point-in-polygon matching and date-aware SF district maps, using made-up squares."""

import json

import numpy as np
import pandas as pd
import shapely

from crime_pipeline import geo
from crime_pipeline.config import Paths


def square(x0, y0, size=1.0):
    return shapely.box(x0, y0, x0 + size, y0 + size)


def write_map(path, districts):
    """districts: {name: polygon}"""
    features = [{"type": "Feature", "properties": {"district": name},
                 "geometry": shapely.geometry.mapping(polygon)} for name, polygon in districts.items()]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


def test_locate_matches_points_and_leaves_misses_empty():
    polygons = np.array([square(0, 0), square(1, 0)])
    names = np.array(["West", "East"], dtype=object)
    lat = pd.Series(["0.5", "0.5", "5", None])
    lon = pd.Series(["0.5", "1.5", "5", "0.5"])
    assert geo.locate(lat, lon, polygons, names).tolist() == ["West", "East", pd.NA, pd.NA]


def test_sf_district_uses_map_in_effect_on_occurred_date(tmp_path):
    folder = tmp_path / "boundaries" / "sf"
    folder.mkdir(parents=True)
    # The same point is in OLD before the redraw and NEW after it.
    write_map(folder / "sfpd_districts_2015_2026.geojson", {"OLD": square(0, 0)})
    write_map(folder / "sfpd_districts_current.geojson", {"NEW": square(0, 0)})
    df = pd.DataFrame({"occurred_date": ["2026-09-30", "2026-10-01"],
                       "latitude": ["0.5", "0.5"], "longitude": ["0.5", "0.5"]})
    assert geo.sf_police_district(df, Paths(tmp_path)).tolist() == ["Old", "New"]
