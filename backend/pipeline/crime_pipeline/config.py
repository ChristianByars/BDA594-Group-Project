"""Where the pipeline reads and writes data.

The data folder defaults to backend/data/. Point it somewhere else with the
CRIME_DATA_DIR environment variable or the CLI's --data-dir option. Layout:

    raw/la/LAPD_NIBRS_Victims_Dataset.csv
    raw/sd/pd_nibrs_<year>_datasd.csv               (one per year)
    raw/sf/Police_Department_Incident_Reports*.csv  (newest file is used)
    boundaries/sf/*.geojson                          (from `fetch-boundaries`)
    boundaries/la/lapd_divisions.geojson             (LAPD area polygons, from `fetch-boundaries`)
    boundaries/ca/ca_zip_codes.geojson               (statewide ZIP polygons, in git)
    census/ca_socioeconomic_2018_present.csv         (ZIP socioeconomic data, in git)
    cleaned/                                         (written by `clean`)
    standardized/                                    (written by `standardize`)
    crime.db                                         (written by `load`)

`export` writes the website's data bundle to frontend/data/ (Paths.export_dir),
which stays in the repo whatever the data folder is.
"""

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_DATA_DIR = BACKEND_DIR / "data"
DEFAULT_EXPORT_DIR = BACKEND_DIR.parent / "frontend" / "data"


@dataclass(frozen=True)
class Paths:
    data_dir: Path
    export_dir: Path = DEFAULT_EXPORT_DIR

    @property
    def raw_dir(self):
        return self.data_dir / "raw"

    @property
    def boundaries_dir(self):
        return self.data_dir / "boundaries"

    @property
    def ca_zip_boundaries(self):
        return self.boundaries_dir / "ca" / "ca_zip_codes.geojson"

    @property
    def census_dir(self):
        return self.data_dir / "census"

    @property
    def cleaned_dir(self):
        return self.data_dir / "cleaned"

    @property
    def standardized_dir(self):
        return self.data_dir / "standardized"

    @property
    def database(self):
        return self.data_dir / "crime.db"

    @property
    def la_raw(self):
        return self.raw_dir / "la" / "LAPD_NIBRS_Victims_Dataset.csv"

    @property
    def sd_yearly(self):
        return sorted((self.raw_dir / "sd").glob("pd_nibrs_[0-9][0-9][0-9][0-9]_datasd.csv"))

    @property
    def sf_raw(self):
        """The newest SF export (file names end in the download date)."""
        exports = sorted((self.raw_dir / "sf").glob("Police_Department_Incident_Reports*.csv"))
        if not exports:
            raise FileNotFoundError(f"No SF export found in {self.raw_dir / 'sf'}")
        return exports[-1]

    def cleaned(self, name):
        return self.cleaned_dir / name

    def standardized(self, name):
        return self.standardized_dir / name


def get_paths(data_dir=None):
    chosen = data_dir or os.environ.get("CRIME_DATA_DIR") or DEFAULT_DATA_DIR
    return Paths(Path(chosen).expanduser().resolve())
