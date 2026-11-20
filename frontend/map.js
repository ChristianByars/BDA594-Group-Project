// Map tab: one panel per toggled city, in order LA, SD, SF. SD and SF are shaded by ZIP; LA by LAPD area.

import * as L from 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js';

import { PER_RESIDENTS } from './data.js';
import { THEMES, currentTheme, escapeHtml, formatMonth, formatNumber, formatRate, themeColors } from './display.js';
import { categoryMatches, filters } from './filters.js';

// Sequential blue ramp, light (few offenses) to dark (many).
const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const NO_DATA_COLOR = '#d1d5db';

const elements = Object.fromEntries([
  'mapNote', 'mapLegend', 'mapGrid',
].map((id) => [id, document.getElementById(id)]));

// city code -> { section, map, tileLayer, areaLayer, districtLayer, note, fitted }
const panels = {};
let lastVisibleCount = null;

/** The map works in whole months: every month the date range touches. */
function selectedMonths() {
  return { start: filters.start.slice(0, 7), end: filters.end.slice(0, 7) };
}

function inMonths(row, months) {
  return row.month >= months.start && row.month <= months.end;
}

/** Offenses per ZIP for the city and selection. Every ZIP in the rows is listed, at 0 if none match. */
export function zipCounts(rows, city, months, matches) {
  const counts = {};
  for (const row of rows) {
    if (row.city !== city || row.zip === null) continue;
    counts[row.zip] ??= 0;
    if (inMonths(row, months) && matches(row.category)) counts[row.zip] += row.count;
  }
  return counts;
}

/** Offenses per LAPD area for the selection. Every area is listed, at 0 if none match. */
function areaCounts(data, months, matches) {
  const counts = Object.fromEntries(data.lapdDivisions.features.map((feature) => [feature.properties.area_name, 0]));
  for (const row of data.divisionMonthly) {
    if (row.city === 'LA' && row.division in counts && inMonths(row, months) && matches(row.category)) {
      counts[row.division] += row.count;
    }
  }
  return counts;
}

export function perHundredThousand(count, population) {
  return population ? (count * PER_RESIDENTS) / population : null;
}

/** Quantile class breaks: up to classes - 1 distinct lower bounds. */
export function quantileBreaks(values, classes) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const breaks = [];
  for (let i = 1; i < classes; i += 1) breaks.push(sorted[Math.floor((i * sorted.length) / classes)]);
  return [...new Set(breaks)].filter((value) => value > sorted[0]);
}

function classColor(classIndex, classCount) {
  const step = classCount > 1 ? (classIndex * (SEQUENTIAL.length - 1)) / (classCount - 1) : SEQUENTIAL.length - 1;
  return SEQUENTIAL[Math.round(step)];
}

function colorFor(value, breaks) {
  if (value === null) return NO_DATA_COLOR;
  const classIndex = breaks.filter((lowerBound) => value >= lowerBound).length;
  return classColor(classIndex, breaks.length + 1);
}

/** The shared legend, as HTML: one row per quantile class, plus a no-data row if any value is null. */
export function legendHtml({ breaks, values, measure }) {
  const format = measure === 'rate' ? formatRate : formatNumber;
  const known = values.filter((value) => value !== null);
  if (!known.length) return '';
  const bounds = [Math.min(...known), ...breaks, Math.max(...known)];
  const rows = breaks.length + 1;
  const items = [];
  for (let i = 0; i < rows; i += 1) {
    const range = `${format(bounds[i])} – ${format(bounds[i + 1])}`;
    items.push(`<div><span class="legend-swatch" style="--swatch:${classColor(i, rows)}"></span>${range}</div>`);
  }
  if (known.length < values.length) {
    items.push('<div><span class="legend-swatch no-data"></span>No residents or no population data</div>');
  }
  const title = measure === 'rate' ? 'Offenses per 100,000 residents' : 'Offenses';
  return `<strong>${title}</strong>${items.join('')}`;
}

/** Tooltip lines for census values; missing values show as n/a. */
function censusLines(populationLabel, { population, income, homeValue, povertyRate }) {
  const show = (label, value, format) => `${label}: ${value == null ? 'n/a' : format(value)}`;
  const dollars = (value) => `$${formatNumber(value)}`;
  return [
    show(populationLabel, population, formatNumber),
    show('Median household income', income, dollars),
    show('Median home value', homeValue, dollars),
    show('Poverty rate', povertyRate, (value) => `${formatNumber(value, 1)}%`),
  ];
}

function zipTooltip(zip, placeName, count, socio) {
  const lines = [`<b>ZIP ${escapeHtml(zip)}</b>${placeName ? ` · ${escapeHtml(placeName)}` : ''}`, `Offenses: ${formatNumber(count)}`];
  const rate = perHundredThousand(count, socio?.Total_Population);
  if (rate !== null) lines.push(`Per 100,000 residents: ${formatRate(rate)}`);
  if (!socio) return [...lines, 'No socioeconomic data'].join('<br>');
  lines.push(...censusLines(`Population (${socio.Year})`, {
    population: socio.Total_Population,
    income: socio.Median_Household_Income,
    homeValue: socio.Median_Home_Value,
    povertyRate: socio.Poverty_Rate,
  }));
  return lines.join('<br>');
}

/** properties: an LAPD division's properties; estimate: its row of lapd_area_socioeconomic.json, if any. */
function areaTooltip(properties, count, estimate) {
  const lines = [`<b>${escapeHtml(properties.area_full_name)}</b> · ${escapeHtml(properties.bureau)} Bureau`, `Offenses: ${formatNumber(count)}`];
  const rate = perHundredThousand(count, estimate?.population);
  if (rate !== null) lines.push(`Per 100,000 residents: ${formatRate(rate)}`);
  if (!estimate) return [...lines, 'No census estimates'].join('<br>');
  lines.push(`<i>Estimated from ZIPs (${estimate.year}):</i>`, ...censusLines('Population', {
    population: estimate.population,
    income: estimate.median_household_income,
    homeValue: estimate.median_home_value,
    povertyRate: estimate.poverty_rate,
  }));
  return lines.join('<br>');
}

/** Features, value lookup, tooltip lookup and notes for San Diego or San Francisco, shaded by ZIP. */
function zipCityData(data, code, months, matches) {
  const counts = zipCounts(data.zipMonthly, code, months, matches);
  const zipOf = (feature) => feature.properties.ZIP_CODE;
  const valueOf = (feature) => {
    const zip = zipOf(feature);
    return filters.measure === 'rate' ? perHundredThousand(counts[zip], data.socio[zip]?.Total_Population) : counts[zip];
  };
  const tooltipOf = (feature) => {
    const zip = zipOf(feature);
    return zipTooltip(zip, feature.properties.PO_NAME, counts[zip], data.socio[zip]);
  };
  // properties.city marks ZIPs overlapping the city's map box; the rest are out-of-area addresses.
  const features = data.zipShapes.features.filter((feature) => feature.properties.city === code && zipOf(feature) in counts);
  const notes = ['Each ZIP is shaded by the selected measure. Hover a ZIP for its crime and socioeconomic values.',
    'ZIPs outside the city area are left off the map but still count in the totals.'];
  if (code === 'SF') notes.push('Dashed lines are the current SFPD districts.');
  if (filters.measure === 'rate') notes.push('Rates use each ZIP\'s most recent population estimate.');
  return { features, valueOf, tooltipOf, values: features.map(valueOf), notes };
}

/** Features, value lookup, tooltip lookup and notes for Los Angeles, shaded by LAPD area. */
function lapdCityData(data, months, matches) {
  const counts = areaCounts(data, months, matches);
  const nameOf = (feature) => feature.properties.area_name;
  const valueOf = (feature) => {
    const count = counts[nameOf(feature)];
    return filters.measure === 'rate' ? perHundredThousand(count, data.areaSocio[nameOf(feature)]?.population) : count;
  };
  const tooltipOf = (feature) => areaTooltip(feature.properties, counts[nameOf(feature)], data.areaSocio[nameOf(feature)]);
  const features = data.lapdDivisions.features;
  const notes = [
    'LAPD reports crime locations by area only, so each of its 21 areas is shaded by the selected measure.',
    'Hover an area for its offenses and census values.',
    'An area\'s population, income, home value and poverty rate are estimated from ZIP data:',
    'each ZIP overlapping the area counts in proportion to the share of the ZIP\'s area inside it, as if residents were spread evenly.',
  ];
  if (filters.measure === 'rate') notes.push('Rates use each area\'s estimated population.');
  return { features, valueOf, tooltipOf, values: features.map(valueOf), notes };
}

/** Creates a city's panel once: heading, note and its own Leaflet map. Returns the cached panel on later calls. */
function ensurePanel(data, code) {
  if (panels[code]) return panels[code];
  const section = document.createElement('section');
  section.className = 'map-city';
  section.dataset.city = code;

  const title = document.createElement('h3');
  title.className = 'map-city-title';
  title.textContent = `${data.cities[code].name} · ${code === 'LA' ? 'LAPD areas' : 'ZIP codes'}`;

  const note = document.createElement('p');
  note.className = 'map-city-note';

  const chart = document.createElement('div');
  chart.className = 'map-chart chart';

  section.append(title, note, chart);
  elements.mapGrid.append(section);

  const map = L.map(chart);
  const tileLayer = L.tileLayer(THEMES[currentTheme()].tiles, { attribution: 'Tiles &copy; Esri', maxZoom: 16 }).addTo(map);

  panels[code] = { section, map, tileLayer, areaLayer: null, districtLayer: null, note, fitted: false };
  return panels[code];
}

function paintPanel(panel, { features, valueOf, tooltipOf }, breaks) {
  if (panel.areaLayer) panel.map.removeLayer(panel.areaLayer);
  panel.areaLayer = L.geoJSON(features, {
    style: (feature) => ({ fillColor: colorFor(valueOf(feature), breaks), fillOpacity: 0.75, color: '#ffffff', weight: 1 }),
    onEachFeature: (feature, layer) => layer.bindTooltip(tooltipOf(feature), { sticky: true }),
  }).addTo(panel.map);
}

/** Draws every visible city's panel from the shared filters, with one pooled color scale and legend. */
export function renderMap(data) {
  const order = Object.keys(data.cities);
  const visible = order.filter((code) => filters.cities.includes(code));
  elements.mapGrid.style.setProperty('--cities', String(visible.length));
  const countChanged = visible.length !== lastVisibleCount;
  lastVisibleCount = visible.length;

  const months = selectedMonths();
  const matches = (category) => categoryMatches(data, category);
  const cityData = {};

  for (const code of order) {
    const panel = ensurePanel(data, code);
    const show = visible.includes(code);
    panel.section.hidden = !show;
    if (!show) continue;
    panel.map.invalidateSize();
    if (!panel.fitted || countChanged) {
      panel.map.fitBounds(data.cities[code].bounds);
      panel.fitted = true;
    }
    cityData[code] = code === 'LA' ? lapdCityData(data, months, matches) : zipCityData(data, code, months, matches);
  }

  const pooled = visible.flatMap((code) => cityData[code].values);
  const breaks = quantileBreaks(pooled, SEQUENTIAL.length);

  for (const code of visible) {
    const panel = panels[code];
    paintPanel(panel, cityData[code], breaks);
    if (code === 'SF') {
      if (panel.districtLayer) panel.map.removeLayer(panel.districtLayer);
      panel.districtLayer = L.geoJSON(data.sfDistricts, {
        interactive: false,
        style: { color: themeColors().outline, weight: 2, dashArray: '5 4', fill: false },
      }).addTo(panel.map);
    }
    panel.note.textContent = cityData[code].notes.join(' ');
  }

  elements.mapLegend.innerHTML = legendHtml({ breaks, values: pooled, measure: filters.measure });

  const sharedNotes = [`Map counts use whole months: ${formatMonth(months.start)} – ${formatMonth(months.end)}.`];
  if (filters.measure === 'count' && visible.length >= 2) {
    sharedNotes.push('Counts are not comparable across cities: an LAPD area is a much larger unit than a ZIP. Choose "Per 100,000 residents" to compare.');
  }
  elements.mapNote.textContent = sharedNotes.join(' ');
}

/** Refits every visible panel to its container, which has no size while the tab is hidden. */
export function resizeMap() {
  for (const panel of Object.values(panels)) if (!panel.section.hidden) panel.map.invalidateSize();
}

/** Swaps the base map tiles for the theme, on every panel. */
export function setMapTheme(theme) {
  for (const panel of Object.values(panels)) panel.tileLayer.setUrl(THEMES[theme].tiles);
}

/** No controls to wire; panels are created lazily by renderMap. */
export function setUpMap() {}
