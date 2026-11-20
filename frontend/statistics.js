// Statistics tab: Descriptive metrics, distribution box plots, Lorenz inequality curves,
// interactive threshold queries, and sortable/searchable raw offense data table with CSV export.

import { PER_RESIDENTS, datesBetween, populationFor } from './data.js';
import { baseLayout, currentTheme, drawChart, formatDate, formatNumber, themeColors } from './display.js';
import { categoryMatches, filters } from './filters.js';

const PAGE_SIZE = 25;

/* ---------------------------------------------------------------------
   Pure statistics helpers
   --------------------------------------------------------------------- */

const finiteNumbers = (values) =>
  values.filter((v) => typeof v === 'number' && Number.isFinite(v));

const sumOf = (values) => values.reduce((total, v) => total + v, 0);

function quantileSorted(sorted, q) {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const remainder = position - base;
  return sorted[base + 1] === undefined
    ? sorted[base]
    : sorted[base] + remainder * (sorted[base + 1] - sorted[base]);
}

export function giniCoefficient(values) {
  const sorted = finiteNumbers(values).filter((v) => v >= 0).sort((a, b) => a - b);
  const count = sorted.length;
  const total = sumOf(sorted);
  if (count < 2 || total <= 0) return 0;
  let weighted = 0;
  sorted.forEach((v, index) => {
    weighted += (index + 1) * v;
  });
  return (2 * weighted) / (count * total) - (count + 1) / count;
}

export function lorenzPoints(values, maxPoints = 150) {
  const sorted = finiteNumbers(values).filter((v) => v >= 0).sort((a, b) => a - b);
  const count = sorted.length;
  const total = sumOf(sorted);
  if (!count || total <= 0) return { x: [0, 100], y: [0, 100] };
  const step = Math.max(1, Math.ceil(count / maxPoints));
  const x = [0];
  const y = [0];
  let cumulative = 0;
  sorted.forEach((v, index) => {
    cumulative += v;
    if ((index + 1) % step === 0 || index === count - 1) {
      x.push(((index + 1) / count) * 100);
      y.push((cumulative / total) * 100);
    }
  });
  return { x, y };
}

function skewness(values) {
  const count = values.length;
  if (count < 3) return NaN;
  const average = sumOf(values) / count;
  const variance = sumOf(values.map((v) => (v - average) ** 2)) / (count - 1);
  const deviation = Math.sqrt(variance);
  if (!deviation) return 0;
  const cubed = sumOf(values.map((v) => ((v - average) / deviation) ** 3));
  return (count / ((count - 1) * (count - 2))) * cubed;
}

export function describe(rawValues) {
  const values = finiteNumbers(rawValues);
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  if (!count) {
    return {
      n: 0, sum: 0, mean: 0, median: 0, sd: 0, cv: 0, skew: 0, min: 0, max: 0,
      q1: 0, q3: 0, iqr: 0, p90: 0, p95: 0,
    };
  }

  const total = sumOf(sorted);
  const average = total / count;
  const deviation = count > 1
    ? Math.sqrt(sumOf(sorted.map((v) => (v - average) ** 2)) / (count - 1))
    : 0;
  const q1 = quantileSorted(sorted, 0.25);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;

  return {
    n: count,
    sum: total,
    mean: average,
    median: quantileSorted(sorted, 0.5),
    sd: deviation,
    cv: average ? deviation / Math.abs(average) : 0,
    skew: skewness(sorted),
    min: sorted[0],
    max: sorted[count - 1],
    q1,
    q3,
    iqr,
    p90: quantileSorted(sorted, 0.90),
    p95: quantileSorted(sorted, 0.95),
  };
}

/** Text safe to put inside innerHTML. */
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/* ---------------------------------------------------------------------
   Tab State & DOM Elements
   --------------------------------------------------------------------- */

let cachedData = null;
let currentFilteredRows = [];
let tableSortKey = 'date';
let tableSortDir = -1; // -1 = desc, 1 = asc
let tableSearchQuery = '';
let tablePage = 0;

const elements = {};

function getElements() {
  if (elements.statsKpiGrid) return elements;
  Object.assign(elements, Object.fromEntries([
    'statsKpiGrid', 'statsBoxChart', 'statsLorenzChart',
    'statsThresholdInput', 'statsThresholdOutput', 'statsThresholdLabel',
    'statsTableSearch', 'statsExportCsv', 'statsDataTable', 'statsTableBody',
    'statsTableCount', 'statsPageInfo', 'statsPrevPage', 'statsNextPage',
  ].map((id) => [id, document.getElementById(id)])));
  return elements;
}

/* ---------------------------------------------------------------------
   Data Processing for Current Active Filters
   --------------------------------------------------------------------- */

const maxDate = (a, b) => (a > b ? a : b);
const minDate = (a, b) => (a < b ? a : b);

/** Adds a 0 for every date from start to end that has no entry: the export omits days with no offenses. */
export function fillZeroDays(totalsByDate, start, end) {
  for (const date of datesBetween(start, end)) {
    if (!totalsByDate.has(date)) totalsByDate.set(date, 0);
  }
  return totalsByDate;
}

function getFilteredData(data) {
  const rows = [];
  const dailyTotalsByCity = {};
  for (const c of filters.cities) dailyTotalsByCity[c] = new Map();

  for (const row of data.dailyCounts) {
    if (!filters.cities.includes(row.city)) continue;
    if (row.date < filters.start || row.date > filters.end) continue;
    if (!categoryMatches(data, row.category)) continue;

    const rate = (row.count * PER_RESIDENTS) / populationFor(data, row.city, Number(row.date.slice(0, 4)));
    rows.push({
      date: row.date,
      city: row.city,
      cityName: data.cities[row.city]?.name || row.city,
      category: row.category,
      group: data.groupOf[row.category] || 'Other',
      count: row.count,
      rate: Number(rate.toFixed(2)),
    });

    // Accumulate city daily total
    const cityMap = dailyTotalsByCity[row.city];
    const cur = cityMap.get(row.date) || 0;
    cityMap.set(row.date, cur + (filters.measure === 'rate' ? rate : row.count));
  }

  for (const cityCode of filters.cities) {
    const coverage = data.cities[cityCode];
    if (coverage) fillZeroDays(dailyTotalsByCity[cityCode], maxDate(filters.start, coverage.first_date), minDate(filters.end, coverage.last_date));
  }

  return { rows, dailyTotalsByCity };
}

/* ---------------------------------------------------------------------
   KPI Summary Cards Rendering
   --------------------------------------------------------------------- */

function renderKpiCards(data, dailyTotalsByCity) {
  const { statsKpiGrid } = getElements();
  if (!statsKpiGrid) return;

  const theme = themeColors();
  const unitLabel = filters.measure === 'rate' ? '/ 100k' : 'offenses';

  const cardsHtml = filters.cities.map((cityCode) => {
    const cityName = data.cities[cityCode]?.name || cityCode;
    const cityColor = theme.cities[cityCode] || '#4b5563';
    const cityMap = dailyTotalsByCity[cityCode] || new Map();
    const values = Array.from(cityMap.values());
    const stats = describe(values);

    // Find the date with the highest peak
    let peakDate = '-';
    let peakVal = 0;
    for (const [date, val] of cityMap.entries()) {
      if (val > peakVal) {
        peakVal = val;
        peakDate = date;
      }
    }

    const gini = giniCoefficient(values);

    if (!stats.n) {
      return `
      <div class="stats-kpi-card" style="--city: ${cityColor};">
        <div class="stats-kpi-header">
          <span>
            <span class="stats-kpi-city-dot"></span>
            ${escapeHtml(cityName)} (${escapeHtml(cityCode)})
          </span>
        </div>
        <div class="stats-kpi-rows">No data for this city in the selected dates.</div>
      </div>
    `;
    }

    return `
      <div class="stats-kpi-card" style="--city: ${cityColor};">
        <div class="stats-kpi-header">
          <span>
            <span class="stats-kpi-city-dot"></span>
            ${escapeHtml(cityName)} (${escapeHtml(cityCode)})
          </span>
          <span class="stats-kpi-days">${formatNumber(stats.n)} days</span>
        </div>
        <div class="stats-kpi-stat">
          ${formatNumber(Math.round(stats.sum))} <span class="stats-kpi-unit">total ${unitLabel}</span>
        </div>
        <div class="stats-kpi-rows">
          <div class="stats-kpi-row">
            <span>Daily Mean:</span>
            <strong>${stats.mean.toFixed(1)} ${unitLabel}/day</strong>
          </div>
          <div class="stats-kpi-row">
            <span>Daily Median:</span>
            <strong>${stats.median.toFixed(1)} ${unitLabel}/day</strong>
          </div>
          <div class="stats-kpi-row">
            <span>Std Dev / Spread:</span>
            <strong>±${stats.sd.toFixed(1)} (CV: ${(stats.cv * 100).toFixed(0)}%)</strong>
          </div>
          <div class="stats-kpi-row">
            <span>Interquartile Range (IQR):</span>
            <strong>${stats.q1.toFixed(1)} – ${stats.q3.toFixed(1)}</strong>
          </div>
          <div class="stats-kpi-row">
            <span>Peak Day${peakVal > 0 ? ` (${formatDate(peakDate)})` : ''}:</span>
            <strong class="stats-kpi-peak">${peakVal > 0 ? `${peakVal.toFixed(1)} ${unitLabel}` : '—'}</strong>
          </div>
          <div class="stats-kpi-row">
            <span>Inequality (Gini coeff):</span>
            <strong>${gini.toFixed(3)}</strong>
          </div>
        </div>
      </div>
    `;
  }).join('');

  statsKpiGrid.innerHTML = cardsHtml;
}

/* ---------------------------------------------------------------------
   Distribution Charts: Box Plot & Lorenz Concentration Curve
   --------------------------------------------------------------------- */

function renderCharts(data, dailyTotalsByCity) {
  const { statsBoxChart, statsLorenzChart } = getElements();
  if (!statsBoxChart || !statsLorenzChart) return;

  const theme = themeColors();
  const isDark = currentTheme() === 'dark';
  const unitLabel = filters.measure === 'rate' ? 'Offenses per 100,000 residents' : 'Daily offenses';

  // 1. Box-and-Whisker Plot of daily volumes
  const boxTraces = filters.cities.map((cityCode) => {
    const cityMap = dailyTotalsByCity[cityCode] || new Map();
    const values = Array.from(cityMap.values());
    const cityName = data.cities[cityCode]?.name || cityCode;
    const color = theme.cities[cityCode] || '#3b82f6';

    return {
      type: 'box',
      y: values,
      name: cityName,
      marker: { color, size: 5, opacity: 0.8 },
      boxpoints: 'outliers',
      jitter: 0,
      pointpos: 0,
      line: { width: 1.5 },
    };
  });

  const boxLayout = {
    ...baseLayout(),
    height: 320,
    margin: { t: 20, r: 20, b: 40, l: 50 },
    yaxis: {
      title: { text: unitLabel, font: { size: 12 } },
      gridcolor: theme.grid,
      zerolinecolor: theme.grid,
    },
    xaxis: {
      gridcolor: theme.grid,
    },
    showlegend: false,
  };

  drawChart(statsBoxChart, boxTraces, boxLayout);

  // 2. Lorenz Inequality Curves
  const lorenzTraces = filters.cities.map((cityCode) => {
    const cityMap = dailyTotalsByCity[cityCode] || new Map();
    const values = Array.from(cityMap.values());
    const cityName = data.cities[cityCode]?.name || cityCode;
    const color = theme.cities[cityCode] || '#3b82f6';
    const { x, y } = lorenzPoints(values);
    const gini = giniCoefficient(values);

    return {
      type: 'scatter',
      mode: 'lines',
      x,
      y,
      name: `${cityName} (Gini ${gini.toFixed(2)})`,
      line: { color, width: 2 },
    };
  });

  // 45-degree line of perfect equality
  lorenzTraces.push({
    type: 'scatter',
    mode: 'lines',
    x: [0, 100],
    y: [0, 100],
    name: 'Equal line (Gini 0)',
    line: { color: isDark ? '#4b5563' : '#9ca3af', width: 1.5, dash: 'dash' },
    hoverinfo: 'skip',
  });

  const lorenzLayout = {
    ...baseLayout(),
    height: 320,
    margin: { t: 20, r: 20, b: 45, l: 45 },
    xaxis: {
      title: { text: '% of days (ranked lowest to highest crime)', font: { size: 11 } },
      range: [0, 100],
      gridcolor: theme.grid,
    },
    yaxis: {
      title: { text: '% of cumulative offenses', font: { size: 11 } },
      range: [0, 100],
      gridcolor: theme.grid,
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: -0.22,
      font: { size: 11 },
    },
  };

  drawChart(statsLorenzChart, lorenzTraces, lorenzLayout);
}

/* ---------------------------------------------------------------------
   Interactive Threshold Query Calculation
   --------------------------------------------------------------------- */

function updateThresholdQuery() {
  const { statsThresholdInput, statsThresholdOutput, statsThresholdLabel } = getElements();
  if (!statsThresholdInput || !statsThresholdOutput || !cachedData) return;

  if (statsThresholdLabel) {
    const unit = filters.measure === 'rate' ? 'offenses per 100,000 residents per day' : 'offenses per day';
    statsThresholdLabel.textContent = `Threshold (${unit}):`;
  }

  const rawVal = statsThresholdInput.value.trim();
  if (!rawVal) {
    statsThresholdOutput.textContent = 'Enter a threshold to view exceedance probability.';
    return;
  }

  const threshold = Number(rawVal);
  if (!Number.isFinite(threshold) || threshold < 0) {
    statsThresholdOutput.textContent = 'Please enter a valid non-negative number.';
    return;
  }

  const { dailyTotalsByCity } = getFilteredData(cachedData);
  const reports = [];

  for (const cityCode of filters.cities) {
    const cityName = cachedData.cities[cityCode]?.name || cityCode;
    const cityMap = dailyTotalsByCity[cityCode] || new Map();
    const values = Array.from(cityMap.values());
    const countAbove = values.filter((v) => v >= threshold).length;
    const totalDays = values.length;
    const totalVol = sumOf(values);
    const volAbove = sumOf(values.filter((v) => v >= threshold));

    const pctDays = totalDays ? (countAbove / totalDays) * 100 : 0;
    const pctVol = totalVol ? (volAbove / totalVol) * 100 : 0;

    reports.push(totalDays
      ? `<strong>${escapeHtml(cityName)}</strong>: ${countAbove} of ${totalDays} days (${pctDays.toFixed(1)}%) met or exceeded ${threshold}, holding ${pctVol.toFixed(1)}% of total offenses.`
      : `<strong>${escapeHtml(cityName)}</strong>: no data in the selected dates.`);
  }

  statsThresholdOutput.innerHTML = reports.join('<br>') || 'No days matched the selection.';
}

/* ---------------------------------------------------------------------
   Data Table Rendering, Sorting, Pagination, and Search
   --------------------------------------------------------------------- */

function getProcessedTableRows() {
  const query = tableSearchQuery.trim().toLowerCase();
  let list = currentFilteredRows;

  if (query) {
    list = list.filter((r) =>
      r.date.includes(query) ||
      r.cityName.toLowerCase().includes(query) ||
      r.city.toLowerCase().includes(query) ||
      r.group.toLowerCase().includes(query) ||
      r.category.toLowerCase().includes(query)
    );
  }

  const dir = tableSortDir;
  const key = tableSortKey;

  list.sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (typeof va === 'string') {
      return va.localeCompare(vb) * dir;
    }
    return ((va || 0) - (vb || 0)) * dir;
  });

  return list;
}

function renderTable() {
  const { statsTableBody, statsTableCount, statsPageInfo, statsPrevPage, statsNextPage } = getElements();
  if (!statsTableBody) return;

  const processed = getProcessedTableRows();
  const total = processed.length;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  if (tablePage > maxPage) tablePage = maxPage;
  if (tablePage < 0) tablePage = 0;

  const startIdx = tablePage * PAGE_SIZE;
  const pageRows = processed.slice(startIdx, startIdx + PAGE_SIZE);

  if (statsTableCount) {
    statsTableCount.textContent = `Showing ${formatNumber(total)} filtered offense records (${filters.measure === 'rate' ? 'rates per 100k' : 'raw counts'})`;
  }

  if (statsPageInfo) {
    statsPageInfo.textContent = total > 0
      ? `Page ${tablePage + 1} of ${maxPage + 1} (${startIdx + 1}–${Math.min(startIdx + PAGE_SIZE, total)} of ${formatNumber(total)})`
      : 'No matching records';
  }

  if (statsPrevPage) statsPrevPage.disabled = tablePage === 0;
  if (statsNextPage) statsNextPage.disabled = tablePage >= maxPage;

  if (!pageRows.length) {
    statsTableBody.innerHTML = '<tr><td colspan="6" class="stats-empty">No records match your filters and search.</td></tr>';
    return;
  }

  statsTableBody.innerHTML = pageRows.map((r) => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td><strong>${escapeHtml(r.cityName)}</strong> <span class="stats-city-code">(${escapeHtml(r.city)})</span></td>
      <td><span class="stats-group-tag">${escapeHtml(r.group)}</span></td>
      <td>${escapeHtml(r.category)}</td>
      <td class="stats-num stats-count">${formatNumber(r.count)}</td>
      <td class="stats-num">${r.rate.toFixed(1)}</td>
    </tr>
  `).join('');
}

/* ---------------------------------------------------------------------
   CSV Export
   --------------------------------------------------------------------- */

/** A CSV text field: quoted, with quotes doubled. */
export function csvField(text) {
  return `"${String(text).replaceAll('"', '""')}"`;
}

function exportFilteredCsv() {
  const processed = getProcessedTableRows();
  if (!processed.length) {
    alert('No data to export.');
    return;
  }

  const headers = ['Date', 'City Code', 'City Name', 'Crime Group', 'Category', 'Offense Count', 'Rate Per 100k'];
  const lines = [headers.join(',')];

  for (const r of processed) {
    lines.push([r.date, r.city, csvField(r.cityName), csvField(r.group), csvField(r.category), r.count, r.rate].join(','));
  }

  const csvContent = lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `california_crime_stats_${filters.start}_to_${filters.end}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------
   Module Entry Points (setUpStatistics & renderStatistics)
   --------------------------------------------------------------------- */

export function setUpStatistics(data) {
  cachedData = data;
  const els = getElements();

  els.statsThresholdInput?.addEventListener('input', updateThresholdQuery);

  els.statsTableSearch?.addEventListener('input', (e) => {
    tableSearchQuery = e.target.value;
    tablePage = 0;
    renderTable();
  });

  els.statsPrevPage?.addEventListener('click', () => {
    if (tablePage > 0) {
      tablePage -= 1;
      renderTable();
    }
  });

  els.statsNextPage?.addEventListener('click', () => {
    tablePage += 1;
    renderTable();
  });

  els.statsExportCsv?.addEventListener('click', exportFilteredCsv);

  // Table header clicks for sorting
  els.statsDataTable?.querySelectorAll('th[data-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (tableSortKey === col) {
        tableSortDir = -tableSortDir;
      } else {
        tableSortKey = col;
        tableSortDir = (col === 'count' || col === 'rate') ? -1 : 1;
      }
      renderTable();
    });
  });
}

export function renderStatistics(data) {
  cachedData = data;
  const { rows, dailyTotalsByCity } = getFilteredData(data);
  currentFilteredRows = rows;

  renderKpiCards(data, dailyTotalsByCity);
  renderCharts(data, dailyTotalsByCity);
  updateThresholdQuery();
  renderTable();
}
