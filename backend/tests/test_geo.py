"""Point-in-polygon matching, date-aware SF district maps and LAPD division dissolving, using made-up squares."""

import json
from urllib.parse import parse_qs, urlparse

import numpy as np
import pandas as pd
import pytest
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


def district(prec, polygon):
    return {"type": "Feature", "properties": {"PREC": prec}, "geometry": shapely.geometry.mapping(polygon)}


AREAS = pd.DataFrame({"area_number": ["2", "1"], "area_name": ["Rampart", "Central"],
                      "area_full_name": ["Rampart", "Central"], "bureau": ["Central", "Central"]})


def test_dissolve_merges_reporting_districts_by_area_number():
    features = [district(1, square(0, 0)), district("1", square(1, 0)), district(2, square(0, 1))]
    divisions = geo.dissolve_lapd_divisions(features, AREAS)["features"]
    assert [d["properties"] for d in divisions] == [
        {"area_number": 1, "area_name": "Central", "area_full_name": "Central", "bureau": "Central"},
        {"area_number": 2, "area_name": "Rampart", "area_full_name": "Rampart", "bureau": "Central"},
    ]
    central = shapely.geometry.shape(divisions[0]["geometry"])
    assert central.geom_type == "Polygon"
    assert central.equals(shapely.box(0, 0, 2, 1))


def test_dissolve_fails_when_an_area_has_no_reporting_district():
    with pytest.raises(ValueError, match=r"areas without districts \[2\], unknown area numbers \[3\]"):
        geo.dissolve_lapd_divisions([district(1, square(0, 0)), district(3, square(1, 0))], AREAS)


def test_fetch_arcgis_features_pages_through_object_ids(monkeypatch):
    requested_pages = []

    def fake_download(url, context):
        params = parse_qs(urlparse(url).query)
        if "returnIdsOnly" in params:
            return {"objectIds": [5, 1, 3, 2, 4]}
        ids = params["objectIds"][0].split(",")
        requested_pages.append(ids)
        return {"features": [district(1, square(0, 0)) for _ in ids]}

    monkeypatch.setattr(geo, "download_json", fake_download)
    monkeypatch.setattr(geo, "ARCGIS_PAGE_SIZE", 2)
    features = geo.fetch_arcgis_features("https://example.test/MapServer/3", "PREC", context=None)
    assert requested_pages == [["1", "2"], ["3", "4"], ["5"]]
    assert len(features) == 5
