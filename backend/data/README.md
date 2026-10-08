# backend/data

Datasets live here. Git keeps the folders, this README and the small boundary files, but **not the data**: raw exports are hundreds of MB and everything else is rebuilt by the pipeline.

| Folder | Contents | Made by |
|---|---|---|
| `raw/` | Original city exports, never modified | You (see below) |
| `boundaries/sf/` | SF police district + ZIP shapes (committed to git) | `crime-pipeline fetch-boundaries` |
| `cleaned/` | Each city parsed, typed and de-junked, in its own column names | `crime-pipeline clean` |
| `standardized/` | All cities in one shared layout, with categories and geography | `crime-pipeline standardize` |
| `crime.db` | SQLite database the website reads | `crime-pipeline load` |
| `archive/` | Old notebook outputs, kept for reference; not used by the pipeline | — |

## Getting the raw data

Download the exports and save them with these names:

```
raw/
├─ la/LAPD_NIBRS_Victims_Dataset.csv
├─ sd/pd_nibrs_2020_datasd.csv … pd_nibrs_2026_datasd.csv
└─ sf/Police_Department_Incident_Reports__2018_to_Present_<date>.csv
```

| City | Dataset |
|---|---|
| Los Angeles | LAPD NIBRS Victims (data.lacity.org) |
| San Diego | SDPD NIBRS crime offenses, one file per year (data.sandiego.gov) |
| San Francisco | Police Department Incident Reports: 2018 to Present (data.sf.gov). If there are several files, the newest is used. |

Then run `crime-pipeline all` from `backend/`.
