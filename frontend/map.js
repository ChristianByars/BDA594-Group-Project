// Map tab: one city at a time. SD and SF are shaded by ZIP; LA gets one circle per LAPD area.

import * as L from 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js';

import { THEMES, currentTheme, formatMonth, formatNumber, formatRate, themeColors } from './display.js';
import { categoryMatches, filters, groupMatches, selectedGroup } from './filters.js';

// Sequential blue ramp, light (few offenses) to dark (many).
const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const NO_DATA_COLOR = '#d1d5db';

const elements = Object.fromEntries([
  'mapControls', 'mapCity', 'mapMeasureField', 'mapMeasure', 'mapTitle', 'mapNote', 'mapChart',
].map((id) => [id, document.getElementById(id)]));

let map = null;
let tileLayer = null;
let areaLayer = null;
let districtLayer = null;
let legend = null;
let shownCity = null;

/** The map works in whole months: every month the date range touches. */
function selectedMonths() {
  return { start: filters.start.slice(0, 7), end: filters.end.slice(0, 7) };
}

function inMonths(row, months) {
  return row.month >= months.start && row.month <= months.end;
}

/** Offenses per ZIP for the selection. Every ZIP in the city's data is listed, at 0 if none match. */
function zipCounts(data, city, months) {
  const counts = {};
  for (const row of data.zipMonthly) {
    if (row.city !== city || row.zip === null) continue;
    counts[row.zip] ??= 0;
    if (inMonths(row, months) && groupMatches(data, row.group)) counts[row.zip] += row.count;
  }
  return counts;
}

function areaCounts(data, months) {
  const counts = Object.fromEntries(data.lapdAreas.map((area) => [area.name, 0]));
  for (const row of data.divisionMonthly) {
    if (row.city === 'LA' && row.division in counts && inMonths(row, months) && categoryMatches(data, row.category)) {
      counts[row.division] += row.count;
    }
  }
  return counts;
}

function perThousand(count, socio) {
  const population = socio?.Total_Population;
  return population ? (count * 1000) / population : null;
}

/** Quantile class breaks: up to classes - 1 distinct lower bounds. */
function quantileBreaks(values, classes) {
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

function updateLegend(breaks, values, measure) {
  const format = measure === 'rate' ? formatRate : formatNumber;
  const known = values.filter((value) => value !== null);
  const bounds = [Math.min(...known), ...breaks, Math.max(...known)];
  const rows = breaks.length + 1;
  const items = [];
  for (let i = 0; i < rows; i += 1) {
    const range = `${format(bounds[i])} – ${format(bounds[i + 1])}`;
    items.push(`<div><span class="legend-swatch" style="background:${classColor(i, rows)}"></span>${range}</div>`);
  }
  if (known.length < values.length) {
    items.push(`<div><span class="legend-swatch" style="background:${NO_DATA_COLOR}"></span>No residents or no population data</div>`);
  }
  const title = measure === 'rate' ? 'Offenses per 1,000 residents' : 'Offenses';
  legend.getContainer().innerHTML = known.length ? `<strong>${title}</strong>${items.join('')}` : '';
}

function zipTooltip(zip, placeName, count, socio) {
  const lines = [`<b>ZIP ${zip}</b>${placeName ? ` · ${placeName}` : ''}`, `Offenses: ${formatNumber(count)}`];
  const rate = perThousand(count, socio);
  if (rate !== null) lines.push(`Per 1,000 residents: ${formatRate(rate)}`);
  if (!socio) return [...lines, 'No socioeconomic data'].join('<br>');
  const show = (label, value, format) => lines.push(`${label}: ${value === null ? 'n/a' : format(value)}`);
  show(`Population (${socio.Year})`, socio.Total_Population, (value) => formatNumber(value));
  show('Median household income', socio.Median_Household_Income, (value) => `$${formatNumber(value)}`);
  show('Median home value', socio.Median_Home_Value, (value) => `$${formatNumber(value)}`);
  show('Poverty rate', socio.Poverty_Rate, (value) => `${formatNumber(value, 1)}%`);
  return lines.join('<br>');
}

function drawZipMap(data, city, months, measure) {
  const counts = zipCounts(data, city, months);
  const valueOf = (zip) => (measure === 'rate' ? perThousand(counts[zip], data.socio[zip]) : counts[zip]);
  // properties.city marks ZIPs overlapping the city's map box; the rest are out-of-area addresses.
  const features = data.zipShapes.features.filter(
    (feature) => feature.properties.city === city && feature.properties.ZIP_CODE in counts,
  );
  const values = features.map((feature) => valueOf(feature.properties.ZIP_CODE));
  const breaks = quantileBreaks(values, SEQUENTIAL.length);

  areaLayer = L.geoJSON(features, {
    style: (feature) => ({
      fillColor: colorFor(valueOf(feature.properties.ZIP_CODE), breaks),
      fillOpacity: 0.75,
      color: '#ffffff',
      weight: 1,
    }),
    onEachFeature: (feature, layer) => {
      const zip = feature.properties.ZIP_CODE;
      layer.bindTooltip(zipTooltip(zip, feature.properties.PO_NAME, counts[zip], data.socio[zip]), { sticky: true });
    },
  }).addTo(map);
  updateLegend(breaks, values, measure);

  if (city === 'SF') {
    districtLayer = L.geoJSON(data.sfDistricts, {
      interactive: false,
      style: { color: themeColors().outline, weight: 2, dashArray: '5 4', fill: false },
    }).addTo(map);
  }
  const notes = ['Each ZIP is shaded by the selected measure. Hover a ZIP for its crime and socioeconomic values.',
    'ZIPs outside the city area are left off the map but still count in the totals.'];
  if (filters.category) {
    notes.push(`ZIP counts are kept by crime group, so the map shows all ${selectedGroup(data)} offenses, not only ${filters.category}.`);
  }
  if (city === 'SF') notes.push('Dashed lines are the current SFPD districts.');
  if (measure === 'rate') notes.push('Rates use each ZIP\'s most recent population estimate.');
  return notes;
}

function drawAreaMap(data, months) {
  const counts = areaCounts(data, months);
  const largest = Math.max(1, ...Object.values(counts));
  const markers = data.lapdAreas.map((area) => {
    const count = counts[area.name];
    // Circle area, not radius, is proportional to the count.
    const radius = 4 + 26 * Math.sqrt(count / largest);
    return L.circleMarker([area.lat, area.lon], {
      radius,
      color: '#ffffff',
      weight: 2,
      fillColor: themeColors().cities.LA,
      fillOpacity: 0.8,
    }).bindTooltip(`<b>${area.full_name}</b><br>${area.bureau} Bureau<br>Offenses: ${formatNumber(count)}`);
  });
  areaLayer = L.layerGroup(markers).addTo(map);
  legend.getContainer().innerHTML = '';
  return ['LAPD reports locations by area only, so each circle sits at an area\'s center.',
    'Circle size shows the offense count.'];
}

/** Keeps the city picker in step with the toggled cities; returns the city to show. */
function syncCityOptions(data) {
  const current = elements.mapCity.value;
  elements.mapCity.replaceChildren(...filters.cities.map((code) => new Option(data.cities[code].name, code)));
  elements.mapCity.value = filters.cities.includes(current) ? current : filters.cities[0];
  return elements.mapCity.value;
}

/** Draws the map for the picked city from the shared filters and the map's own measure. */
export function renderMap(data) {
  const city = syncCityOptions(data);
  const measure = city === 'LA' ? 'count' : elements.mapMeasure.value;
  elements.mapMeasureField.hidden = city === 'LA';
  map.invalidateSize();
  if (city !== shownCity) {
    map.fitBounds(data.cities[city].bounds);
    shownCity = city;
  }

  for (const layer of [areaLayer, districtLayer]) {
    if (layer) map.removeLayer(layer);
  }
  areaLayer = null;
  districtLayer = null;

  const months = selectedMonths();
  const notes = city === 'LA' ? drawAreaMap(data, months) : drawZipMap(data, city, months, measure);
  notes.push(`Map counts use whole months: ${formatMonth(months.start)} – ${formatMonth(months.end)}.`);
  elements.mapTitle.textContent = city === 'LA' ? 'Los Angeles offenses by LAPD area' : `${data.cities[city].name} offenses by ZIP code`;
  elements.mapNote.textContent = notes.join(' ');
}

/** Refits the map to its container, which has no size while the tab is hidden. */
export function resizeMap() {
  map.invalidateSize();
}

/** Swaps the base map tiles for the theme. */
export function setMapTheme(theme) {
  if (tileLayer) tileLayer.setUrl(THEMES[theme].tiles);
}

/** Creates the Leaflet map and re-renders it when the tab's own controls change. */
export function setUpMap(data) {
  // No initial view: the first render fits the map to the city, so no tiles load while the tab is hidden.
  map = L.map(elements.mapChart);
  tileLayer = L.tileLayer(THEMES[currentTheme()].tiles, { attribution: 'Tiles &copy; Esri', maxZoom: 16 }).addTo(map);
  legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => L.DomUtil.create('div', 'map-legend');
  legend.addTo(map);
  elements.mapControls.addEventListener('change', () => renderMap(data));
}
