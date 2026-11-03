// Trends tab: offenses over time with the selected cities overlaid or in small multiples.

import { addDays, datesBetween, populationFor } from './data.js';
import { baseLayout, drawChart, formatDate, themeColors } from './display.js';
import { categoryMatches, filters } from './filters.js';
import { createPills } from './pills.js';

const PER_RESIDENTS = 100000;
const PANEL_GAP = 0.07;
const TITLE_LINE_CHARS = 34;
const NARROW = window.matchMedia('(max-width: 800px)');

const elements = Object.fromEntries([
  'trendLayout', 'trendGranularity', 'trendRolling', 'trendIndexed', 'trendChart', 'trendNote',
].map((id) => [id, document.getElementById(id)]));

let layoutPills = null;
let granularityPills = null;
let rollingPills = null;

const HOVER_FORMATS = { day: '%a %b %-d, %Y', week: 'Week of %b %-d, %Y', month: '%B %Y' };

function readOptions() {
  const granularity = granularityPills.value;
  return {
    multiples: layoutPills.value === 'multiples',
    granularity,
    rolling: granularity === 'day' ? Number(rollingPills.value) : 0,
    indexed: elements.trendIndexed.getAttribute('aria-pressed') === 'true',
  };
}

/**
 * The city's offenses (or offenses per 100,000 residents) on every day it has data,
 * at 0 on days with none. Rates use the population of each day's year.
 */
function dailyValues(data, city) {
  const totals = new Map();
  for (const row of data.dailyCounts) {
    if (row.city === city && categoryMatches(data, row.category)) {
      totals.set(row.date, (totals.get(row.date) ?? 0) + row.count);
    }
  }
  const { first_date: first, last_date: last } = data.cities[city];
  return datesBetween(first, last).map((date) => {
    const count = totals.get(date) ?? 0;
    const population = populationFor(data, city, Number(date.slice(0, 4)));
    return { date, value: filters.measure === 'rate' ? (count * PER_RESIDENTS) / population : count };
  });
}

/** Mean of each day and the days before it; null until a full window is available. */
function trailingAverage(points, days) {
  let sum = 0;
  return points.map((point, i) => {
    sum += point.value;
    if (i >= days) sum -= points[i - days].value;
    return { date: point.date, value: i >= days - 1 ? sum / days : null };
  });
}

/** First day of the week (Monday) or month containing the date. */
function periodStart(date, granularity) {
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  const daysSinceMonday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

function periodLength(start, granularity) {
  if (granularity === 'week') return 7;
  const [year, month] = start.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Weekly or monthly sums, keeping only periods whose every day is in the points. */
function completePeriods(points, granularity) {
  const sums = new Map();
  const dayCounts = new Map();
  for (const point of points) {
    const start = periodStart(point.date, granularity);
    sums.set(start, (sums.get(start) ?? 0) + point.value);
    dayCounts.set(start, (dayCounts.get(start) ?? 0) + 1);
  }
  const complete = [...sums].filter(([start]) => dayCounts.get(start) === periodLength(start, granularity));
  return complete.map(([date, value]) => ({ date, value }));
}

/** Values scaled so the first non-empty point is 100; all null when that point is 0. */
function indexToFirst(points) {
  const base = points.find((point) => point.value !== null)?.value;
  return points.map((point) => ({
    date: point.date,
    value: base && point.value !== null ? (point.value / base) * 100 : null,
  }));
}

/** The plotted points for one city: smoothed over all its data, then cut to the date range. */
function citySeries(data, city, options) {
  let points = dailyValues(data, city);
  if (options.rolling > 1) points = trailingAverage(points, options.rolling);
  points = points.filter((point) => point.date >= filters.start && point.date <= filters.end);
  if (options.granularity !== 'day') points = completePeriods(points, options.granularity);
  return options.indexed ? indexToFirst(points) : points;
}

/** Words joined into lines of at most maxChars, so a long axis title fits beside the plot. */
function wrapWords(text, maxChars) {
  const lines = [];
  for (const word of text.split(' ')) {
    const current = lines.at(-1);
    if (current && current.length + word.length + 1 <= maxChars) lines[lines.length - 1] = `${current} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** The y-axis title as lines: what is measured, per what period, and for rates the population used. */
function yAxisTitleLines(options) {
  const unit = filters.measure === 'rate' ? 'Offenses per 100,000 residents' : 'Offenses';
  const period = options.rolling > 1 ? `per day, ${options.rolling}-day average` : `per ${options.granularity}`;
  const parts = [`${unit} ${period}`];
  if (options.indexed) parts.unshift(`Index, first ${options.granularity} shown = 100:`);
  if (filters.measure === 'rate') parts.push('(Census population of each year; 2026 uses 2025)');
  return wrapWords(parts.join(' '), TITLE_LINE_CHARS);
}

function valueFormat(options) {
  if (options.indexed) return ',.0f';
  if (filters.measure === 'rate') return ',.2f';
  return options.rolling > 1 ? ',.1f' : ',.0f';
}

/** City names at the end of each line, nudged apart so they don't overlap. */
function endLabels(series, options, plotHeight) {
  const values = series.flatMap((city) => city.points.map((point) => point.value)).filter((value) => value !== null);
  const top = Math.max(...values);
  const bottom = options.indexed ? Math.min(...values) : 0;
  const pixelsPerUnit = plotHeight / ((top - bottom) || 1);
  const ends = series
    .map((city) => ({ name: city.name, end: city.points.findLast((point) => point.value !== null) }))
    .filter((city) => city.end)
    .sort((a, b) => b.end.value - a.end.value);

  let previousPixel = -Infinity;
  return ends.map(({ name, end }) => {
    const pixel = (top - end.value) * pixelsPerUnit;
    const placed = Math.max(pixel, previousPixel + 16);
    previousPixel = placed;
    return {
      x: end.date, y: end.value, xref: 'x', yref: 'y', text: name, showarrow: false,
      xanchor: 'left', xshift: 6, yshift: pixel - placed, font: { color: themeColors().text, size: 12 },
    };
  });
}

/** First to last plotted date, padded by half a month when monthly markers sit on the ends. */
function dateRange(series, options) {
  const dates = series.flatMap((city) => city.points.map((point) => point.date)).sort();
  const padDays = options.granularity === 'month' ? 15 : 0;
  return [addDays(dates[0], -padDays), addDays(dates.at(-1), padDays)];
}

function notes(data, series, options) {
  const lines = [];
  if (options.granularity === 'week') lines.push('Weeks start on Monday.');
  if (options.granularity !== 'day') {
    lines.push(`${options.granularity === 'week' ? 'Weeks' : 'Months'} not fully inside the date range or a city's data are left out.`);
  }
  if (options.rolling > 1) lines.push(`Each point averages that day and the ${options.rolling - 1} days before it.`);
  if (options.indexed) {
    lines.push(`Each city is scaled so its first ${options.granularity} shown is 100, to compare change rather than size.`);
    const flat = series.filter((city) => city.points.length && city.points.every((point) => point.value === null));
    for (const city of flat) lines.push(`${city.name} can't be indexed: it has no offenses in its first ${options.granularity}.`);
  }
  if (filters.measure === 'rate') lines.push('Rates use each city\'s Census population for the year; 2026 uses the 2025 estimate.');
  for (const city of series) {
    const last = data.cities[city.code].last_date;
    if (last < filters.end) lines.push(`${city.name} data ends ${formatDate(last)}.`);
  }
  lines.push('Drag the bar under the chart to zoom into a period.');
  return lines.join(' ');
}

/** Draws the Trends chart from the shared filters and this tab's controls. */
export function renderTrends(data) {
  const options = readOptions();
  rollingPills.setDisabled(options.granularity !== 'day');
  const theme = themeColors();
  const series = filters.cities.map((code) => ({ code, name: data.cities[code].name, points: citySeries(data, code, options) }));
  const hasData = series.some((city) => city.points.some((point) => point.value !== null));
  const format = valueFormat(options);
  const showEndLabels = !options.multiples && !NARROW.matches && hasData;

  const traces = series.map((city, i) => ({
    x: city.points.map((point) => point.date),
    y: city.points.map((point) => point.value),
    type: 'scatter',
    mode: options.granularity === 'month' ? 'lines+markers' : 'lines',
    name: city.name,
    line: { color: theme.cities[city.code], width: 2 },
    marker: { color: theme.cities[city.code], size: 8 },
    yaxis: options.multiples && i > 0 ? `y${i + 1}` : 'y',
    hovertemplate: `${city.name}: %{y:${format}}<extra></extra>`,
  }));

  const height = options.multiples ? 120 + 190 * series.length : 480;
  const titleLines = yAxisTitleLines(options);
  const yTitle = titleLines.join('<br>');
  // Each title line needs about 16 px beside the tick labels.
  const margin = { t: options.multiples ? 28 : 48, r: showEndLabels ? 110 : 16, b: 40, l: 56 + 16 * titleLines.length };
  const axisStyle = { gridcolor: theme.grid, zeroline: false, tickformat: ',', rangemode: options.indexed ? 'normal' : 'tozero' };
  const layout = {
    ...baseLayout(),
    height,
    margin,
    hovermode: 'x unified',
    showlegend: !options.multiples,
    legend: { orientation: 'h', x: 0, y: 1.1 },
    xaxis: {
      type: 'date',
      gridcolor: theme.grid,
      hoverformat: HOVER_FORMATS[options.granularity],
      ticklabelstandoff: 6,
      rangeslider: { visible: hasData, thickness: 0.08, bgcolor: 'rgba(0,0,0,0)', bordercolor: theme.grid },
    },
    annotations: [],
  };
  if (showEndLabels) {
    // End labels would otherwise stretch the autorange past the last date.
    const range = dateRange(series, options);
    layout.xaxis.range = range;
    layout.xaxis.rangeslider.range = range;
  }

  if (options.multiples) {
    // Panels share the x axis, drawn under the bottom panel.
    layout.xaxis.anchor = series.length > 1 ? `y${series.length}` : 'y';
    const panelHeight = (1 - PANEL_GAP * (series.length - 1)) / series.length;
    series.forEach((city, i) => {
      const top = 1 - i * (panelHeight + PANEL_GAP);
      const axis = {
        ...axisStyle,
        domain: [Math.max(0, top - panelHeight), top],
        title: { text: i === Math.floor(series.length / 2) ? yTitle : '' },
      };
      if (i > 0) axis.matches = 'y'; // one shared y scale across panels
      layout[i === 0 ? 'yaxis' : `yaxis${i + 1}`] = axis;
      layout.annotations.push({
        text: `<b>${city.name}</b>`, xref: 'paper', yref: 'paper', x: 0, y: top,
        xanchor: 'left', yanchor: 'bottom', showarrow: false, font: { color: theme.text },
      });
    });
  } else {
    layout.yaxis = { ...axisStyle, title: { text: yTitle } };
    if (showEndLabels) layout.annotations = endLabels(series, options, (height - margin.t - margin.b) * 0.8);
  }

  if (!hasData) {
    const period = options.granularity === 'day' ? 'days' : `complete ${options.granularity}s`;
    layout.annotations = [{
      text: `No ${period} in this date range. Widen the range or pick a shorter period.`,
      xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { color: theme.text, size: 14 },
    }];
  }

  drawChart(elements.trendChart, traces, layout);
  elements.trendNote.textContent = notes(data, series, options);
}

/** Re-renders the chart when one of the tab's own controls changes. */
export function setUpTrends(data) {
  const redraw = () => renderTrends(data);
  layoutPills = createPills(elements.trendLayout, [
    { value: 'overlay', label: 'Cities overlaid' },
    { value: 'multiples', label: 'One panel per city' },
  ], 'overlay', redraw);
  granularityPills = createPills(elements.trendGranularity, [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ], 'day', redraw);
  rollingPills = createPills(elements.trendRolling, [
    { value: '0', label: 'None' },
    { value: '7', label: '7-day' },
    { value: '28', label: '28-day' },
  ], '0', redraw);
  elements.trendIndexed.addEventListener('click', () => {
    const on = elements.trendIndexed.getAttribute('aria-pressed') === 'true';
    elements.trendIndexed.setAttribute('aria-pressed', String(!on));
    redraw();
  });
}
