"""Command line entry point: `crime-pipeline <step>` (or `python -m crime_pipeline <step>`)."""

import argparse
import sys
import time

from crime_pipeline import checks, geo, load, standardize
from crime_pipeline.config import get_paths
from crime_pipeline.standardize import ALL_CITIES


def cmd_fetch_boundaries(paths, args):
    geo.fetch_boundaries(paths)


def cmd_clean(paths, args):
    standardize.clean(paths, cities=args.cities)


def cmd_standardize(paths, args):
    standardize.standardize(paths, cities=args.cities)


def cmd_check(paths, args):
    return 1 if checks.run(paths) else 0


def cmd_load(paths, args):
    load.run(paths)


def cmd_all(paths, args):
    print("== clean")
    standardize.clean(paths)
    print("\n== standardize")
    standardize.standardize(paths)
    print("\n== check")
    if checks.run(paths):
        print("\nChecks failed; database not rebuilt.")
        return 1
    print("\n== load")
    load.run(paths)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="crime-pipeline", description=__doc__)
    parser.add_argument("--data-dir", help="data folder (default: $CRIME_DATA_DIR or backend/data/)")
    steps = parser.add_subparsers(dest="step", required=True)

    steps.add_parser("fetch-boundaries", help="download SF district and ZIP boundary files (one time)") \
        .set_defaults(func=cmd_fetch_boundaries)
    for name, func, help_text in [("clean", cmd_clean, "raw/ -> cleaned/ (each city's own columns)"),
                                  ("standardize", cmd_standardize, "cleaned/ -> standardized/ (shared layout)")]:
        step = steps.add_parser(name, help=help_text)
        step.add_argument("--cities", nargs="+", choices=ALL_CITIES, default=list(ALL_CITIES))
        step.set_defaults(func=func)
    steps.add_parser("check", help="quality checks on standardized/").set_defaults(func=cmd_check)
    steps.add_parser("load", help="standardized/ -> crime.db (SQLite)").set_defaults(func=cmd_load)
    steps.add_parser("all", help="clean, standardize, check, then load").set_defaults(func=cmd_all)

    args = parser.parse_args(argv)
    paths = get_paths(args.data_dir)
    print(f"Data folder: {paths.data_dir}\n")

    started = time.perf_counter()
    status = args.func(paths, args) or 0
    print(f"\nDone in {time.perf_counter() - started:,.0f}s")
    sys.exit(status)
