"""Build a standardized LA / San Diego / San Francisco crime database from raw city exports.

Pipeline steps (each is a `crime-pipeline` subcommand):
    fetch-boundaries  download SF district / ZIP boundary files (one time)
    clean             raw/ -> cleaned/        each city's own columns, parsed and typed
    standardize       cleaned/ -> standardized/  shared layout, categories, geography
    check             quality checks on standardized/
    load              standardized/ -> crime.db (SQLite)
    export            crime.db -> frontend/data/ (web data bundle + compatibility report)
    all               clean, standardize, check, load, export
"""

__version__ = "1.0.0"
