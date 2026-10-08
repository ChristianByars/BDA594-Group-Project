"""San Francisco: SFPD incident reports export.

clean():       raw -> cleaned/sf_offenses.csv  one row per report x incident code, SF's own fields
standardize(): cleaned -> the shared layout
"""

import pandas as pd

from crime_pipeline.common import READ_AS_TEXT, clean_text, finish, iso_date, read_text_csv

OFFENSES_FILE = "sf_offenses.csv"

# Which SF categories are non-crime is set in lookups/sf_category_map.csv.

# Spelling variants of the same category.
CATEGORY_FIXES = {
    "Weapons Offence": "Weapons Offense",
    "Motor Vehicle Theft?": "Motor Vehicle Theft",
    "Human Trafficking, Commercial Sex Acts": "Human Trafficking (A), Commercial Sex Acts",
}


def clean(paths):
    """Return {file name: DataFrame} for cleaned/."""
    raw = pd.read_csv(paths.sf_raw, **READ_AS_TEXT)

    reported = pd.to_datetime(raw["Report Datetime"], format="%Y/%m/%d %I:%M:%S %p", errors="coerce")

    # Later reports that repeat an earlier report's incident number, code and date.
    key = ["Incident Number", "Incident Code", "Incident Date"]
    ordered = raw.loc[raw.assign(_reported=reported).sort_values(["_reported", "Incident ID"]).index]
    repeat = ordered.duplicated(key)
    first_id = ordered.groupby(key)["Incident ID"].transform("first")
    possible_duplicate = (repeat & ordered["Incident ID"].ne(first_id)).reindex(raw.index)

    cleaned = pd.DataFrame({
        "row_id": raw["Row ID"],
        "incident_id": raw["Incident ID"],
        "incident_number": raw["Incident Number"],
        "incident_date": iso_date(raw["Incident Date"], "%Y/%m/%d"),
        "incident_time": raw["Incident Time"].where(
            raw["Incident Time"].str.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", na=False)),
        "incident_day_of_week": clean_text(raw["Incident Day of Week"]),
        "report_datetime": reported.dt.strftime("%Y-%m-%d %H:%M"),
        "filed_online": raw["Filed Online"].eq("true"),
        "incident_code": raw["Incident Code"],
        "incident_category": clean_text(raw["Incident Category"]).replace(CATEGORY_FIXES),
        "incident_subcategory": clean_text(raw["Incident Subcategory"]),
        "incident_description": clean_text(raw["Incident Description"]),
        "resolution": clean_text(raw["Resolution"]),
        "intersection": clean_text(raw["Intersection"]),
        "analysis_neighborhood": clean_text(raw["Analysis Neighborhood"]),
        "latitude": clean_text(raw["Latitude"]),
        "longitude": clean_text(raw["Longitude"]),
        "possible_duplicate": possible_duplicate.astype(bool),
    })
    return {OFFENSES_FILE: cleaned}


def standardize(paths):
    """Return (offenses in the shared layout, {})."""
    cleaned = read_text_csv(paths.cleaned(OFFENSES_FILE))
    lat = cleaned["latitude"]

    out = pd.DataFrame({
        "source_row_id": cleaned["row_id"],
        "case_id": cleaned["incident_id"],
        "sf_incident_number": cleaned["incident_number"],
        "occurred_date": cleaned["incident_date"],
        "occurred_time": cleaned["incident_time"],
        "reported_date": cleaned["report_datetime"].str[:10],
        "reported_time": cleaned["report_datetime"].str[11:16],
        "source_offense_code": cleaned["incident_code"],
        "source_offense_description": cleaned["incident_description"],
        "source_offense_category": cleaned["incident_category"],
        "source_offense_subcategory": cleaned["incident_subcategory"],
        "possible_duplicate": cleaned["possible_duplicate"],
        "case_status": cleaned["resolution"],
        "neighborhood": cleaned["analysis_neighborhood"],
        "latitude": lat,
        "longitude": cleaned["longitude"],
        "location_is_approximate": pd.Series(False, index=cleaned.index, dtype="boolean").mask(lat.isna()),
    })
    return finish(out, "SF"), {}
