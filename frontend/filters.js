// The shared filter bar. Every tab reads `filters` when it renders.

import { addDays } from './data.js';
import { formatDate, themeColors } from './display.js';
import { createPills } from './pills.js';

/**
 * cities: selected city codes, in metadata order
 * group / category: '' for all; a category always sits inside the selected group
 * start / end: ISO dates, inclusive
 * measure: 'count' or 'rate' (offenses per 100,000 residents)
 */
export const filters = { cities: [], group: '', category: '', start: '', end: '', measure: 'count' };

// LA's data only includes offenses with a victim, so these groups undercount for LA.
export const UNRELIABLE_LA_GROUPS = ['Society', 'Other'];

const elements = Object.fromEntries([
  'cityToggles', 'groupPills', 'categoryPills', 'rangePills', 'startDate', 'endDate',
  'measurePills', 'filterNote',
].map((id) => [id, document.getElementById(id)]));

/** The crime group the selection covers, or '' for all groups. */
export function selectedGroup(data) {
  return filters.category ? data.groupOf[filters.category] : filters.group;
}

/** True when a row with this shared category matches the group and category filters. */
export function categoryMatches(data, category) {
  if (filters.category) return category === filters.category;
  return !filters.group || data.groupOf[category] === filters.group;
}

/** True when a row with this crime group matches. Group-level rows can't narrow to one category. */
export function groupMatches(data, group) {
  const wanted = selectedGroup(data);
  return !wanted || group === wanted;
}

/** Date presets: all data, the last 365 and 90 days, and each calendar year in the data. */
function datePresets(first, last) {
  const presets = [
    { value: 'all', label: 'All data', start: first, end: last },
    { value: 'last-365', label: 'Last 12 months', start: addDays(last, -364), end: last },
    { value: 'last-90', label: 'Last 90 days', start: addDays(last, -89), end: last },
  ];
  for (let year = Number(first.slice(0, 4)); year <= Number(last.slice(0, 4)); year += 1) {
    const end = `${year}-12-31` < last ? `${year}-12-31` : last;
    presets.push({ value: String(year), label: end === last ? `${year} to date` : String(year), start: `${year}-01-01`, end });
  }
  return presets.map((preset) => ({ ...preset, start: preset.start < first ? first : preset.start }));
}

let groupPills = null;
let categoryPills = null;
let rangePills = null;

function fillCategories(data) {
  const shown = data.categories.filter((category) => category.group !== 'Non-Crime'
    && (!filters.group || category.group === filters.group));
  categoryPills.setOptions([{ value: '', label: 'All' },
    ...shown.map((category) => ({ value: category.category, label: category.category }))], filters.category);
}

/** Repaints the city toggle swatches, for example after the theme changes. */
export function paintCityToggles() {
  const colors = themeColors().cities;
  for (const button of elements.cityToggles.querySelectorAll('button')) {
    button.querySelector('.city-swatch').style.background = colors[button.dataset.city];
  }
}

function updateNote(data) {
  const group = selectedGroup(data);
  const unreliable = filters.cities.includes('LA') && UNRELIABLE_LA_GROUPS.includes(group);
  elements.filterNote.hidden = !unreliable;
  elements.filterNote.textContent = unreliable
    ? `LA only includes offenses with a victim, so its ${group} numbers are unreliable and undercount.`
    : '';
}

/**
 * Builds the filter bar from the data and sets the defaults: every city, all crime, all dates, counts.
 * Calls onChange after any filter changes.
 */
export function setUpFilterBar(data, onChange) {
  const cityCodes = Object.keys(data.cities);
  filters.cities = [...cityCodes];
  elements.cityToggles.replaceChildren(...cityCodes.map((code) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill city-toggle';
    button.dataset.city = code;
    button.setAttribute('aria-pressed', 'true');
    button.innerHTML = `<span class="city-swatch"></span>${data.cities[code].name}`;
    return button;
  }));
  paintCityToggles();

  const changed = () => {
    updateNote(data);
    onChange();
  };

  const groups = [...new Set(data.categories.map((category) => category.group))].filter((group) => group !== 'Non-Crime');
  groupPills = createPills(elements.groupPills,
    [{ value: '', label: 'All' }, ...groups.map((group) => ({ value: group, label: group }))], '', (group) => {
      filters.group = group;
      if (filters.category && data.groupOf[filters.category] !== group) filters.category = '';
      fillCategories(data);
      changed();
    });
  categoryPills = createPills(elements.categoryPills, [], '', (category) => {
    filters.category = category;
    if (category && !filters.group) {
      filters.group = data.groupOf[category];
      groupPills.select(filters.group);
      fillCategories(data);
    }
    changed();
  });
  fillCategories(data);

  const first = data.metadata.cities.map((city) => city.first_date).sort()[0];
  const last = data.metadata.cities.map((city) => city.last_date).sort().at(-1);
  const presets = datePresets(first, last);
  for (const input of [elements.startDate, elements.endDate]) {
    input.min = first;
    input.max = last;
  }
  const applyPreset = (preset) => {
    filters.start = elements.startDate.value = preset.start;
    filters.end = elements.endDate.value = preset.end;
  };
  applyPreset(presets[0]);
  rangePills = createPills(elements.rangePills, presets, presets[0].value, (value) => {
    applyPreset(presets.find((preset) => preset.value === value));
    changed();
  });

  elements.cityToggles.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const on = button.getAttribute('aria-pressed') === 'true';
    if (on && filters.cities.length === 1) return; // keep at least one city
    button.setAttribute('aria-pressed', String(!on));
    filters.cities = cityCodes.filter((code) => elements.cityToggles
      .querySelector(`[data-city="${code}"]`).getAttribute('aria-pressed') === 'true');
    changed();
  });

  for (const input of [elements.startDate, elements.endDate]) {
    input.addEventListener('change', () => {
      if (!input.value) {
        input.value = input === elements.startDate ? filters.start : filters.end;
        return;
      }
      // Typed dates can fall outside min and max; pull them back inside the data.
      if (input.value < first) input.value = first;
      if (input.value > last) input.value = last;
      // Keep the range valid by moving the other end when the two cross.
      if (elements.startDate.value > elements.endDate.value) {
        const other = input === elements.startDate ? elements.endDate : elements.startDate;
        other.value = input.value;
      }
      filters.start = elements.startDate.value;
      filters.end = elements.endDate.value;
      const match = presets.find((preset) => preset.start === filters.start && preset.end === filters.end);
      rangePills.select(match ? match.value : '');
      changed();
    });
  }

  createPills(elements.measurePills, [
    { value: 'count', label: 'Offense count' },
    { value: 'rate', label: 'Per 100,000 residents' },
  ], filters.measure, (measure) => {
    filters.measure = measure;
    changed();
  });

  updateNote(data);
}

/** One line describing the selection, for the page header. */
export function describeSelection(data) {
  const cities = filters.cities.map((code) => data.cities[code].name).join(', ');
  const crime = filters.category || filters.group || 'All crime groups';
  return `${cities} · ${crime} · ${formatDate(filters.start)} – ${formatDate(filters.end)}`;
}
