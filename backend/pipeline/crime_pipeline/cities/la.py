"""Los Angeles: LAPD NIBRS victims export.

clean():       raw -> cleaned/la_offenses.csv  one row per case x offense, LA's own fields
                      cleaned/la_victims.csv   one row per victim
standardize(): cleaned -> the shared layout (offenses) + standardized la_victims
"""

import pandas as pd

from crime_pipeline.common import (
    CITY_INFO, LA_VICTIM_COLUMNS, LA_VICTIMS_FILE, READ_AS_TEXT, clean_text, finish, iso_date, read_text_csv,
)

OFFENSES_FILE = "la_offenses.csv"

# Split only before a recognizable statute entry or local offense code.
OFFENSE_SEPARATOR = (
    r",\s*(?=(?:"
    r"[^,]+?\s+-\s+[A-Z]{2,5}\s+-\s+[FMI]\s+-\s+"
    r"|\d{3}[A-Z]?\s+-\s+"
    r"))"
)

# statute - legal code - classification - description - NIBRS code
STATUTE_PATTERN = (
    r"^(?P<statute>.+?)\s+-\s+"
    r"(?P<legal_code>[A-Z]{2,5})\s+-\s+"
    r"(?P<offense_class>[FMI])\s+-\s+"
    r"(?P<description>.+)\s+-\s+"
    r"(?P<nibrs_code>[0-9]{2}[0-9A-Z])$"
)

# local (pre-NIBRS LAPD) offense code - description
LOCAL_PATTERN = r"^(?P<local_code>\d{3}[A-Z]?)\s+-\s+(?P<local_description>.+)$"

# LAPD exports have used both: "10/01/2006 12:00:00 AM" and "2006 Oct 01 12:00:00 AM".
DATE_FORMATS = ("%m/%d/%Y %I:%M:%S %p", "%Y %b %d %I:%M:%S %p")


def parse_dates(values):
    """ISO dates from either LAPD export format."""
    return iso_date(values, DATE_FORMATS[0]).fillna(iso_date(values, DATE_FORMATS[1]))


def clean(paths):
    """Return {file name: DataFrame} for cleaned/."""
    raw = pd.read_csv(paths.la_raw, **READ_AS_TEXT)

    # Victim-level: age and "shot" belong to a victim, not an offense.
    age = pd.to_numeric(raw["Vict Age"], errors="coerce")
    victims = pd.DataFrame({
        "case_no": raw["CaseNo"],
        "unique_victim_no": raw["UniqueVictimNo"],
        "vict_age": age.where(age.between(0, 120)).astype("Int64"),
        "victim_shot": raw["Victim Shot"].map({"Yes": True, "No": False}).astype("boolean"),
        "status": clean_text(raw["Status"]),
        "status_desc": clean_text(raw["Status Desc"]),
        "total_victim_count": pd.to_numeric(raw["TotalVictimCount"], errors="coerce").astype("Int64"),
        "victim_ofs_list": clean_text(raw["VictimOfsList"]),
    })

    # One row per victim x offense entry.
    rows = raw.assign(victim_shot=victims["victim_shot"], time_occ=pd.to_numeric(raw["Time OCC"], errors="coerce"))
    rows["entry"] = rows["VictimOfsList"].astype("string").str.split(OFFENSE_SEPARATOR, regex=True)
    rows = rows.explode("entry", ignore_index=True)
    rows["entry"] = clean_text(rows["entry"])

    # Collapse victims: one row per case x offense entry, in order of first appearance.
    offenses = (
        rows.groupby(["CaseNo", "entry"], sort=False, dropna=False)
        .agg(
            occurred=("Date OCC", "first"),
            time_occ=("time_occ", "min"),
            reported=("Date Rptd", "first"),
            area=("AREA NAME", "first"),
            status=("Status Desc", "first"),
            total_victims=("TotalVictimCount", lambda s: pd.to_numeric(s, errors="coerce").max()),
            victim_count=("UniqueVictimNo", "nunique"),
            any_shot=("victim_shot", "any"),
        )
        .reset_index()
    )

    statute = offenses["entry"].str.extract(STATUTE_PATTERN)
    local = offenses["entry"].where(statute["statute"].isna()).str.extract(LOCAL_PATTERN)

    # Time OCC is HHMM without zero padding ("0", "930").
    hhmm = offenses["time_occ"].astype("Int64").astype("string").str.zfill(4)
    valid_time = hhmm.str.fullmatch(r"([01]\d|2[0-3])[0-5]\d", na=False)

    cleaned = pd.DataFrame({
        "case_no": offenses["CaseNo"],
        "offense_seq": offenses.groupby("CaseNo").cumcount() + 1,
        "date_occ": parse_dates(offenses["occurred"]),
        "time_occ": (hhmm.str[:2] + ":" + hhmm.str[2:]).where(valid_time),
        "date_rptd": parse_dates(offenses["reported"]),
        "area_name": offenses["area"],
        "status_desc": clean_text(offenses["status"]),
        "total_victim_count": offenses["total_victims"].astype("Int64"),
        "victim_count": offenses["victim_count"].astype("Int64"),
        "any_victim_shot": offenses["any_shot"].astype("boolean"),
        "offense_entry": offenses["entry"],
        "statute": statute["statute"],
        "legal_code": statute["legal_code"],
        "offense_classification": statute["offense_class"],
        "nibrs_code": statute["nibrs_code"],
        "local_offense_code": local["local_code"],
        "offense_description": clean_text(statute["description"].fillna(local["local_description"])),
    })
    return {OFFENSES_FILE: cleaned, LA_VICTIMS_FILE: victims}


def standardize(paths):
    """Return (offenses in the shared layout, {extra standardized file name: DataFrame})."""
    cleaned = read_text_csv(paths.cleaned(OFFENSES_FILE))
    victims = read_text_csv(paths.cleaned(LA_VICTIMS_FILE))

    out = pd.DataFrame({
        "source_row_id": cleaned["case_no"] + "_" + cleaned["offense_seq"],
        "case_id": cleaned["case_no"],
        "occurred_date": cleaned["date_occ"],
        "occurred_time": cleaned["time_occ"],
        "reported_date": cleaned["date_rptd"],
        "nibrs_code": cleaned["nibrs_code"],
        "source_offense_code": cleaned["statute"].fillna(cleaned["local_offense_code"]),
        "source_offense_description": cleaned["offense_description"],
        "source_offense_text": cleaned["offense_entry"],
        "statute": cleaned["statute"],
        "legal_code": cleaned["legal_code"],
        "offense_class": cleaned["offense_classification"],
        "possible_duplicate": False,
        "case_status": cleaned["status_desc"],
        "police_division": cleaned["area_name"],
        "victim_count": cleaned["victim_count"],
        "total_victim_count": cleaned["total_victim_count"],
        "any_victim_shot": cleaned["any_victim_shot"],
    })

    victims_out = pd.DataFrame({
        "city": CITY_INFO["LA"][0],
        "case_id": victims["case_no"],
        "victim_id": victims["unique_victim_no"],
        "victim_age": victims["vict_age"],
        "victim_shot": victims["victim_shot"],
        "victim_offense_list": victims["victim_ofs_list"],
    })[LA_VICTIM_COLUMNS]
    return finish(out, "LA"), {LA_VICTIMS_FILE: victims_out}
