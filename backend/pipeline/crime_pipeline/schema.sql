-- crime.db schema (SQLite). Built fresh by `crime-pipeline load`; see DATA_CONTRACT.md.
-- Conventions: dates are ISO text ('2025-03-14'), times are 'HH:MM' (Pacific),
-- flags are INTEGER 0/1, NULL means "not available for this city/row".

CREATE TABLE metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- One row per offense, all three cities.
CREATE TABLE offenses (
    city                       TEXT NOT NULL,      -- 'Los Angeles' | 'San Diego' | 'San Francisco'
    county                     TEXT NOT NULL,
    county_fips                TEXT NOT NULL,
    source_row_id              TEXT NOT NULL,      -- unique within a city
    case_id                    TEXT NOT NULL,
    sf_incident_number         TEXT,
    occurred_date              TEXT NOT NULL,
    occurred_time              TEXT,
    reported_date              TEXT,
    reported_time              TEXT,
    approved_at                TEXT,
    crime_category             TEXT NOT NULL,      -- shared across cities, see crime_categories
    crime_group                TEXT NOT NULL,      -- 'Violent' | 'Property' | 'Vehicle' | 'Society' | 'Other' | 'Non-Crime'
    nibrs_code                 TEXT,
    nibrs_description          TEXT,
    nibrs_category             TEXT,
    nibrs_group                TEXT,               -- 'A' | 'B'
    crime_against              TEXT,               -- 'Person' | 'Property' | 'Society'
    is_violent                 INTEGER,
    is_property                INTEGER,
    source_offense_code        TEXT,
    source_offense_description TEXT,
    source_offense_category    TEXT,
    source_offense_subcategory TEXT,
    source_offense_text        TEXT,
    statute                    TEXT,
    legal_code                 TEXT,
    offense_class              TEXT,               -- 'F' felony | 'M' misdemeanor | 'I' infraction
    is_crime                   INTEGER NOT NULL,
    possible_duplicate         INTEGER NOT NULL,
    case_status                TEXT,
    police_division            TEXT,
    police_division_number     INTEGER,
    police_bureau              TEXT,               -- LA only: 'Central' | 'South' | 'Valley' | 'West'
    service_area               TEXT,
    beat                       TEXT,
    neighborhood               TEXT,
    zip                        TEXT,
    latitude                   REAL,
    longitude                  REAL,
    location_is_approximate    INTEGER,
    victim_count               INTEGER,
    total_victim_count         INTEGER,
    any_victim_shot            INTEGER
);

-- LA only: one row per victim. Joins to offenses on (city, case_id).
CREATE TABLE la_victims (
    city                TEXT NOT NULL,
    case_id             TEXT NOT NULL,
    victim_id           TEXT PRIMARY KEY,
    victim_age          INTEGER,
    victim_shot         INTEGER,
    victim_offense_list TEXT
);

-- The lookup tables below are copies of src/crime_pipeline/lookups/*.csv.

-- Shared crime categories, in display order.
CREATE TABLE crime_categories (
    crime_category TEXT PRIMARY KEY,
    crime_group    TEXT NOT NULL,
    sort_order     INTEGER NOT NULL,
    description    TEXT
);

-- NIBRS code reference. is_violent / is_property follow the FBI's violent and property crime definitions.
CREATE TABLE nibrs_offenses (
    nibrs_code        TEXT PRIMARY KEY,
    nibrs_description TEXT,
    nibrs_category    TEXT,
    nibrs_group       TEXT,
    crime_against     TEXT,
    is_violent        INTEGER,
    is_property       INTEGER,
    crime_category    TEXT NOT NULL REFERENCES crime_categories (crime_category)
);

-- LAPD's 21 areas (police_division for LA rows).
CREATE TABLE lapd_areas (
    area_number      INTEGER PRIMARY KEY,
    area_name        TEXT NOT NULL UNIQUE,   -- matches offenses.police_division
    area_full_name   TEXT NOT NULL,
    bureau           TEXT NOT NULL,
    center_latitude  REAL NOT NULL,          -- mean location of the area's 2020-2024 crimes
    center_longitude REAL NOT NULL
);
