// Page entry point: loads the data, wires the filter bar, theme toggle and tabs, and renders the active tab.

import { renderCompare } from './compare.js';
import { renderCorrelation } from './correlation.js';
import { loadData } from './data.js';
import { currentTheme, formatNumber } from './display.js';
import { categoryMatches, describeSelection, filters, paintCityToggles, setUpFilterBar } from './filters.js';
import { renderMap, resizeMap, setMapTheme, setUpMap } from './map.js';
import { renderTrends, setUpTrends } from './trends.js';

const elements = Object.fromEntries([
  'themeToggle', 'themeToggleText', 'status', 'dashboardMeta', 'tabBar',
].map((id) => [id, document.getElementById(id)]));

const RENDERERS = {
  trends: renderTrends,
  compare: renderCompare,
  correlation: renderCorrelation,
  map: renderMap,
};

let data = null;
let activeTab = 'trends';
// Each filter or theme change bumps the version; a tab re-renders on show only if it's behind.
let version = 0;
const renderedVersion = {};

function selectionTotal() {
  let total = 0;
  for (const row of data.dailyCounts) {
    if (filters.cities.includes(row.city) && row.date >= filters.start && row.date <= filters.end
      && categoryMatches(data, row.category)) total += row.count;
  }
  return total;
}

function renderActiveTab() {
  RENDERERS[activeTab](data);
  renderedVersion[activeTab] = version;
}

function render() {
  version += 1;
  elements.dashboardMeta.textContent = `${describeSelection(data)} · ${formatNumber(selectionTotal())} offenses`;
  renderActiveTab();
}

/** Shows a tab's panel, rendering it first if the filters changed since it was last drawn. */
function showTab(name) {
  activeTab = name;
  for (const tab of elements.tabBar.querySelectorAll('[role="tab"]')) {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
  }
  if (!data) return;
  if (renderedVersion[name] !== version) {
    renderActiveTab();
  } else {
    // Charts drawn while their panel was hidden need resizing once it's visible.
    for (const chart of document.querySelectorAll(`#${name}Panel .js-plotly-plot`)) Plotly.Plots.resize(chart);
    if (name === 'map') resizeMap();
  }
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  elements.themeToggleText.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode';
  setMapTheme(theme);
}

async function init() {
  setTheme('light');
  elements.themeToggle.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    if (!data) return;
    paintCityToggles();
    render();
  });
  elements.tabBar.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) showTab(tab.dataset.tab);
  });

  try {
    data = await loadData();
    setUpFilterBar(data, render);
    setUpTrends(data);
    setUpMap(data);
    render();
    const { metadata } = data;
    elements.status.textContent = `Data exported ${metadata.exported_at.slice(0, 10)} from crime.db built ${metadata.database_built_at.slice(0, 10)}.`;
  } catch (error) {
    console.error(error);
    elements.status.textContent = `Error loading data: ${error.message}`;
    elements.status.classList.add('error');
  }
}

init();
