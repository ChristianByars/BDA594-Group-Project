"""Load StandardizedData/*.csv into a fresh SQLite database (crime.db).

The database is built in a temporary file and swapped in at the end, so an app
reading crime.db never sees a half-built database.
"""

import os
import sqlite3
from datetime import datetime, timezone
from importlib.resources import files

import pandas as pd

from crime_pipeline import __version__, geo, lookups
from crime_pipeline.common import (
    BOOL_COLUMNS, COLUMNS, LA_VICTIM_COLUMNS, LA_VICTIMS_FILE, OUTPUT_FILES, READ_AS_TEXT,
)

# First date all three cities report at full volume. LAPD switched to NIBRS in
# March 2024 and its monthly volume only reaches its steady level in January 2025.
SHARED_WINDOW_START = "2025-01-01"

CHUNK_ROWS = 200_000

INDEXES = [
    "CREATE UNIQUE INDEX offenses_source_row ON offenses (city, source_row_id)",
    "CREATE INDEX offenses_city_date ON offenses (city, occurred_date)",
    "CREATE INDEX offenses_date ON offenses (occurred_date)",
    "CREATE INDEX offenses_case ON offenses (city, case_id)",
    "CREATE INDEX offenses_nibrs ON offenses (nibrs_code)",
    "CREATE INDEX offenses_category ON offenses (city, crime_category, occurred_date)",
    "CREATE INDEX offenses_division ON offenses (city, police_division, occurred_date)",
    "CREATE INDEX la_victims_case ON la_victims (case_id)",
]

# Lookup CSVs copied into the database: table -> columns, in schema order.
LOOKUP_TABLES = {
    "crime_categories": ["crime_category", "crime_group", "sort_order", "description"],
    "nibrs_offenses": ["nibrs_code", "nibrs_description", "nibrs_category", "nibrs_group",
                       "crime_against", "is_violent", "is_property", "crime_category"],
    "lapd_areas": ["area_number", "area_name", "area_full_name", "bureau", "center_latitude", "center_longitude"],
}

# Pre-computed counts for dashboard charts. crime_group / crime_category are the
# shared scheme; offense_category is each city's own grouping (NIBRS category for
# LA/SD, SFPD category for SF). case_count counts distinct cases within each row's group.
BUILD_DAILY_COUNTS = """
CREATE TABLE daily_counts AS
SELECT city,
       occurred_date,
       police_division,
       crime_group,
       crime_category,
       COALESCE(nibrs_category, source_offense_category, 'Unclassified') AS offense_category,
       is_crime,
       possible_duplicate,
       COUNT(*)                AS offense_count,
       COUNT(DISTINCT case_id) AS case_count
FROM offenses
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
"""

VIEWS = [
    # Rows that are comparable across all three cities.
    """
    CREATE VIEW comparable_offenses AS
    SELECT * FROM offenses
    WHERE occurred_date >= (SELECT value FROM metadata WHERE key = 'shared_window_start')
      AND is_crime = 1
      AND possible_duplicate = 0
    """,
]


def read_rows(csv_path, columns):
    """Yield chunks of rows from a standardized CSV, converted for SQLite."""
    for chunk in pd.read_csv(csv_path, chunksize=CHUNK_ROWS, **READ_AS_TEXT):
        if list(chunk.columns) != columns:
            raise ValueError(f"{csv_path.name} columns don't match the expected layout")
        for col in chunk.columns:
            if col in BOOL_COLUMNS or col == "victim_shot":
                chunk[col] = chunk[col].map({"True": 1, "False": 0})
        # NaN -> None so SQLite stores NULL; numeric text is converted by column type.
        yield chunk.astype(object).where(chunk.notna(), None).itertuples(index=False, name=None)


def insert_csv(db, table, csv_path, columns):
    placeholders = ", ".join("?" * len(columns))
    sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})"
    total = 0
    for rows in read_rows(csv_path, columns):
        rows = list(rows)
        db.executemany(sql, rows)
        total += len(rows)
    return total


def run(paths):
    target = paths.database
    building = target.with_suffix(".db.building")
    building.unlink(missing_ok=True)

    db = sqlite3.connect(building)
    try:
        db.execute("PRAGMA journal_mode = OFF")
        db.execute("PRAGMA synchronous = OFF")
        db.executescript(files("crime_pipeline").joinpath("schema.sql").read_text())

        counts = {}
        with db:
            for table, columns in LOOKUP_TABLES.items():
                rows = lookups.read(table)[columns]
                rows = rows.astype(object).where(rows.notna(), None).itertuples(index=False, name=None)
                db.executemany(f"INSERT INTO {table} VALUES ({', '.join('?' * len(columns))})", rows)
            for city, name in OUTPUT_FILES.items():
                counts[city] = insert_csv(db, "offenses", paths.standardized(name), COLUMNS)
                print(f"Loaded {counts[city]:>9,} {city} offenses")
            counts["LA victims"] = insert_csv(db, "la_victims", paths.standardized(LA_VICTIMS_FILE), LA_VICTIM_COLUMNS)
            print(f"Loaded {counts['LA victims']:>9,} LA victims")

        with db:
            for sql in INDEXES:
                db.execute(sql)
            db.execute(BUILD_DAILY_COUNTS)
            db.execute("CREATE INDEX daily_counts_city_date ON daily_counts (city, occurred_date)")
            for sql in VIEWS:
                db.execute(sql)

            metadata = {
                "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "pipeline_version": __version__,
                "shared_window_start": SHARED_WINDOW_START,
                "source_la": paths.la_raw.name,
                "source_sd": ", ".join(fp.name for fp in paths.sd_yearly),
                "source_sf": paths.sf_raw.name,
                "source_sf_boundaries": ", ".join(geo.BOUNDARY_SOURCES),
                "sf_districts_redrawn": geo.SF_DISTRICTS_REDRAWN,
                **{f"rows_{key.lower().replace(' ', '_')}": str(n) for key, n in counts.items()},
            }
            db.executemany("INSERT INTO metadata VALUES (?, ?)", metadata.items())

        db.execute("ANALYZE")
    finally:
        db.close()

    os.replace(building, target)
    size_mb = target.stat().st_size / 1e6
    print(f"Built {target.name} ({size_mb:,.0f} MB)")
