"""San Diego: SDPD NIBRS yearly exports.

clean():       raw yearly files -> cleaned/sd_offenses.csv  one row per NIBRS offense, SD's own columns
standardize(): cleaned -> the shared layout
"""

import pandas as pd

from crime_pipeline.common import READ_AS_TEXT, clean_text, finish, iso_date, read_text_csv, whole_number

OFFENSES_FILE = "sd_offenses.csv"

# "487 (A) PC GRAND THEFT (Shoplifting) (F)" -> statute, legal code, description, class
STATUTE_PATTERN = (
    r"^(?P<statute>.+?)\s+(?P<legal_code>[A-Z]{2,4})\s+(?P<description>.+?)"
    r"\s*(?:\((?P<offense_class>[FMI])\))?$"
)

CATEGORY_FIXES = {"KIDNAPING/ABDUCTION": "KIDNAPPING/ABDUCTION"}
CITY_FIXES = {"SD": "SAN DIEGO"}
CRIME_AGAINST_NAMES = {"PE": "Person", "PR": "Property", "SO": "Society"}
FLAGS = {"True": True, "False": False}


def read_raw(paths):
    """All yearly SD files stacked into one DataFrame (all columns as text)."""
    if not paths.sd_yearly:
        raise FileNotFoundError(f"No pd_nibrs_<year>_datasd.csv files in {paths.raw_dir / 'sd'}")
    return pd.concat([pd.read_csv(fp, **READ_AS_TEXT) for fp in paths.sd_yearly], ignore_index=True)


def clean(paths):
    """Return {file name: DataFrame} for cleaned/."""
    raw = read_raw(paths)

    # code_section lists one or more statutes joined by "||".
    code_section = (
        clean_text(raw["code_section"])
        .str.replace(r"\s*\|\|\s*$", "", regex=True)
        .str.replace(r"\s*\|\|\s*", " || ", regex=True)
    )
    single = code_section.notna() & ~code_section.str.contains(r"\|\|", regex=True, na=False)
    statute = code_section.where(single).str.extract(STATUTE_PATTERN)

    division = clean_text(raw["division"])
    zip_code = whole_number(raw["zip"])

    cleaned = pd.DataFrame({
        "nibrs_uniq": raw["nibrs_uniq"],
        "objectid": raw["objectid"],
        "case_number": raw["case_number"],
        "occured_on": iso_date(raw["occured_on"], "%Y-%m-%d"),
        "approved_on": pd.to_datetime(raw["approved_on"], format="%Y-%m-%d %H:%M:%S", errors="coerce")
                         .dt.strftime("%Y-%m-%d %H:%M:%S"),
        "day_of_week": clean_text(raw["day_of_week"]),
        "month": whole_number(raw["month"]),
        "year": whole_number(raw["year"]),
        "code_section": code_section,
        "statute": clean_text(statute["statute"]),          # parsed from single-statute rows only
        "legal_code": statute["legal_code"],
        "offense_class": statute["offense_class"],
        "group_type": clean_text(raw["group_type"]),
        "ibr_category": clean_text(raw["ibr_category"]).replace(CATEGORY_FIXES),
        "crime_against": clean_text(raw["crime_against"]),
        "ibr_offense": clean_text(raw["ibr_offense"]),
        "ibr_offense_description": clean_text(raw["ibr_offense_description"]),
        "pd_offense_category": clean_text(raw["pd_offense_category"]),
        "violent_crime": raw["violent_crime"].map({"1": True, "0": False}).astype("boolean"),
        "property_crime": raw["property_crime"].map({"1": True, "0": False}).astype("boolean"),
        "division_number": whole_number(raw["division_number"]),
        "division": division.mask(division.eq("Unknown")),
        "service_area": whole_number(raw["service_area"]),
        "beat": whole_number(raw["beat"]),
        "neighborhood": clean_text(raw["neighborhood"]),
        "block_addr": clean_text(raw["block_addr"]),
        "city": clean_text(raw["city"]).str.upper().replace(CITY_FIXES).str.title(),
        "state": clean_text(raw["state"]),
        "zip": zip_code.where(zip_code.str.fullmatch(r"\d{5}", na=False)),
        "geocode_status": clean_text(raw["geocode_status"]),
        "geocode_score": clean_text(raw["geocode_score"]),
        "latitude": clean_text(raw["latitude"]),
        "longitude": clean_text(raw["longitude"]),
    })
    return {OFFENSES_FILE: cleaned}


def standardize(paths):
    """Return (offenses in the shared layout, {})."""
    cleaned = read_text_csv(paths.cleaned(OFFENSES_FILE))
    lat = cleaned["latitude"]

    out = pd.DataFrame({
        "source_row_id": cleaned["nibrs_uniq"],
        "case_id": cleaned["case_number"],
        "occurred_date": cleaned["occured_on"],
        "approved_at": cleaned["approved_on"],
        "nibrs_code": cleaned["ibr_offense"],
        "nibrs_description": cleaned["ibr_offense_description"],
        "nibrs_category": cleaned["ibr_category"],
        "nibrs_group": cleaned["group_type"],
        "crime_against": cleaned["crime_against"].map(CRIME_AGAINST_NAMES),
        "is_violent": cleaned["violent_crime"].map(FLAGS).astype("boolean"),
        "is_property": cleaned["property_crime"].map(FLAGS).astype("boolean"),
        "source_offense_code": cleaned["ibr_offense"],
        "source_offense_description": cleaned["ibr_offense_description"],
        "source_offense_category": cleaned["pd_offense_category"],
        "source_offense_text": cleaned["code_section"],
        "statute": cleaned["statute"],
        "legal_code": cleaned["legal_code"],
        "offense_class": cleaned["offense_class"],
        "possible_duplicate": False,
        "police_division": cleaned["division"],
        "police_division_number": cleaned["division_number"],
        "service_area": cleaned["service_area"],
        "beat": cleaned["beat"],
        "neighborhood": cleaned["neighborhood"],
        "zip": cleaned["zip"],
        "latitude": lat,
        "longitude": cleaned["longitude"],
        "location_is_approximate": pd.Series(False, index=cleaned.index, dtype="boolean").mask(lat.isna()),
    })
    return finish(out, "SD"), {}
