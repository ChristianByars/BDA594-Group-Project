"""The clean and standardize steps, run city by city.

clean:       raw/          -> cleaned/       each city's own columns, parsed and typed
standardize: cleaned/      -> standardized/  shared layout + categories + geography (enrich.py)
"""

from crime_pipeline import enrich
from crime_pipeline.cities import la, sd, sf
from crime_pipeline.common import OUTPUT_FILES

CITY_MODULES = {"LA": la, "SD": sd, "SF": sf}
ALL_CITIES = ("LA", "SD", "SF")


def write(df, folder, name):
    folder.mkdir(parents=True, exist_ok=True)
    df.to_csv(folder / name, index=False)
    print(f"Saved {len(df):>9,} rows to {folder.name}/{name}")


def clean(paths, cities=ALL_CITIES):
    for city in cities:
        for name, df in CITY_MODULES[city].clean(paths).items():
            write(df, paths.cleaned_dir, name)


def standardize(paths, cities=ALL_CITIES):
    for city in cities:
        offenses, extras = CITY_MODULES[city].standardize(paths)
        write(enrich.apply(offenses, city, paths), paths.standardized_dir, OUTPUT_FILES[city])
        for name, df in extras.items():
            write(df, paths.standardized_dir, name)
