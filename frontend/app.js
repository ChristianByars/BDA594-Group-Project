import * as L from 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js';

// Everything the page shows comes from these files, written by `crime-pipeline export`.
const DATA_DIR = 'data/';

// Sequential blue ramp, light (few offenses) to dark (many).
const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const NO_DATA_COLOR = '#d1d5db';

const THEMES = {
  light: {
    series: '#2a78d6',
    text: '#374151',
    grid: '#e5e7eb',
    outline: '#4b5563',
    tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  },
  dark: {
    series: '#3987e5',
    text: '#e5e7eb',
    grid: '#374151',
    outline: '#d1d5db',
    tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  },
};

const elements = Object.fromEntries([
  'sidebar', 'mobileOverlay', 'mobileFilterBtn', 'closeSidebarBtn', 'themeToggle', 'themeToggleText',
  'filters', 'citySelect', 'groupSelect', 'startMonth', 'endMonth', 'measureField', 'measureSelect',
  'status', 'dashboardTitle', 'dashboardMeta', 'mapTitle', 'mapNote', 'mapChart', 'trendChart',
].map((id) => [id, document.getElementById(id)]));

const data = {};
let map = null;
let tileLayer = null;
let areaLayer = null;
let districtLayer = null;
let legend = null;

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

function formatNumber(value, digits = 0) {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function formatRate(value) {
  return formatNumber(value, value < 1 ? 2 : 1);
}

function formatMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function currentFilters() {
  return {
    city: elements.citySelect.value,
    group: elements.groupSelect.value,
    start: elements.startMonth.value,
    end: elements.endMonth.value,
    measure: elements.measureSelect.value,
  };
}

/** True when a count row belongs to the selected city, months and crime group. */
function isSelected(row, group, filters) {
  return row.city === filters.city
    && row.month >= filters.start && row.month <= filters.end
    && (!filters.group || group === filters.group);
}

function selectedMonths(filters) {
  return data.months.filter((month) => month >= filters.start && month <= filters.end);
}

function monthlyTrend(filters) {
  const totals = Object.fromEntries(selectedMonths(filters).map((month) => [month, 0]));
  for (const row of data.zipMonthly) {
    if (isSelected(row, row.group, filters)) totals[row.month] += row.count;
  }
  return totals;
}

/** Offenses per ZIP for the selection. Every ZIP in the city's data is listed, at 0 if none match. */
function zipCounts(filters) {
  const counts = {};
  for (const row of data.zipMonthly) {
    if (row.city !== filters.city || row.zip === null) continue;
    counts[row.zip] ??= 0;
    if (isSelected(row, row.group, filters)) counts[row.zip] += row.count;
  }
  return counts;
}

function areaCounts(filters) {
  const counts = Object.fromEntries(data.lapdAreas.map((area) => [area.name, 0]));
  for (const row of data.divisionMonthly) {
    if (row.division in counts && isSelected(row, data.groupOf[row.category], filters)) counts[row.division] += row.count;
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

function drawZipMap(filters) {
  const counts = zipCounts(filters);
  const valueOf = (zip) => (filters.measure === 'rate' ? perThousand(counts[zip], data.socio[zip]) : counts[zip]);
  // properties.city marks ZIPs overlapping the city's map box; the rest are out-of-area addresses.
  const features = data.zipShapes.features.filter(
    (feature) => feature.properties.city === filters.city && feature.properties.ZIP_CODE in counts,
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
  updateLegend(breaks, values, filters.measure);

  if (filters.city === 'SF') {
    districtLayer = L.geoJSON(data.sfDistricts, {
      interactive: false,
      style: { color: THEMES[currentTheme()].outline, weight: 2, dashArray: '5 4', fill: false },
    }).addTo(map);
  }
  const notes = ['Each ZIP is shaded by the selected measure. Hover a ZIP for its crime and socioeconomic values.',
    'ZIPs outside the city area are left off the map but still count in the totals.'];
  if (filters.city === 'SF') notes.push('Dashed lines are the current SFPD districts.');
  if (filters.measure === 'rate') notes.push('Rates use each ZIP\'s most recent population estimate.');
  elements.mapNote.textContent = notes.join(' ');
}

function drawAreaMap(filters) {
  const counts = areaCounts(filters);
  const largest = Math.max(1, ...Object.values(counts));
  const markers = data.lapdAreas.map((area) => {
    const count = counts[area.name];
    // Circle area, not radius, is proportional to the count.
    const radius = 4 + 26 * Math.sqrt(count / largest);
    return L.circleMarker([area.lat, area.lon], {
      radius,
      color: '#ffffff',
      weight: 2,
      fillColor: THEMES[currentTheme()].series,
      fillOpacity: 0.8,
    }).bindTooltip(`<b>${area.full_name}</b><br>${area.bureau} Bureau<br>Offenses: ${formatNumber(count)}`);
  });
  areaLayer = L.layerGroup(markers).addTo(map);
  legend.getContainer().innerHTML = '';
  elements.mapNote.textContent = 'LAPD reports locations by area only, so each circle sits at an area\'s center. '
    + 'Circle size shows the offense count.';
}

function drawMap(filters) {
  for (const layer of [areaLayer, districtLayer]) {
    if (layer) map.removeLayer(layer);
  }
  areaLayer = null;
  districtLayer = null;
  if (filters.city === 'LA') drawAreaMap(filters);
  else drawZipMap(filters);
}

function drawTrend(trend, cityName) {
  const theme = THEMES[currentTheme()];
  const months = Object.keys(trend);
  const trace = {
    x: months.map((month) => `${month}-01`),
    y: Object.values(trend),
    type: 'scatter',
    mode: 'lines+markers',
    line: { color: theme.series, width: 2 },
    marker: { color: theme.series, size: 8 },
    name: cityName,
    hovertemplate: '%{x|%b %Y}: %{y:,} offenses<extra></extra>',
  };
  const layout = {
    margin: { t: 16, r: 16, b: 48, l: 64 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: theme.text },
    hovermode: 'x',
    xaxis: { type: 'date', tickformat: '%b %Y', gridcolor: theme.grid, showspikes: true, spikemode: 'across', spikethickness: 1 },
    yaxis: { title: { text: 'Offenses' }, rangemode: 'tozero', gridcolor: theme.grid, tickformat: ',' },
  };
  Plotly.react(elements.trendChart, [trace], layout, { responsive: true, displayModeBar: false });
}

function render() {
  const filters = currentFilters();
  const city = data.cities[filters.city];
  elements.measureField.hidden = filters.city === 'LA';

  const trend = monthlyTrend(filters);
  const total = Object.values(trend).reduce((sum, count) => sum + count, 0);
  const groupLabel = filters.group || 'All crime groups';
  elements.dashboardTitle.textContent = `${city.name}: ${groupLabel}`;
  elements.dashboardMeta.textContent = `${formatMonth(filters.start)} – ${formatMonth(filters.end)} · `
    + `${formatNumber(total)} offenses · data through ${city.last_date}, so the latest month may be partial`;
  elements.mapTitle.textContent = filters.city === 'LA' ? 'Offenses by LAPD area' : 'Offenses by ZIP code';

  drawMap(filters);
  drawTrend(trend, city.name);
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  elements.themeToggleText.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  if (tileLayer) tileLayer.setUrl(THEMES[theme].tiles);
}

function setSidebarOpen(open) {
  elements.sidebar.classList.toggle('mobile-open', open);
  elements.mobileOverlay.classList.toggle('mobile-open', open);
}

function fillSelect(select, options) {
  select.append(...options.map(({ value, label }) => new Option(label, value)));
}

function setUpFilters() {
  fillSelect(elements.citySelect, Object.entries(data.cities).map(([code, city]) => ({ value: code, label: city.name })));
  elements.citySelect.value = 'SD';
  map.fitBounds(data.cities.SD.bounds);

  const groups = [...new Set(data.categories.map((category) => category.group))].filter((group) => group !== 'Non-Crime');
  fillSelect(elements.groupSelect, groups.map((group) => ({ value: group, label: group })));

  const monthOptions = data.months.map((month) => ({ value: month, label: formatMonth(month) }));
  fillSelect(elements.startMonth, monthOptions);
  fillSelect(elements.endMonth, monthOptions);
  elements.startMonth.value = data.months[0];
  elements.endMonth.value = data.months[data.months.length - 1];

  elements.filters.addEventListener('change', (event) => {
    // Keep the range valid by moving the other end when the two cross.
    if (elements.startMonth.value > elements.endMonth.value) {
      if (event.target === elements.startMonth) elements.endMonth.value = elements.startMonth.value;
      else elements.startMonth.value = elements.endMonth.value;
    }
    if (event.target === elements.citySelect) map.fitBounds(data.cities[elements.citySelect.value].bounds);
    render();
  });
}

async function init() {
  setTheme('light');
  elements.themeToggle.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    if (data.months) render();
  });
  elements.mobileFilterBtn.addEventListener('click', () => setSidebarOpen(true));
  elements.closeSidebarBtn.addEventListener('click', () => setSidebarOpen(false));
  elements.mobileOverlay.addEventListener('click', () => setSidebarOpen(false));

  map = L.map(elements.mapChart).setView([36.78, -119.42], 6);
  tileLayer = L.tileLayer(THEMES.light.tiles, { attribution: 'Tiles &copy; Esri', maxZoom: 16 }).addTo(map);
  legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => L.DomUtil.create('div', 'map-legend');
  legend.addTo(map);

  try {
    const [metadata, categories, lapdAreas, zipMonthly, divisionMonthly, socioText, zipShapes, sfDistricts] = await Promise.all([
      'metadata.json', 'crime_categories.json', 'lapd_areas.json', 'zip_monthly.json', 'division_monthly.json',
      'socioeconomic.csv', 'zip_codes.geojson', 'sfpd_districts.geojson',
    ].map(fetchData));
    Object.assign(data, { categories, lapdAreas, zipMonthly, divisionMonthly, zipShapes, sfDistricts });
    data.cities = Object.fromEntries(metadata.cities.map((city) => [city.city, city]));
    data.groupOf = Object.fromEntries(categories.map((category) => [category.category, category.group]));
    data.socio = latestSocioeconomic(socioText);
    data.months = [...new Set(zipMonthly.map((row) => row.month))].sort();

    setUpFilters();
    render();
    elements.status.textContent = `Data exported ${metadata.exported_at.slice(0, 10)} from crime.db built ${metadata.database_built_at.slice(0, 10)}.`;
  } catch (error) {
    console.error(error);
    elements.status.textContent = `Error loading data: ${error.message}`;
    elements.status.classList.add('error');
  }
}

init();
