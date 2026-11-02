# Data compatibility report

Written by `crime-pipeline export` at 2026-11-02T23:09:15+00:00 from crime.db built at 2026-10-08T21:17:51+00:00. Counts are comparable offenses: is_crime = 1, possible_duplicate = 0, occurred_date >= 2025-01-01.

SF ZIPs missing from the statewide ZIP file, filled from the Census ZCTA file: 94188.

LAPD area population estimates from 2024 ZIP data add up to 3,669,470; the Census city estimate for 2024 is 3,872,710 (-5.2%).

## Result

OK: every SF ZIP and district and every LAPD area has a polygon, and every LAPD area has a population.

## Los Angeles

| Join | In crime data | Matched | Offenses matched |
|---|---|---|---|
| Police division → boundary | 21 | 21 | 340,637 of 340,637 (100.00%) |

Offenses with no usable geography: 340,637 without a ZIP, 0 without a division, 0 with neither, out of 340,637.

No ZIPs in the crime data, so the map uses police divisions.

## San Diego

| Join | In crime data | Matched | Offenses matched |
|---|---|---|---|
| ZIP → socioeconomic CSV | 163 | 122 | 133,935 of 133,987 (99.96%) |
| ZIP → ZIP polygon | 163 | 119 | 133,882 of 133,987 (99.92%) |
| Police division → boundary | 9 | no boundary file | |

Offenses with no usable geography: 667 without a ZIP, 905 without a division, 55 with neither, out of 134,654.

ZIPs without a polygon (44): 21123 (1), 22465 (1), 23453 (1), 27278 (1), 30252 (1), 31021 (1), 32115 (1), 37027 (1), 43223 (1), 45459 (1), 74432 (1), 78028 (1), 79925 (1), 80538 (1), 85009 (1), 86321 (1), 89101 (5), 89410 (1), 89501 (1), 90000 (1), 91110 (1), 91209 (1), 91943 (1), 91976 (1), 92012 (1), 92015 (2), 92018 (1), 92039 (1), 92092 (6), 92100 (1), 92112 (4), 92125 (2), 92132 (1), 92133 (2), 92143 (1), 92150 (1), 92158 (1), 92161 (46), 92162 (1), 92180 (2), 92191 (1), 97201 (1), 98036 (1), 99501 (1)

ZIPs without a socioeconomic row (41): 21123 (1), 22465 (1), 23453 (1), 27278 (1), 30252 (1), 31021 (1), 32115 (1), 37027 (1), 43223 (1), 45459 (1), 74432 (1), 78028 (1), 79925 (1), 80538 (1), 85009 (1), 86321 (1), 89101 (5), 89410 (1), 89501 (1), 90000 (1), 91110 (1), 91209 (1), 91943 (1), 91976 (1), 92012 (1), 92015 (2), 92018 (1), 92039 (1), 92100 (1), 92112 (4), 92125 (2), 92133 (2), 92143 (1), 92150 (1), 92158 (1), 92162 (1), 92180 (2), 92191 (1), 97201 (1), 98036 (1), 99501 (1)

## San Francisco

| Join | In crime data | Matched | Offenses matched |
|---|---|---|---|
| ZIP → socioeconomic CSV | 30 | 30 | 123,335 of 123,335 (100.00%) |
| ZIP → ZIP polygon | 30 | 30 | 123,335 of 123,335 (100.00%) |
| Police division → boundary | 10 | 10 | 123,282 of 123,282 (100.00%) |

Offenses with no usable geography: 3,663 without a ZIP, 3,716 without a division, 3,598 with neither, out of 126,998.
