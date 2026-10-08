"""Fast unit tests for the parsing rules, using tiny made-up inputs (no data files needed)."""

import pandas as pd

from crime_pipeline.cities import la, sd
from crime_pipeline.common import COLUMNS, clean_text, finish, whole_number


def split_la(text):
    return pd.Series([text], dtype="string").str.split(la.OFFENSE_SEPARATOR, regex=True)[0]


def test_la_splits_multiple_statute_entries():
    entries = split_la("459 - PC - F - Burglary - Residential - 220, 594(B)(1) - PC - F - Vandalism ($400 Or More) - Felony - 290")
    assert entries == ["459 - PC - F - Burglary - Residential - 220",
                       "594(B)(1) - PC - F - Vandalism ($400 Or More) - Felony - 290"]


def test_la_keeps_commas_inside_descriptions():
    assert split_la("113  - MANSLAUGHTER, NEGLIGENT") == ["113  - MANSLAUGHTER, NEGLIGENT"]


def test_la_statute_entry_fields():
    fields = pd.Series(["243(A) - PC - M - Battery On Person - Simple - 13B"]).str.extract(la.STATUTE_PATTERN).iloc[0]
    assert fields.to_dict() == {"statute": "243(A)", "legal_code": "PC", "offense_class": "M",
                                "description": "Battery On Person - Simple", "nibrs_code": "13B"}


def test_la_local_code_entry_fields():
    fields = pd.Series(["210B - ROBBERY - BUSINESS"]).str.extract(la.LOCAL_PATTERN).iloc[0]
    assert fields.to_dict() == {"local_code": "210B", "local_description": "ROBBERY - BUSINESS"}


def test_la_truncated_entry_does_not_parse():
    fields = pd.Series(["14601.2(A) - VC - M - Driv - Susp/Etc Lic - Dui - Vio -"]).str.extract(la.STATUTE_PATTERN)
    assert fields.isna().all(axis=None)


def test_sd_statute_with_class():
    fields = pd.Series(["487 (A) PC GRAND THEFT (Shoplifting) (F)"]).str.extract(sd.STATUTE_PATTERN).iloc[0]
    assert fields.to_dict() == {"statute": "487 (A)", "legal_code": "PC",
                                "description": "GRAND THEFT (Shoplifting)", "offense_class": "F"}


def test_sd_warrant_statute_without_class():
    fields = pd.Series(["BW-F ZZ FELONY BENCH WARRANT (OUR AGENCY)"]).str.extract(sd.STATUTE_PATTERN).iloc[0]
    assert fields["statute"] == "BW-F" and fields["legal_code"] == "ZZ" and pd.isna(fields["offense_class"])


def test_whole_number_drops_float_suffix():
    assert whole_number(pd.Series(["92105.0", "822", None, "abc"])).tolist() == ["92105", "822", pd.NA, pd.NA]


def test_clean_text_collapses_spaces_and_blanks():
    assert clean_text(pd.Series(["  a   b ", "", None])).tolist() == ["a b", pd.NA, pd.NA]


def test_finish_returns_shared_layout():
    out = finish(pd.DataFrame({"case_id": ["1"]}), "SD")
    assert list(out.columns) == COLUMNS
    assert out.loc[0, ["city", "county_fips"]].tolist() == ["San Diego", "06073"]
