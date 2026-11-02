// Compare tab: how the cities differ by category, crime-group mix, day of week and hour of day.

import { datesBetween, populationFor } from './data.js';
import { baseLayout, drawChart, formatDate, themeColors } from './display.js';
import { UNRELIABLE_LA_GROUPS, categoryMatches, filters, groupMatches, selectedGroup } from './filters.js';

const PER_RESIDENTS = 100000;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_LABELS = HOURS.map((hour) => `${hour % 12 || 12} ${hour < 12 ? 'am' : 'pm'}`);
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];
// Segments below this share are too thin for a readable label; hover still shows them.
const MIX_LABEL_MIN_PERCENT = 5;
const RATE_NOTE = 'Rates use each city\'s Census population for the year; 2026 uses the 2025 estimate.';

const elements = Object.fromEntries([
  'compareCategories', 'compareCategoriesNote', 'compareMix', 'compareMixNote',
  'compareWeekdays', 'compareWeekdaysNote', 'compareHours', 'compareHoursNote',
].map((id) => [id, document.getElementById(id)]));

const weekdayOf = new Map();

/** 0 for Monday through 6 for Sunday. */
function weekdayIndex(date) {
  if (!weekdayOf.has(date)) weekdayOf.set(date, (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7);
  return weekdayOf.get(date);
}

function inRange(date) {
  return date >= filters.start && date <= filters.end;
}

/** A row's count, or in rate mode its count per 100,000 residents in that year. */
function measured(data, city, date, count) {
  if (filters.measure !== 'rate') return count;
  return (count * PER_RESIDENTS) / populationFor(data, city, Number(date.slice(0, 4)));
}

function isUnreliable(city, group) {
  return city === 'LA' && UNRELIABLE_LA_GROUPS.includes(group);
}

function measureName() {
  return filters.measure === 'rate' ? 'Offenses per 100,000 residents' : 'Offenses';
}

/** Diagonal stripes over the marks that are unreliable; plain fill elsewhere. */
function stripes(flags, theme) {
  return {
    shape: flags.map((flag) => (flag ? '/' : '')), fillmode: 'overlay', fgcolor: theme.surface, size: 7, solidity: 0.4,
  };
}

function chartLayout(theme, overrides) {
  return {
    ...baseLayout(),
    barcornerradius: 4,
    hovermode: 'closest',
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' },
    margin: { t: 40, r: 16, b: 56, l: 16 },
    ...overrides,
    xaxis: { gridcolor: theme.grid, zeroline: false, automargin: true, ticklabelstandoff: 6, ...overrides.xaxis },
    yaxis: { gridcolor: theme.grid, zeroline: false, automargin: true, ...overrides.yaxis },
  };
}

/** Names of the selected cities whose data stops before the end of the date range. */
function earlyEnds(data) {
  return filters.cities
    .filter((code) => data.cities[code].last_date < filters.end)
    .map((code) => `${data.cities[code].name} data ends ${formatDate(data.cities[code].last_date)}.`);
}

function renderCategories(data, theme) {
  const categories = data.categories.filter((category) => category.group !== 'Non-Crime'
    && categoryMatches(data, category.category));
  const totals = Object.fromEntries(filters.cities.map((code) => [code, {}]));
  for (const row of data.dailyCounts) {
    if (!(row.city in totals) || !inRange(row.date)) continue;
    const cityTotals = totals[row.city];
    cityTotals[row.category] = (cityTotals[row.category] ?? 0) + measured(data, row.city, row.date, row.count);
  }

  const format = filters.measure === 'rate' ? ',.1f' : ',.0f';
  const traces = filters.cities.map((code) => {
    const flags = categories.map((category) => isUnreliable(code, category.group));
    const name = data.cities[code].name;
    return {
      type: 'bar',
      orientation: 'h',
      name,
      y: categories.map((category) => category.category),
      x: categories.map((category) => totals[code][category.category] ?? 0),
      marker: { color: theme.cities[code], pattern: stripes(flags, theme) },
      customdata: flags.map((flag) => (flag ? '<br>Unreliable: LA counts only offenses with a victim' : '')),
      hovertemplate: `${name}, %{y}: %{x:${format}}%{customdata}<extra></extra>`,
    };
  });
  const rowHeight = 12 * filters.cities.length + 16;
  const layout = chartLayout(theme, {
    height: 110 + rowHeight * categories.length,
    barmode: 'group',
    bargap: 0.25,
    bargroupgap: 0.1,
    xaxis: { title: { text: `${measureName()}<br>${formatDate(filters.start)} – ${formatDate(filters.end)}` }, tickformat: ',' },
    yaxis: { autorange: 'reversed', type: 'category', gridcolor: 'rgba(0,0,0,0)' },
  });
  drawChart(elements.compareCategories, traces, layout);

  const notes = ['Categories are in the shared display order, grouped Violent, Property, Vehicle, Society, Other.'];
  if (filters.cities.includes('LA') && categories.some((category) => isUnreliable('LA', category.group))) {
    notes.push('Striped LA bars are Society and Other categories. LA only records offenses with a victim, so they undercount.');
  }
  if (filters.measure === 'rate') notes.push(RATE_NOTE);
  elements.compareCategoriesNote.textContent = [...notes, ...earlyEnds(data)].join(' ');
}

function renderMix(data, theme) {
  const groups = [...new Set(data.categories.map((category) => category.group))].filter((group) => group !== 'Non-Crime');
  const counts = Object.fromEntries(filters.cities.map((code) => [code, {}]));
  for (const row of data.dailyCounts) {
    if (!(row.city in counts) || !inRange(row.date) || !categoryMatches(data, row.category)) continue;
    const group = data.groupOf[row.category];
    counts[row.city][group] = (counts[row.city][group] ?? 0) + row.count;
  }
  const cityTotal = (code) => Object.values(counts[code]).reduce((sum, count) => sum + count, 0);
  const shareOf = (code, group) => (cityTotal(code) ? ((counts[code][group] ?? 0) * 100) / cityTotal(code) : 0);

  /** One group's segments for the cities where `include` is true; null leaves the other cities' segment out. */
  const segments = (group, include, striped) => {
    const shares = filters.cities.map((code, i) => (include[i] ? shareOf(code, group) : null));
    return {
      type: 'bar',
      orientation: 'h',
      name: group,
      y: filters.cities.map((code) => data.cities[code].name),
      x: shares,
      text: shares.map((share) => (share >= MIX_LABEL_MIN_PERCENT ? `${share.toFixed(0)}%` : '')),
      textposition: 'inside',
      insidetextanchor: 'middle',
      textfont: { color: theme.groupInk[group] ?? '#ffffff' },
      customdata: filters.cities.map((code) => counts[code][group] ?? 0),
      marker: {
        color: theme.groups[group],
        line: { color: theme.surface, width: 2 },
        pattern: stripes(filters.cities.map(() => striped), theme),
      },
      hovertemplate: `%{y}, ${group}: %{x:.1f}% (%{customdata:,} offenses)${striped ? '<br>Unreliable: LA counts only offenses with a victim' : ''}<extra></extra>`,
    };
  };
  // Striped segments go in their own unlisted trace right after the group's, so the stack order
  // is unchanged and the legend swatch stays plain.
  const traces = groups.flatMap((group) => {
    const flagged = filters.cities.map((code) => isUnreliable(code, group));
    const plain = segments(group, flagged.map((flag) => !flag), false);
    if (!flagged.some(Boolean)) return [plain];
    return [plain, { ...segments(group, flagged, true), showlegend: false }];
  });
  const layout = chartLayout(theme, {
    height: 120 + 56 * filters.cities.length,
    barmode: 'stack',
    bargap: 0.3,
    barcornerradius: 0,
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', traceorder: 'normal' },
    xaxis: { range: [0, 100], ticksuffix: '%', title: { text: 'Share of the city\'s offenses' } },
    yaxis: { autorange: 'reversed', type: 'category', gridcolor: 'rgba(0,0,0,0)' },
  });
  drawChart(elements.compareMix, traces, layout);

  const group = selectedGroup(data);
  const notes = ['Each bar is one city\'s selected offenses split by crime group. Shares are the same for counts and rates.'];
  if (group) {
    notes.push(`With ${filters.category || group} selected, every bar is all ${group}. Pick All groups to compare the mix.`);
  }
  if (filters.cities.includes('LA') && (!group || UNRELIABLE_LA_GROUPS.includes(group))) {
    notes.push('LA\'s Society and Other segments are striped: LA only records offenses with a victim, so they undercount.');
  }
  elements.compareMixNote.textContent = notes.join(' ');
}

function renderWeekdays(data, theme) {
  const sums = Object.fromEntries(filters.cities.map((code) => [code, Array(7).fill(0)]));
  for (const row of data.dailyCounts) {
    if (!(row.city in sums) || !inRange(row.date) || !categoryMatches(data, row.category)) continue;
    sums[row.city][weekdayIndex(row.date)] += measured(data, row.city, row.date, row.count);
  }

  const unreliable = UNRELIABLE_LA_GROUPS.includes(selectedGroup(data));
  const format = filters.measure === 'rate' ? ',.2f' : ',.1f';
  const traces = filters.cities.map((code) => {
    const { first_date: first, last_date: last } = data.cities[code];
    const start = filters.start > first ? filters.start : first;
    const end = filters.end < last ? filters.end : last;
    const daysPerWeekday = Array(7).fill(0);
    for (const date of datesBetween(start, end)) daysPerWeekday[weekdayIndex(date)] += 1;
    const name = data.cities[code].name;
    return {
      type: 'bar',
      name,
      x: WEEKDAYS,
      y: sums[code].map((sum, day) => (daysPerWeekday[day] ? sum / daysPerWeekday[day] : null)),
      marker: { color: theme.cities[code], pattern: stripes(WEEKDAYS.map(() => unreliable && code === 'LA'), theme) },
      hovertemplate: `${name}, %{x}: %{y:${format}} a day<extra></extra>`,
    };
  });
  const layout = chartLayout(theme, {
    height: 420,
    barmode: 'group',
    bargap: 0.25,
    bargroupgap: 0.1,
    xaxis: { type: 'category', tickvals: WEEKDAYS, ticktext: WEEKDAYS.map((day) => day.slice(0, 3)) },
    yaxis: { title: { text: `${measureName()} per day, average` }, rangemode: 'tozero', tickformat: ',' },
  });
  drawChart(elements.compareWeekdays, traces, layout);

  const notes = ['Each bar averages every such weekday in the date range, so ranges with more Mondays than Sundays still compare fairly.'];
  if (unreliable && filters.cities.includes('LA')) notes.push('LA\'s bars are striped because its Society and Other numbers undercount.');
  if (filters.measure === 'rate') notes.push(RATE_NOTE);
  elements.compareWeekdaysNote.textContent = notes.join(' ');
}

function renderHours(data, theme) {
  const shown = filters.cities.filter((code) => data.timedCities.has(code));
  const missing = filters.cities.filter((code) => !data.timedCities.has(code));
  const unreliable = UNRELIABLE_LA_GROUPS.includes(selectedGroup(data));
  const format = filters.measure === 'rate' ? ',.3f' : ',.1f';

  const traces = shown.map((code) => {
    const perHour = Array(24).fill(0);
    for (const row of data.hourlyCounts) {
      if (row.city === code && groupMatches(data, row.group)) perHour[row.hour] += row.count;
    }
    const { first_date: first, last_date: last } = data.cities[code];
    const days = datesBetween(first, last).length;
    const population = populationFor(data, code, Number(last.slice(0, 4)));
    const name = data.cities[code].name;
    return {
      type: 'scatter',
      mode: 'lines+markers',
      name,
      x: HOURS,
      y: perHour.map((count) => (filters.measure === 'rate' ? (count / days) * (PER_RESIDENTS / population) : count / days)),
      customdata: HOUR_LABELS,
      line: { color: theme.cities[code], width: 2, dash: unreliable && code === 'LA' ? 'dot' : 'solid' },
      marker: { color: theme.cities[code], size: 8, line: { color: theme.surface, width: 2 } },
      hovertemplate: `${name}, %{customdata}: %{y:${format}} a day<extra></extra>`,
    };
  });
  const layout = chartLayout(theme, {
    height: 420,
    xaxis: { tickvals: HOUR_TICKS, ticktext: HOUR_TICKS.map((hour) => HOUR_LABELS[hour]), range: [-0.5, 23.5], title: { text: 'Hour the offense occurred' } },
    yaxis: { title: { text: `${measureName()} per day, average` }, rangemode: 'tozero', tickformat: ',' },
  });
  if (!shown.length) {
    layout.annotations = [{
      text: 'None of the selected cities records the time of day.',
      xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { color: theme.text, size: 14 },
    }];
  }
  drawChart(elements.compareHours, traces, layout);

  const notes = [];
  if (missing.length) {
    const names = missing.map((code) => data.cities[code].name).join(' and ');
    notes.push(`${names} ${missing.length > 1 ? 'are' : 'is'} not shown: ${missing.length > 1 ? 'their' : 'its'} data has no time of day.`);
  }
  notes.push(`Covers every date from ${formatDate(data.metadata.shared_window_start)}, not the selected date range,`
    + ' because the hourly counts are not split by date.');
  if (filters.category) {
    notes.push(`Hourly counts are kept by crime group, so this shows all ${selectedGroup(data)} offenses, not only ${filters.category}.`);
  }
  if (shown.includes('LA')) notes.push('LA\'s peaks at midnight and noon likely include reports with an unknown time.');
  if (unreliable && shown.includes('LA')) notes.push('LA\'s line is dotted because its Society and Other numbers undercount.');
  if (filters.measure === 'rate') notes.push('Rates use each city\'s newest Census population estimate.');
  elements.compareHoursNote.textContent = notes.join(' ');
}

/** Draws the four Compare panels from the shared filters. */
export function renderCompare(data) {
  const theme = themeColors();
  renderCategories(data, theme);
  renderMix(data, theme);
  renderWeekdays(data, theme);
  renderHours(data, theme);
}
