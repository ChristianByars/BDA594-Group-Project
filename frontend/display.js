// Colors, number and date formats, and the Plotly settings every chart shares.

// One color per city on every chart: the first three categorical palette slots,
// stepped separately for the light and dark surfaces. Crime groups take the next five
// slots, so a group never shares a color with a city. groupInk is the label color
// inside a group's fill where white doesn't read (on the yellow slot).
export const THEMES = {
  light: {
    cities: { LA: '#2a78d6', SD: '#eb6834', SF: '#1baf7a' },
    groups: { Violent: '#eda100', Property: '#e87ba4', Vehicle: '#008300', Society: '#6250d6', Other: '#e34948' },
    groupInk: { Violent: '#0b0b0b' },
    surface: '#ffffff',
    text: '#374151',
    grid: '#e5e7eb',
    outline: '#4b5563',
    tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  },
  dark: {
    cities: { LA: '#3987e5', SD: '#d95926', SF: '#199e70' },
    groups: { Violent: '#c98500', Property: '#d55181', Vehicle: '#008300', Society: '#9085e9', Other: '#e66767' },
    groupInk: {},
    surface: '#111827',
    text: '#e5e7eb',
    grid: '#374151',
    outline: '#d1d5db',
    tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  },
};

const PLOT_CONFIG = { responsive: true, displayModeBar: false };

/**
 * Draws a Plotly chart at layout.height. The container gets exactly that height, because a
 * responsive resize sizes the chart to its container: a smaller container would squash it,
 * and the stylesheet's placeholder min-height would leave a gap under a short chart.
 */
export function drawChart(element, traces, layout) {
  element.style.height = `${layout.height}px`;
  element.style.minHeight = '0';
  Plotly.react(element, traces, layout, PLOT_CONFIG);
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function themeColors() {
  return THEMES[currentTheme()];
}

/** Layout settings shared by every Plotly chart: transparent background and theme text. */
export function baseLayout() {
  const theme = themeColors();
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: theme.text },
  };
}

export function formatNumber(value, digits = 0) {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatRate(value) {
  return formatNumber(value, value < 1 ? 2 : 1);
}

/** 'Jan 5, 2025' from '2025-01-05'. */
export function formatDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** 'Jan 2025' from '2025-01'. */
export function formatMonth(month) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
