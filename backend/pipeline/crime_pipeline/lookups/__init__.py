"""Reference tables shipped with the pipeline. Each is a plain CSV in this folder.

    crime_categories.csv  the shared categories and their broad group (Violent, Property, ...)
    nibrs_offenses.csv    every NIBRS code: description, FBI category, flags, shared category
    sf_category_map.csv   SFPD category (+ subcategory) -> shared category; '*' = any subcategory
    la_local_codes.csv    old LAPD crime codes (pre-NIBRS rows) -> shared category
    lapd_areas.csv        LAPD area number, bureau and center point (mean of 2020-2024 crime
                          locations from LAPD "Crime Data from 2020 to Present"; bureaus from
                          lapdonline.org)

Edit the CSVs to change a mapping, then rerun `crime-pipeline all`.
"""

from functools import cache
from pathlib import Path

import pandas as pd

from crime_pipeline.common import READ_AS_TEXT

LOOKUP_DIR = Path(__file__).parent


@cache
def read(name):
    return pd.read_csv(LOOKUP_DIR / f"{name}.csv", **READ_AS_TEXT)
