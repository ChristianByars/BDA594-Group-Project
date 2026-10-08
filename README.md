# BDA594-Group-Project

**Bad Data Analytics (BDA 594):** comparing reported crime across **Los Angeles**, **San Diego** and **San Francisco**, using each city's open crime data together with U.S. Census socioeconomic data.

## Repository layout

```
├─ backend/     data pipeline (Python) + datasets → builds backend/data/crime.db
│  ├─ pipeline/      cleaning and standardizing code
│  ├─ data/          raw/, cleaned/, standardized/ datasets (not in git)
│  ├─ notebooks/     original data exploration
│  └─ DATA_CONTRACT.md   what's in crime.db, for the website
├─ frontend/    website + dashboards (TypeScript), which read crime.db
└─ docs/        project proposal and other write-ups
```

Open this folder (`BDA594-Group-Project/`) in VS Code. The shared `.vscode/settings.json` points Python and notebooks at `backend/.venv`.

## Quick start

1. **Build the database.** Follow [backend/README.md](backend/README.md):

   ```bash
   cd backend
   uv venv && uv pip install -e ".[dev,notebook]" && source .venv/bin/activate
   # put the raw city exports in backend/data/raw/ (see backend/data/README.md)
   crime-pipeline all
   ```

2. **Build the site.** See [frontend/README.md](frontend/README.md) and [backend/DATA_CONTRACT.md](backend/DATA_CONTRACT.md).

## Data at a glance

| City | Source | Coverage | Location detail |
|---|---|---|---|
| Los Angeles | LAPD NIBRS Victims | Mar 2024 – present (full volume from Jan 2025) | 21 LAPD areas |
| San Diego | SDPD NIBRS offenses | 2020 – present | Coordinates, ZIP, 9 divisions |
| San Francisco | SFPD Incident Reports | 2018 – present | Coordinates, ZIP, 10 districts |

All three are mapped onto 17 shared crime categories in six groups: Violent, Property, Vehicle, Society, Other and Non-Crime. See [the data contract](backend/DATA_CONTRACT.md) for details and known limitations.

## Team

Matthew Tu (coordinator) · Christian Byars · Sam Jackowski · Renton McGregor

## License

[MIT](LICENSE)
