# Frontend

This folder is a placeholder for the website and dashboard. The framework hasn't been chosen yet.

## The data

All crime data comes from one read-only SQLite file built by the backend:

```
backend/data/crime.db
```

- **What's in it:** [backend/DATA_CONTRACT.md](../backend/DATA_CONTRACT.md) lists every table and column, which cities fill each column, the default filters for fair city comparisons, a TypeScript connection example and sample queries.
- **How to build it:** follow [backend/README.md](../backend/README.md) (`crime-pipeline all`). The file isn't in git; it's about 1.3 GB and rebuilt in about 2.5 minutes.

## Notes for building on it

- Open the database **read-only**. The website should never write to it.
- Use `daily_counts` for charts. It's pre-aggregated and fast. Use `offenses` only for row-level detail such as maps and drill-downs.
- Compare cities with `crime_category` and `crime_group`, not the city-specific `nibrs_*` or `source_*` columns.
- Read the "Known limitations" section of the data contract before choosing which comparisons to show. In particular, LA only includes offenses that have a victim.
