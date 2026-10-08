"""Quality checks for StandardizedData/*.csv against the raw data and shared layout.

Prints PASS / WARN / FAIL per check and a per-city column fill table.
"""

import pandas as pd

from crime_pipeline import enrich, lookups
from crime_pipeline.common import (
    BOOL_COLUMNS, COLUMNS, LA_VICTIM_COLUMNS, LA_VICTIMS_FILE, OUTPUT_FILES, READ_AS_TEXT, VALID_NIBRS,
)

# Rough bounding boxes (lat_min, lat_max, lon_min, lon_max) around each city.
CITY_BOUNDS = {
    "San Diego": (32.5, 33.5, -117.6, -116.0),
    "San Francisco": (37.6, 37.9, -122.6, -122.3),
}

REQUIRED_COLUMNS = ["city", "county", "county_fips", "source_row_id", "case_id", "occurred_date",
                    "crime_category", "crime_group"]

FORMATS = {
    "occurred_date": r"\d{4}-\d{2}-\d{2}",
    "reported_date": r"\d{4}-\d{2}-\d{2}",
    "occurred_time": r"([01]\d|2[0-3]):[0-5]\d",
    "reported_time": r"([01]\d|2[0-3]):[0-5]\d",
    "approved_at": r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}",
    "zip": r"\d{5}",
}


class Checker:
    def __init__(self):
        self.results = []

    def __call__(self, name, passed, detail="", level="FAIL", examples=None):
        status = "PASS" if passed else level
        self.results.append(status)
        print(f"[{status}] {name}" + (f" - {detail}" if detail else ""))
        if not passed and examples is not None and len(examples):
            with pd.option_context("display.max_colwidth", 100, "display.width", 200):
                print("\n".join("         " + line for line in examples.head(5).to_string().splitlines()))

    def summary(self):
        fails, warns = self.results.count("FAIL"), self.results.count("WARN")
        print(f"\n{len(self.results)} checks: {self.results.count('PASS')} passed, {warns} warnings, {fails} failed")
        return fails


def count(mask):
    return f"{int(mask.sum()):,} rows"


def check_city(check, label, df, expected_rows=None):
    print(f"\n{label}  ({len(df):,} rows)")
    city = df["city"].iloc[0]

    check("Columns match the shared layout", list(df.columns) == COLUMNS)
    if expected_rows is not None:
        check("Row count matches raw", len(df) == expected_rows, f"{len(df):,} vs {expected_rows:,}")
    check("source_row_id is unique", df["source_row_id"].is_unique, count(df["source_row_id"].duplicated()))

    # LA's offense text is always present; SD's raw code_section has a few blanks; SF has none.
    required = REQUIRED_COLUMNS + (["source_offense_text"] if city == "Los Angeles" else [])
    missing = df[required].isna().sum()
    check("Required columns are filled", not missing.any(),
          ", ".join(f"{c}: {n:,}" for c, n in missing[missing > 0].items()))

    for col, pattern in FORMATS.items():
        if df[col].notna().any():
            bad = df[col].notna() & ~df[col].str.fullmatch(pattern, na=False)
            check(f"{col} is formatted correctly", not bad.any(), count(bad), examples=df.loc[bad, col])

    for col in BOOL_COLUMNS:
        bad = df[col].notna() & ~df[col].isin(["True", "False"])
        check(f"{col} is True/False/empty", not bad.any(), count(bad), examples=df.loc[bad, col])

    padded = pd.Series(False, index=df.index)
    for col in (c for c in COLUMNS if c not in BOOL_COLUMNS):
        padded |= df[col].notna() & df[col].ne(df[col].str.strip())
    check("No leading/trailing spaces", not padded.any(), count(padded))

    nibrs = df["nibrs_code"].dropna()
    check("NIBRS codes are valid", nibrs.isin(VALID_NIBRS).all(),
          f"{(~nibrs.isin(VALID_NIBRS)).sum():,} rows", level="WARN",
          examples=nibrs[~nibrs.isin(VALID_NIBRS)].value_counts())
    known = set(lookups.read("nibrs_offenses")["nibrs_code"])
    check("Every NIBRS code is in lookups/nibrs_offenses.csv", nibrs.isin(known).all(),
          f"{(~nibrs.isin(known)).sum():,} rows", examples=nibrs[~nibrs.isin(known)].value_counts())

    categories = lookups.read("crime_categories").set_index("crime_category")["crime_group"]
    unknown = ~df["crime_category"].isin(categories.index)
    check("crime_category is a known category", not unknown.any(), count(unknown),
          examples=df.loc[unknown, "crime_category"].value_counts())
    check("crime_group matches its category", df["crime_category"].map(categories).eq(df["crime_group"]).all())
    check("is_crime is False exactly for Non-Crime", (df["is_crime"].eq("False") == df["crime_group"].eq("Non-Crime")).all())

    if city in CITY_BOUNDS:
        lat_min, lat_max, lon_min, lon_max = CITY_BOUNDS[city]
        lat, lon = pd.to_numeric(df["latitude"]), pd.to_numeric(df["longitude"])
        outside = lat.notna() & ~(lat.between(lat_min, lat_max) & lon.between(lon_min, lon_max))
        check("Coordinates fall inside the city area", not outside.any(), count(outside))
        check("Latitude and longitude are both present or both missing",
              (lat.isna() == lon.isna()).all(), count(lat.isna() != lon.isna()))

    years = pd.to_datetime(df["occurred_date"], errors="coerce").dt.year
    print(f"       occurred_date range: {df['occurred_date'].min()} to {df['occurred_date'].max()}"
          f" ({(years < 2000).sum():,} rows before 2000)")


def run(paths):
    """Run every check. Returns the number of failed checks."""
    check = Checker()
    read = lambda name: pd.read_csv(paths.standardized(name), **READ_AS_TEXT)

    la, la_victims = read(OUTPUT_FILES["LA"]), read(LA_VICTIMS_FILE)
    sd_df, sf_df = read(OUTPUT_FILES["SD"]), read(OUTPUT_FILES["SF"])

    la_raw = pd.read_csv(paths.la_raw, usecols=["CaseNo", "UniqueVictimNo", "Victim Shot"], **READ_AS_TEXT)
    sd_raw_rows = sum(len(pd.read_csv(fp, usecols=["nibrs_uniq"], dtype=str)) for fp in paths.sd_yearly)
    sf_raw = pd.read_csv(paths.sf_raw, usecols=["Row ID"], **READ_AS_TEXT)

    print("\nCleaned files")
    for name, standardized_df in [(OUTPUT_FILES["LA"], la), (LA_VICTIMS_FILE, la_victims),
                                  (OUTPUT_FILES["SD"], sd_df), (OUTPUT_FILES["SF"], sf_df)]:
        cleaned_rows = len(pd.read_csv(paths.cleaned(name), usecols=[0], dtype=str))
        check(f"cleaned/{name} has the same rows as standardized/{name}",
              cleaned_rows == len(standardized_df), f"{cleaned_rows:,} vs {len(standardized_df):,}")

    check_city(check, "Los Angeles", la)
    check_city(check, "San Diego", sd_df, expected_rows=sd_raw_rows)
    check_city(check, "San Francisco", sf_df, expected_rows=len(sf_raw))

    print("\nLos Angeles specifics")
    check("Every raw case appears", set(la_raw["CaseNo"]) == set(la["case_id"]),
          f"{len(set(la_raw['CaseNo']) ^ set(la['case_id'])):,} differ")
    check("Victims file has one row per raw victim",
          len(la_victims) == len(la_raw) and la_victims["victim_id"].is_unique
          and list(la_victims.columns) == LA_VICTIM_COLUMNS)
    victim_count = pd.to_numeric(la["victim_count"])
    check("victim_count is at least 1 and at most total_victim_count",
          (victim_count >= 1).all() and (victim_count <= pd.to_numeric(la["total_victim_count"]).fillna(1e9)).all())
    shot_raw = set(la_raw.loc[la_raw["Victim Shot"].eq("Yes"), "CaseNo"])
    shot_out = set(la.loc[la["any_victim_shot"].eq("True"), "case_id"])
    check("any_victim_shot matches raw cases with a shot victim", shot_raw == shot_out,
          f"{len(shot_raw ^ shot_out):,} cases differ")
    statute_rows = la["statute"].notna()
    check("Statute rows have a NIBRS code, legal code and class",
          la.loc[statute_rows, ["nibrs_code", "legal_code", "offense_class"]].notna().all().all())
    unparsed = la["source_offense_code"].isna()
    check("Unparsed LA offense entries", unparsed.mean() < 0.001,
          f"{unparsed.sum():,} rows ({unparsed.mean():.3%}) -> 'All Other'", level="WARN")
    local_rows = la["statute"].isna() & la["source_offense_code"].notna()
    unmapped_local = local_rows & enrich.la_local_category(la).isna()
    check("Every old LAPD code is in lookups/la_local_codes.csv", not unmapped_local.any(),
          f"{unmapped_local.sum():,} rows -> 'All Other'", level="WARN",
          examples=la.loc[unmapped_local, ["source_offense_code", "source_offense_description"]].value_counts())
    area_cols = ["police_division_number", "police_bureau", "latitude", "longitude"]
    check("Every LA row has area number, bureau and center point", la[area_cols].notna().all().all(),
          ", ".join(f"{c}: {n:,}" for c, n in la[area_cols].isna().sum().items() if n))
    check("LA coordinates are flagged approximate", la["location_is_approximate"].eq("True").all())

    print("\nSan Diego specifics")
    check("Every SD row has a NIBRS code", sd_df["nibrs_code"].notna().all(), count(sd_df["nibrs_code"].isna()))
    check("Statute parsed for most rows", sd_df["statute"].notna().mean() > 0.9,
          f"{sd_df['statute'].notna().mean():.1%} (multi-statute rows are kept as text only)", level="WARN")
    check("Division name and number agree one-to-one",
          sd_df.dropna(subset=["police_division"]).groupby("police_division")["police_division_number"]
          .nunique().eq(1).all())

    print("\nSan Francisco specifics")
    check("Every raw SF row appears", set(sf_raw["Row ID"]) == set(sf_df["source_row_id"]))
    has_category = sf_df["source_offense_category"].notna()
    unmapped_sf = has_category & enrich.sf_category(sf_df).isna()
    check("Every SF category is in lookups/sf_category_map.csv", not unmapped_sf.any(),
          f"{unmapped_sf.sum():,} rows -> 'All Other'", level="WARN",
          examples=sf_df.loc[unmapped_sf, ["source_offense_category", "source_offense_subcategory"]].value_counts())
    located = sf_df["latitude"].notna()
    district_rate = sf_df.loc[located, "police_division"].notna().mean()
    zip_rate = sf_df.loc[located, "zip"].notna().mean()
    check("Rows with coordinates have a police district", district_rate > 0.99,
          f"{district_rate:.2%} (the rest are mostly in the Presidio, outside SFPD districts)")
    check("Rows with coordinates have a ZIP", zip_rate > 0.99, f"{zip_rate:.2%}")
    check("No district or ZIP without coordinates",
          not (~located & (sf_df["police_division"].notna() | sf_df["zip"].notna())).any())
    district_names = set(sf_df["police_division"].dropna())
    check("SF has the 10 SFPD districts", len(district_names) == 10, ", ".join(sorted(district_names)))
    dup = sf_df["possible_duplicate"].eq("True")
    non_crime = sf_df["is_crime"].eq("False")
    print(f"       possible_duplicate: {dup.sum():,} rows ({dup.mean():.1%}); is_crime False: {non_crime.sum():,} rows;"
          f" no SF category ('All Other'): {(~has_category).sum():,} rows")

    print("\nRows per crime category (% of each city)")
    shares = pd.DataFrame({name: df.groupby(["crime_group", "crime_category"]).size() / len(df)
                           for name, df in [("LA", la), ("SD", sd_df), ("SF", sf_df)]}).fillna(0)
    categories = lookups.read("crime_categories")
    order = pd.MultiIndex.from_frame(categories[["crime_group", "crime_category"]])
    print((shares.reindex(order).fillna(0) * 100).round(1).to_string())

    print("\nShare of rows filled per column")
    fill = pd.DataFrame({name: df.notna().mean() for name, df in [("LA", la), ("SD", sd_df), ("SF", sf_df)]})
    print((fill * 100).round(1).astype(str).replace("0.0", "-").to_string())

    return check.summary()
