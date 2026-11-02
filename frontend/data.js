// Loads the files written by `crime-pipeline export` and prepares lookups the tabs share.

const DATA_DIR = 'data/';
const DAY_MS = 86400000;

async function fetchData(name) {
  const response = await fetch(DATA_DIR + name);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return name.endsWith('.csv') ? response.text() : response.json();
}

// Census marks unavailable medians with large negative numbers; treat them as missing.
function toNumber(text) {
  if (text === undefined || text.trim() === '') return null;
  const value = Number(text);
  return value < 0 ? null : value;
}

/** Most recent socioeconomic row per ZIP: { zip: { Year, Total_Population, ... } }. */
function latestSocioeconomic(csvText) {
  const [header, ...lines] = csvText.trim().split(/\r?\n/);
  const columns = header.split(',');
  const latest = {};
  for (const line of lines) {
    const values = line.split(',');
    const row = Object.fromEntries(columns.map((column, i) => [column, column === 'Zip_Code' ? values[i] : toNumber(values[i])]));
    const current = latest[row.Zip_Code];
    if (!current || row.Year > current.Year) latest[row.Zip_Code] = row;
  }
  return latest;
}

/** { city code: { year: population } } from city_population.json. */
function populationsByCity(rows) {
  const populations = {};
  for (const row of rows) {
    populations[row.city] ??= {};
    populations[row.city][row.year] = row.population;
  }
  return populations;
}

/**
 * Every file the page uses, plus lookups built from them:
 * cities (code -> metadata entry), groupOf (category -> group), socio (ZIP -> latest row),
 * areaSocio (LAPD area name -> census estimates), populations (code -> year -> population),
 * timedCities (codes that record the time of day).
 */
export async function loadData() {
  const files = [
    'metadata.json', 'crime_categories.json', 'zip_monthly.json', 'division_monthly.json',
    'daily_counts.json', 'hourly_counts.json', 'city_population.json', 'socioeconomic.csv', 'zip_codes.geojson',
    'sfpd_districts.geojson', 'lapd_divisions.geojson', 'lapd_area_socioeconomic.json',
  ];
  const [metadata, categories, zipMonthly, divisionMonthly, dailyCounts, hourlyCounts, cityPopulation,
    socioText, zipShapes, sfDistricts, lapdDivisions, areaEstimates] = await Promise.all(files.map(fetchData));
  return {
    metadata,
    categories,
    zipMonthly,
    divisionMonthly,
    dailyCounts,
    hourlyCounts,
    timedCities: new Set(hourlyCounts.map((row) => row.city)),
    zipShapes,
    sfDistricts,
    lapdDivisions,
    areaSocio: Object.fromEntries(areaEstimates.map((estimate) => [estimate.area_name, estimate])),
    cities: Object.fromEntries(metadata.cities.map((city) => [city.city, city])),
    groupOf: Object.fromEntries(categories.map((category) => [category.category, category.group])),
    socio: latestSocioeconomic(socioText),
    populations: populationsByCity(cityPopulation),
  };
}

/** The city's population in a year. Years after the newest estimate use the newest one (2026 uses 2025). */
export function populationFor(data, city, year) {
  const byYear = data.populations[city];
  const newestYear = Math.max(...Object.keys(byYear).map(Number));
  return byYear[Math.min(year, newestYear)];
}

/** ISO date `days` after (or before, if negative) an ISO date. */
export function addDays(isoDate, days) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Every ISO date from start to end, inclusive. */
export function datesBetween(start, end) {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}
