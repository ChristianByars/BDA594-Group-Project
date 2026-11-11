// Correlation tab: for each city, reported crime per 100,000 residents plotted against one
// socioeconomic factor. SD and SF have a point per ZIP code; LA has one per LAPD area, because
// LAPD reports where crimes happened by area only.

import { baseLayout, currentTheme, drawChart, formatMonth, formatNumber, themeColors } from './display.js';
import { UNRELIABLE_LA_GROUPS, categoryMatches, filters, groupMatches, selectedGroup } from './filters.js';
import { createPills } from './pills.js';

const PER_RESIDENTS = 100000;
// A rate over a handful of residents swings wildly (a business district with 500 residents can
// show 130,000 offenses per 100,000), so smaller places are left off the plots.
const MIN_POPULATION = 1000;

/**
 * The socioeconomic factors on the x-axis. `zipField` is the column in socioeconomic.csv and
 * `areaField` the key in lapd_area_socioeconomic.json; hover is the Plotly format for the x value.
 */
const FACTORS = {
  poverty: {
    label: 'Poverty rate', axis: 'Poverty rate', short: 'poverty rate',
    zipField: 'Poverty_Rate', areaField: 'poverty_rate',
    axisFormat: { tickformat: '.0f', ticksuffix: '%' }, hover: '%{x:.1f}%',
  },
  income: {
    label: 'Median household income', axis: 'Median household income', short: 'median household income',
    zipField: 'Median_Household_Income', areaField: 'median_household_income',
    axisFormat: { tickformat: ',.0f', tickprefix: '$' }, hover: '$%{x:,.0f}',
  },
  homeValue: {
    label: 'Median home price', axis: 'Median home price (Census median home value)', short: 'median home value',
    zipField: 'Median_Home_Value', areaField: 'median_home_value',
    axisFormat: { tickformat: ',.0f', tickprefix: '$' }, hover: '$%{x:,.0f}',
  },
};

const elements = Object.fromEntries([
  'correlationFactor', 'correlationScale', 'correlationNote', 'correlationCharts',
].map((id) => [id, document.getElementById(id)]));

let factorPills = null;
let scalePills = null;
// What the charts on screen were drawn from. The tab ignores the Measure filter, so a Measure
// change leaves this the same and the charts are left alone.
let drawnKey = null;
// One block (heading, chart, note) per city, kept between renders so Plotly can redraw in place.
const blocks = new Map();

/** The date range as whole months, like the map: every month the range touches. */
function selectedMonths() {
  return { start: filters.start.slice(0, 7), end: filters.end.slice(0, 7) };
}

function inMonths(row, months) {
  return row.month >= months.start && row.month <= months.end;
}

/** Raw points for a ZIP-based city (SD, SF): one per ZIP inside the city's map area. */
function zipPoints(data, city, months, factor) {
  const counts = {};
  for (const row of data.zipMonthly) {
    if (row.city !== city || row.zip === null) continue;
    counts[row.zip] ??= 0;
    if (inMonths(row, months) && groupMatches(data, row.group)) counts[row.zip] += row.count;
  }
  // properties.city marks ZIPs inside the city's map area; the rest are out-of-area addresses.
  return data.zipShapes.features
    .filter((feature) => feature.properties.city === city && feature.properties.ZIP_CODE in counts)
    .map((feature) => {
      const zip = feature.properties.ZIP_CODE;
      const socio = data.socio[zip];
      return {
        label: `ZIP ${zip} · ${feature.properties.PO_NAME}`,
        count: counts[zip],
        population: socio?.Total_Population ?? null,
        x: socio?.[factor.zipField] ?? null,
      };
    });
}

/** Raw points for LA: one per LAPD area, using the census estimates built from ZIP data. */
function areaPoints(data, months, factor) {
  const counts = Object.fromEntries(Object.keys(data.areaSocio).map((name) => [name, 0]));
  for (const row of data.divisionMonthly) {
    if (row.city === 'LA' && row.division in counts && inMonths(row, months) && categoryMatches(data, row.category)) {
      counts[row.division] += row.count;
    }
  }
  return Object.entries(data.areaSocio).map(([name, estimate]) => ({
    label: `${name} area`,
    count: counts[name],
    population: estimate.population ?? null,
    x: estimate[factor.areaField] ?? null,
  }));
}

/**
 * The points a city's scatterplot draws, for the shared filters and one factor.
 * Returns { points: [{ label, x, y, count, population }], unit, tooSmall, noValue }, where tooSmall and
 * noValue count the places left off for having too few residents or no value for the factor.
 */
export function correlationPoints(data, city, factorKey) {
  const factor = FACTORS[factorKey];
  const months = selectedMonths();
  const raw = city === 'LA' ? areaPoints(data, months, factor) : zipPoints(data, city, months, factor);
  const points = [];
  let tooSmall = 0;
  let noValue = 0;
  for (const place of raw) {
    if (!place.population || place.population < MIN_POPULATION) tooSmall += 1;
    else if (place.x === null) noValue += 1;
    else points.push({ ...place, y: (place.count * PER_RESIDENTS) / place.population });
  }
  return { points, unit: city === 'LA' ? 'LAPD areas' : 'ZIP codes', tooSmall, noValue };
}

/** Average ranks (1 = smallest); tied values share the mean of the ranks they span. */
function ranks(values) {
  const order = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0]);
  const ranked = new Array(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1][0] === order[start][0]) end += 1;
    const average = (start + end) / 2 + 1;
    for (let i = start; i <= end; i += 1) ranked[order[i][1]] = average;
    start = end + 1;
  }
  return ranked;
}

/** Pearson correlation of two equal-length lists, or null when either has no spread. */
function pearson(xs, ys) {
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
    syy += (ys[i] - meanY) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/**
 * Spearman's rank correlation: the Pearson correlation of the two lists' ranks, so it measures
 * whether they rise and fall together, not how straight the relationship is. Null with fewer than
 * 3 points or when either list never varies.
 */
export function spearman(xs, ys) {
  return xs.length < 3 ? null : pearson(ranks(xs), ranks(ys));
}

/** Least-squares line y = intercept + slope * x, or null when x never varies. */
export function linearFit(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

/** The trend line's two end points, cut short where the line would fall below zero offenses. */
function trendEnds(xs, fit) {
  const at = (x) => fit.intercept + fit.slope * x;
  const zeroCrossing = -fit.intercept / fit.slope;
  return [Math.min(...xs), Math.max(...xs)].map((x) => (at(x) < 0 ? zeroCrossing : x));
}

function blockFor(city, name) {
  if (!blocks.has(city)) {
    const wrapper = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = name;
    const chart = document.createElement('div');
    chart.className = 'chart';
    const note = document.createElement('p');
    note.className = 'subtle chart-note';
    wrapper.append(title, chart, note);
    blocks.set(city, { wrapper, title, chart, note, plotted: false });
  }
  return blocks.get(city);
}

/** Tick marks for a linear y-axis from 0 up to `top`, stepping by a round number (1, 2 or 5 times a power of ten). */
function linearTicks(top) {
  const raw = top / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((multiple) => multiple * power >= raw) * power;
  const values = [];
  for (let i = 0; i * step <= top; i += 1) values.push(Math.round(i * step * 1e6) / 1e6);
  return { values, text: values.map((value) => formatNumber(value, step < 1 ? 2 : 0)) };
}

function scatterLayout(theme, factor, log, top) {
  // Linear axis: start a little below zero and end a little above the highest point, so markers sitting
  // near 0 or at the top are not cut off by the edge of the plot. Ticks are set by hand to skip the
  // negative values the extra room would otherwise label.
  const ticks = linearTicks(top);
  return {
    ...baseLayout(),
    height: 420,
    hovermode: 'closest',
    showlegend: false,
    margin: { t: 16, r: 16, b: 56, l: 16 },
    xaxis: {
      title: { text: factor.axis }, gridcolor: theme.grid, zeroline: false, automargin: true, ticklabelstandoff: 6,
      ...factor.axisFormat,
    },
    yaxis: {
      title: { text: `Offenses per 100,000 residents${log ? ' (log scale)' : ''}` }, gridcolor: theme.grid, zeroline: false,
      automargin: true, tickformat: ',.0f',
      // A log axis can't start at zero; Plotly picks its range from the points.
      ...(log ? { type: 'log' } : {
        range: [-0.05 * top, 1.05 * top], tickmode: 'array', tickvals: ticks.values, ticktext: ticks.text,
      }),
    },
  };
}

function drawCity(data, city, factor, theme, scale) {
  const block = blockFor(city, data.cities[city].name);
  const name = data.cities[city].name;
  const log = scale === 'log';
  const { points, unit, tooSmall, noValue } = correlationPoints(data, city, factor.key);

  // Spearman's rho uses ranks, so it is the same on either scale and counts every point.
  const rho = spearman(points.map((point) => point.x), points.map((point) => point.y));
  block.title.textContent = rho === null
    ? `${name} · Spearman ρ not available`
    : `${name} · Spearman ρ = ${rho.toFixed(2)} (n = ${points.length})`;

  // A log axis can't show a rate of 0, so places with no offenses are left off the picture only.
  const shown = log ? points.filter((point) => point.y > 0) : points;
  const noOffenses = points.length - shown.length;
  const left = [];
  if (tooSmall) left.push(`${tooSmall} with under ${formatNumber(MIN_POPULATION)} residents or no population data`);
  if (noValue) left.push(`${noValue} with no ${factor.short}`);
  block.note.textContent = `${shown.length} ${unit} plotted.${left.length ? ` Left off: ${left.join('; ')}.` : ''}`
    + (noOffenses ? ` ${noOffenses} more with no offenses can't be shown on the log scale (still counted in ρ).` : '');

  if (!shown.length) {
    Plotly.purge(block.chart);
    block.plotted = false;
    block.chart.style.height = '';
    block.chart.style.minHeight = '0';
    block.chart.textContent = 'No data to plot for these filters.';
    return;
  }
  if (!block.plotted) block.chart.textContent = ''; // clears the empty-state message, never a drawn chart
  const xs = shown.map((point) => point.x);
  const ys = shown.map((point) => point.y);
  const traces = [{
    type: 'scatter',
    mode: 'markers',
    x: xs,
    y: ys,
    text: shown.map((point) => point.label),
    customdata: shown.map((point) => [point.count, point.population]),
    marker: { color: theme.cities[city], size: 10, opacity: 0.8, line: { color: theme.surface, width: 1 } },
    hovertemplate: `<b>%{text}</b><br>${factor.label}: ${factor.hover}`
      + '<br>Offenses per 100,000: %{y:,.0f}<br>Offenses: %{customdata[0]:,.0f}<br>Population: %{customdata[1]:,.0f}<extra></extra>',
  }];
  // On the log scale the line is fitted to log10(rate), so it is straight on the chart.
  const fit = linearFit(xs, log ? ys.map(Math.log10) : ys);
  let top = Math.max(...ys, 1);
  if (fit) {
    const ends = log ? [Math.min(...xs), Math.max(...xs)] : trendEnds(xs, fit);
    const heightAt = (x) => (log ? 10 ** (fit.intercept + fit.slope * x) : fit.intercept + fit.slope * x);
    top = Math.max(top, ...ends.map(heightAt));
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: ends,
      y: ends.map(heightAt),
      line: { color: theme.outline, width: 2, dash: 'dash' },
      hoverinfo: 'skip',
    });
  }
  drawChart(block.chart, traces, scatterLayout(theme, factor, log, top));
  block.plotted = true;
}

function panelNotes(data, scale) {
  const months = selectedMonths();
  const notes = [
    'Each point is a ZIP code (San Diego, San Francisco) or an LAPD area (Los Angeles). Each chart has its own vertical scale.',
    `Offenses use whole months, ${formatMonth(months.start)} – ${formatMonth(months.end)}, over each place's most recent population estimate.`,
    'The Measure filter does not apply here: the vertical axis is always offenses per 100,000 residents.',
    scale === 'log'
      ? 'The vertical axis is a log scale, so each gridline is ten times the last and low and high rates are equally easy to see. The dashed line is a least-squares fit to the log of the rate, so it is straight on the chart.'
      : 'The dashed line is a straight-line (least-squares) fit.',
    'Spearman\'s ρ compares ranks, from -1 to 1, and shows whether the factor and the rate rise or fall together however steeply, so it can disagree with the line when a few points sit far from the rest. It is the same on either scale.',
  ];
  if (filters.cities.includes('LA')) {
    notes.push('An LAPD area\'s population and socioeconomic values are estimated from the ZIP codes that overlap it.');
  }
  const group = selectedGroup(data);
  if (filters.category && filters.cities.some((city) => city !== 'LA')) {
    notes.push(`ZIP counts are kept by crime group, so SD and SF points show all ${group} offenses, not only ${filters.category}.`);
  }
  if (filters.cities.includes('LA') && UNRELIABLE_LA_GROUPS.includes(group)) {
    notes.push(`LA only includes offenses with a victim, so its ${group} rates are unreliable and undercount.`);
  }
  return notes.join(' ');
}

/** Everything the drawn charts depend on. Measure is not part of it: the tab is always per 100,000. */
function drawKey(factorKey, scale) {
  return JSON.stringify([factorKey, scale, filters.cities, filters.group, filters.category, filters.start, filters.end, currentTheme()]);
}

/** Draws one scatterplot per selected city from the shared filters and the tab's own factor. */
export function renderCorrelation(data) {
  if (!factorPills) {
    factorPills = createPills(elements.correlationFactor,
      Object.entries(FACTORS).map(([value, factor]) => ({ value, label: factor.label })), 'poverty',
      () => renderCorrelation(data));
  }
  if (!scalePills) {
    scalePills = createPills(elements.correlationScale,
      [{ value: 'linear', label: 'Linear' }, { value: 'log', label: 'Log' }], 'linear',
      () => renderCorrelation(data));
  }
  const scale = scalePills.value;
  const key = drawKey(factorPills.value, scale);
  if (key === drawnKey) {
    // Nothing this tab shows has changed (for example only the Measure filter did): keep the charts,
    // but refit them, since a chart drawn while its tab was hidden may be the wrong size.
    for (const block of blocks.values()) if (block.plotted) Plotly.Plots.resize(block.chart);
    return;
  }
  drawnKey = key;
  const factor = { key: factorPills.value, ...FACTORS[factorPills.value] };
  const theme = themeColors();

  for (const [city, block] of blocks) {
    if (filters.cities.includes(city)) continue;
    Plotly.purge(block.chart);
    block.wrapper.remove();
    blocks.delete(city);
  }
  elements.correlationCharts.replaceChildren(...filters.cities.map((city) => blockFor(city, data.cities[city].name).wrapper));
  for (const city of filters.cities) drawCity(data, city, factor, theme, scale);
  elements.correlationNote.textContent = panelNotes(data, scale);
}
