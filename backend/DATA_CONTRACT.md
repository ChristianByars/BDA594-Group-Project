# crime.db: Data Contract

This is the reference for building the website on top of the crime database. `crime-pipeline load` writes the database to `backend/data/crime.db`. It is a single SQLite file of about 1.3 GB, rebuilt from scratch on every load.

**Stability promise:** later pipeline stages may **add** tables and columns. Existing table and column names will not be renamed or removed without updating this file. See the [change log](#change-log) for what changed and when.

## Connecting from TypeScript

Open the file **read-only**. The website never writes to it.

```ts
import Database from "better-sqlite3";

// Path from the repo root; consider reading it from an env var such as CRIME_DB_PATH.
const db = new Database("backend/data/crime.db", { readonly: true, fileMustExist: true });

const monthly = db.prepare(`
  SELECT city, substr(occurred_date, 1, 7) AS month, crime_group, SUM(offense_count) AS offenses
  FROM daily_counts
  WHERE is_crime = 1 AND possible_duplicate = 0 AND occurred_date >= ?
  GROUP BY city, month, crime_group
  ORDER BY month, city
`).all("2025-01-01");
```

Kysely and Drizzle both support SQLite through `better-sqlite3` if you want typed queries.

## Conventions

| Kind | Format | Example |
|---|---|---|
| Dates | ISO text, sorts correctly as text | `'2025-03-14'` |
| Times | `HH:MM`, 24-hour, Pacific time | `'17:03'` |
| Flags | `INTEGER` 1 / 0 | `is_crime = 1` |
| Missing | `NULL` means the city or row doesn't have this value | SD has no `occurred_time` |
| City names | `'Los Angeles'`, `'San Diego'`, `'San Francisco'` | |

## Which table to use

| Need | Use |
|---|---|
| Charts: counts over time, by city, category or division | **`daily_counts`** (fast, about 880k rows) |
| City-to-city comparisons | **`comparable_offenses`** view, or `daily_counts` filtered the same way |
| Category names, groups, display order, descriptions | **`crime_categories`** |
| Row-level detail: maps, tables, drill-downs | `offenses` |
| LA area names, numbers, bureaus, map center points | `lapd_areas` |
| LA victim age / victim shot | `la_victims` |
| NIBRS code → description, category, flags | `nibrs_offenses` |
| When and from what files the database was built | `metadata` |

## Crime categories: the shared classification

Every row in every city has a `crime_category` and a `crime_group`. **Use these for any city-to-city comparison**; the `nibrs_*` and `source_*` columns are city-specific.

| `crime_group` | `crime_category` values (in `sort_order`) |
|---|---|
| Violent | Homicide · Sex Offense · Robbery · Aggravated Assault · Simple Assault · Kidnapping & Trafficking |
| Property | Burglary · Theft · Fraud & Financial · Vandalism & Arson |
| Vehicle | Motor Vehicle Theft · Theft from Vehicle |
| Society | Drugs · Weapons · Public Order |
| Other | All Other (warrants, traffic arrests, uncategorized) |
| Non-Crime | Non-Crime (lost property, missing persons, recovered vehicles…); `is_crime = 0` |

The `crime_categories` table has each category's group, `sort_order` (use it for chart ordering and legends) and a one-line `description` (good for tooltips).

How each city is mapped: LA and SD by NIBRS code; LA's older LAPD codes by code; SF by its own category and subcategory. The mappings are CSV files in `backend/pipeline/crime_pipeline/lookups/`.

## Default filters for honest comparisons

Apply all three filters unless a chart is specifically about the excluded rows.

1. **`is_crime = 1`:** excludes non-crime reports, mostly from SF (192k rows), plus 211 LA rows.
2. **`possible_duplicate = 0`:** SF sometimes files a later report that repeats an earlier one (42k rows).
3. **`occurred_date >= shared_window_start`:** LA's data only reaches full volume in January 2025. Earlier LA months are incomplete, so they understate LA crime. Read the date from `metadata` (currently `2025-01-01`).

The `comparable_offenses` view applies all three.

## Tables

### `offenses`: one row per offense, all cities (2.06M rows)

What one row means differs slightly by city. LA: one offense in a case, with its victims combined. SD: one NIBRS offense. SF: one offense code on one report. A case or incident can therefore have several rows. Count `DISTINCT case_id` for incidents.

The LA / SD / SF columns show how often each column is filled.

| Column | Type | Meaning | LA | SD | SF |
|---|---|---|---|---|---|
| `city`, `county`, `county_fips` | text | Where. `county_fips` joins to census data. | ✓ | ✓ | ✓ |
| `source_row_id` | text | Unique within a city | ✓ | ✓ | ✓ |
| `case_id` | text | Groups the offenses of one case or report | ✓ | ✓ | ✓ |
| `sf_incident_number` | text | SF incident number. Not unique; has placeholder values. | | | ✓ |
| `occurred_date` | text | Date the crime occurred | ✓ | ✓ | ✓ |
| `occurred_time` | text | Time it occurred | ✓ | — | ✓ |
| `reported_date`, `reported_time` | text | When it was reported | date 99% | — | ✓ |
| `approved_at` | text | When the report was approved | | ✓ | |
| `crime_category` | text | Shared category, e.g. `Robbery` (see above) | ✓ | ✓ | ✓ |
| `crime_group` | text | Shared group, e.g. `Violent` | ✓ | ✓ | ✓ |
| `nibrs_code` | text | FBI NIBRS offense code, e.g. `13B` | 99.8% | ✓ | — |
| `nibrs_description` | text | e.g. `Simple Assault` | 99.8% | ✓ | — |
| `nibrs_category` | text | FBI category, e.g. `ASSAULT OFFENSES` | 99.8% | ✓ | — |
| `nibrs_group` | text | `A` (major) / `B` (minor) | 99.8% | ✓ | — |
| `crime_against` | text | `Person` / `Property` / `Society` (empty for Group B) | 95% | 79% | — |
| `is_violent`, `is_property` | int | FBI violent / property crime flags | 99.8% | ✓ | — |
| `source_offense_code` | text | The city's own code | ✓ | ✓ | ✓ |
| `source_offense_description` | text | The city's own description | ✓ | ✓ | ✓ |
| `source_offense_category` | text | The city's own category | — | ✓ | ✓ |
| `source_offense_subcategory` | text | | — | — | ✓ |
| `source_offense_text` | text | Original unparsed offense text | ✓ | ✓ | — |
| `statute`, `legal_code`, `offense_class` | text | e.g. `459`, `PC`, `F` (felony / `M` misdemeanor / `I` infraction). `ZZ` = warrant. | 99.8% | 94% / 94% / 79% | — |
| `is_crime` | int | 0 when `crime_group = 'Non-Crime'` | ✓ | ✓ | ✓ |
| `possible_duplicate` | int | 1 if the row repeats an earlier SF report | ✓ (0) | ✓ (0) | ✓ |
| `case_status` | text | e.g. `Open`, `Cleared by Arrest` | ✓ | — | ✓ |
| `police_division` | text | LAPD area (21) / SDPD division (9) / SFPD district (10) | ✓ | ✓ | 94% |
| `police_division_number` | int | LAPD area number (1–21) / SDPD division number | ✓ | ✓ | — |
| `police_bureau` | text | LAPD bureau: `Central` / `South` / `Valley` / `West` | ✓ | | |
| `service_area`, `beat` | text | SDPD sub-areas | | ✓ | |
| `neighborhood` | text | Neighborhood name | — | ✓ | 95% |
| `zip` | text | 5-digit ZIP. SD: from the address. SF: Census ZIP area (ZCTA) containing the coordinates. | — | 99% | 94% |
| `latitude`, `longitude` | real | Coordinates. **LA: the area's center point, not the crime's location.** | ✓ (approx.) | 98% | 95% |
| `location_is_approximate` | int | 1 if coordinates are an area center point, not an address | ✓ (1) | ✓ (0) | ✓ (0) |
| `victim_count` | int | Victims of this offense | ✓ | | |
| `total_victim_count` | int | Victims in the whole case | ✓ | | |
| `any_victim_shot` | int | 1 if any victim of this offense was shot | ✓ | | |

Key: ✓ = filled for all or nearly all rows, a percentage = partly filled, — = the city doesn't have it, blank = not applicable.

**Mapping LA:** every LA row in an area has the same coordinates. Don't plot LA rows as individual points. Aggregate by `police_division` and draw one marker or shaded area per LAPD area.

### `daily_counts`: pre-aggregated for charts

One row per `city × occurred_date × police_division × crime_group × crime_category × offense_category × is_crime × possible_duplicate`.

| Column | Meaning |
|---|---|
| `offense_count` | Number of offense rows. **Safe to `SUM`.** |
| `case_count` | Distinct cases within this row's group. **Don't `SUM` across categories**: one case with two offense types counts in both. |
| `crime_group`, `crime_category` | Shared classification. Use these to compare cities. |
| `offense_category` | Each city's own grouping: NIBRS category for LA and SD, SFPD category for SF. For single-city drill-downs. |

### `comparable_offenses` (view)

`offenses` with the three default filters applied. It has the same columns as `offenses`.

### `crime_categories`: the shared categories (17 rows)

`crime_category`, `crime_group`, `sort_order`, `description`.

### `lapd_areas`: LAPD's 21 areas

`area_number` (1–21), `area_name` (matches `offenses.police_division`), `area_full_name` (e.g. `North Hollywood` for `N Hollywood`), `bureau`, `center_latitude`, `center_longitude`. Center points are the average location of each area's 2020–2024 crimes, from LAPD's "Crime Data from 2020 to Present" dataset. Bureaus were checked against lapdonline.org.

### `la_victims`: one row per LA victim

`case_id`, `victim_id`, `victim_age` (0–120 or NULL), `victim_shot` (0/1), `victim_offense_list`. Join on `offenses.city = 'Los Angeles' AND offenses.case_id = la_victims.case_id`.

### `nibrs_offenses`: NIBRS code reference (64 codes)

`nibrs_code`, `nibrs_description`, `nibrs_category`, `nibrs_group`, `crime_against`, `is_violent`, `is_property`, `crime_category`. `is_violent` and `is_property` follow the FBI's definitions. Violent: murder, rape, robbery, aggravated assault. Property: burglary, larceny, motor vehicle theft, arson.

### `metadata`

Key/value pairs: `built_at`, `pipeline_version`, `shared_window_start`, the source file names, and row counts per city.

## Known limitations

- **LA only includes offenses with a victim.** The LAPD source is a *victims* dataset, so crimes with no direct victim are largely missing: LA has about 500 drug offenses in 2025 versus 7,700 in SD. **Compare cities on the Violent, Property and Vehicle groups; treat Society and Other comparisons involving LA as unreliable.**
- **LA locations are area-level only.** The source has no address, coordinates or ZIP; `latitude`/`longitude` are area center points.
- **SF district and ZIP come from coordinates**, so the 5% of SF rows without coordinates have neither. About 0.2% of located rows (mostly the Presidio, which is federal land) fall outside every SFPD district. SFPD redrew its districts on 2026-10-01; each crime uses the map in effect on its `occurred_date` (`metadata.sf_districts_redrawn`).
- **SD has no time of day.** Hour-of-day charts can only cover LA and SF.
- **SF isn't NIBRS-coded.** Compare SF to LA and SD with `crime_category` / `crime_group`, not the `nibrs_*` columns.
- **SF reports very few sex offenses** (77 in 2025, versus 2,535 in LA and 840 in SD). That probably reflects what SF publishes, not less crime. Avoid drawing conclusions from SF's sex offense numbers.
- **Different reporting practices.** Cities record and classify offenses differently. Per-capita rates (via `county_fips` and census population) are fairer than raw counts.
- **158 LA rows have occurrence dates before 2000**, the earliest in 1800. These are old crimes reported late, and the shared window excludes them.

## Example queries

```sql
-- Monthly offenses per city and crime group, comparable window
SELECT city, substr(occurred_date, 1, 7) AS month, crime_group, SUM(offense_count) AS offenses
FROM daily_counts
WHERE is_crime = 1 AND possible_duplicate = 0
  AND occurred_date >= (SELECT value FROM metadata WHERE key = 'shared_window_start')
GROUP BY city, month, crime_group ORDER BY month, city;

-- 2025 offenses by shared category, one column per city, in display order
SELECT c.crime_group, c.crime_category,
       SUM(CASE WHEN d.city = 'Los Angeles'   THEN d.offense_count END) AS la,
       SUM(CASE WHEN d.city = 'San Diego'     THEN d.offense_count END) AS sd,
       SUM(CASE WHEN d.city = 'San Francisco' THEN d.offense_count END) AS sf
FROM daily_counts AS d JOIN crime_categories AS c USING (crime_category)
WHERE d.is_crime = 1 AND d.possible_duplicate = 0
  AND d.occurred_date BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY c.crime_group, c.crime_category ORDER BY c.sort_order;

-- LA 2025 violent crime by area, with map points
SELECT a.area_number, a.area_full_name, a.bureau, a.center_latitude, a.center_longitude,
       SUM(d.offense_count) AS violent_offenses
FROM daily_counts AS d JOIN lapd_areas AS a ON a.area_name = d.police_division
WHERE d.city = 'Los Angeles' AND d.crime_group = 'Violent'
  AND d.occurred_date BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY a.area_number ORDER BY violent_offenses DESC;

-- Map points for SF vehicle theft in a date range
SELECT latitude, longitude, occurred_date, source_offense_description
FROM comparable_offenses
WHERE city = 'San Francisco' AND crime_category = 'Motor Vehicle Theft'
  AND occurred_date BETWEEN '2025-06-01' AND '2025-06-30' AND latitude IS NOT NULL;
```

## Change log

**1.0.0: repo restructure**
- The database moved to `backend/data/crime.db`. Its contents are unchanged: tables, columns and values are identical to stage 3.

**Stage 3: SF geography**
- SF rows now have `police_division` (one of 10 SFPD districts, matched by coordinates and date) and `zip` (2020 Census ZIP area).
- Added `metadata` keys `source_sf_boundaries` and `sf_districts_redrawn`.

**Stage 2: shared categories and lookups**
- Added `crime_category`, `crime_group` and `police_bureau` to `offenses`, and `crime_group` and `crime_category` to `daily_counts`.
- Added the `crime_categories` and `lapd_areas` tables. `nibrs_offenses` is now a curated list (64 codes, was 59) with a `crime_category` column.
- LA rows now have `police_division_number`, `police_bureau` and approximate `latitude`/`longitude`, with `location_is_approximate = 1`.
- `is_crime` now comes from the shared classification for every city. That turned 211 LA rows (old LAPD non-crime codes) and 308 SF "Suspicious Occ" rows to 0.
- `is_violent` / `is_property` now follow the FBI definitions for every row. In SD, motor vehicle theft is now always `is_property = 1` (SD's source was inconsistent) and arson is now `is_property = 1`.
- 36 LA rows with NIBRS codes `26E` / `40C` now have NIBRS details.

**Stage 1:** initial database.
