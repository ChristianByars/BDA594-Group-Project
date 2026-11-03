import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clickPill, importFrontend, labelsIn, loadPage, pillsIn, pressedIn } from './helpers/page.js';

const DATA = {
  cities: {
    LA: { name: 'Los Angeles' },
    SD: { name: 'San Diego' },
    SF: { name: 'San Francisco' },
  },
  categories: [
    { category: 'Aggravated Assault', group: 'Violent' },
    { category: 'Robbery', group: 'Violent' },
    { category: 'Burglary', group: 'Property' },
    { category: 'Larceny', group: 'Property' },
    { category: 'Drug Offenses', group: 'Society' },
    { category: 'Lost Property Report', group: 'Non-Crime' },
  ],
  groupOf: {
    'Aggravated Assault': 'Violent',
    Robbery: 'Violent',
    Burglary: 'Property',
    Larceny: 'Property',
    'Drug Offenses': 'Society',
    'Lost Property Report': 'Non-Crime',
  },
  metadata: {
    cities: [
      { first_date: '2025-01-01', last_date: '2026-10-20' },
      { first_date: '2025-01-01', last_date: '2026-10-25' },
      { first_date: '2025-01-01', last_date: '2026-10-28' },
    ],
  },
};

const ALL_CATEGORIES = ['All', 'Aggravated Assault', 'Robbery', 'Burglary', 'Larceny', 'Drug Offenses'];

async function setUp() {
  const { window, document } = loadPage();
  const mod = await importFrontend('filters.js');
  const changes = [];
  mod.setUpFilterBar(DATA, () => changes.push({ ...mod.filters }));
  const field = (id) => document.getElementById(id);
  const type = (id, value) => {
    field(id).value = value;
    field(id).dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  return { document, mod, changes, field, type };
}

describe('starting state', () => {
  it('selects every city, all crime, every date and counts', async () => {
    const { mod, field } = await setUp();
    assert.deepEqual(mod.filters, {
      cities: ['LA', 'SD', 'SF'], group: '', category: '', start: '2025-01-01', end: '2026-10-28', measure: 'count',
    });
    assert.equal(field('startDate').value, '2025-01-01');
    assert.equal(field('endDate').value, '2026-10-28');
    assert.equal(field('startDate').min, '2025-01-01');
    assert.equal(field('endDate').max, '2026-10-28');
  });

  it('lists the crime groups and categories but not Non-Crime', async () => {
    const { document } = await setUp();
    assert.deepEqual(labelsIn(document, 'groupPills'), ['All', 'Violent', 'Property', 'Society']);
    assert.deepEqual(labelsIn(document, 'categoryPills'), ALL_CATEGORIES);
    assert.deepEqual(pressedIn(document, 'groupPills'), ['All']);
    assert.deepEqual(pressedIn(document, 'categoryPills'), ['All']);
  });

  it('offers the date presets and the two measures', async () => {
    const { document } = await setUp();
    assert.deepEqual(labelsIn(document, 'rangePills'), ['All data', 'Last 12 months', 'Last 90 days', '2025', '2026 to date']);
    assert.deepEqual(pressedIn(document, 'rangePills'), ['All data']);
    assert.deepEqual(labelsIn(document, 'measurePills'), ['Offense count', 'Per 100,000 residents']);
    assert.deepEqual(pressedIn(document, 'measurePills'), ['Offense count']);
  });

  it('describes the selection for the page header', async () => {
    const { mod } = await setUp();
    assert.equal(
      mod.describeSelection(DATA),
      'Los Angeles, San Diego, San Francisco · All crime groups · Jan 1, 2025 – Oct 28, 2026',
    );
  });
});

describe('crime group and category pills', () => {
  it('narrows the category pills to the clicked group and reports one change', async () => {
    const { document, mod, changes } = await setUp();
    clickPill(document, 'groupPills', 'Violent');
    assert.equal(mod.filters.group, 'Violent');
    assert.deepEqual(labelsIn(document, 'categoryPills'), ['All', 'Aggravated Assault', 'Robbery']);
    assert.deepEqual(pressedIn(document, 'groupPills'), ['Violent']);
    assert.deepEqual(pressedIn(document, 'categoryPills'), ['All']);
    assert.equal(changes.length, 1);
  });

  it('selects the category\'s group when a category is picked with All groups', async () => {
    const { document, mod, changes } = await setUp();
    clickPill(document, 'categoryPills', 'Burglary');
    assert.equal(mod.filters.category, 'Burglary');
    assert.equal(mod.filters.group, 'Property');
    assert.deepEqual(pressedIn(document, 'groupPills'), ['Property']);
    assert.deepEqual(labelsIn(document, 'categoryPills'), ['All', 'Burglary', 'Larceny']);
    assert.deepEqual(pressedIn(document, 'categoryPills'), ['Burglary']);
    assert.equal(changes.length, 1);
  });

  it('keeps the group when a category inside it is picked', async () => {
    const { document, mod } = await setUp();
    clickPill(document, 'groupPills', 'Property');
    clickPill(document, 'categoryPills', 'Larceny');
    assert.equal(mod.filters.group, 'Property');
    assert.equal(mod.filters.category, 'Larceny');
    assert.deepEqual(labelsIn(document, 'categoryPills'), ['All', 'Burglary', 'Larceny']);
  });

  it('clears a category that is outside the newly picked group', async () => {
    const { document, mod } = await setUp();
    clickPill(document, 'groupPills', 'Violent');
    clickPill(document, 'categoryPills', 'Robbery');
    clickPill(document, 'groupPills', 'Property');
    assert.equal(mod.filters.category, '');
    assert.deepEqual(pressedIn(document, 'categoryPills'), ['All']);
    assert.deepEqual(labelsIn(document, 'categoryPills'), ['All', 'Burglary', 'Larceny']);
  });

  it('lists every category again when All groups is picked', async () => {
    const { document, mod } = await setUp();
    clickPill(document, 'groupPills', 'Society');
    assert.deepEqual(labelsIn(document, 'categoryPills'), ['All', 'Drug Offenses']);
    clickPill(document, 'groupPills', 'All');
    assert.equal(mod.filters.group, '');
    assert.deepEqual(labelsIn(document, 'categoryPills'), ALL_CATEGORIES);
  });

  it('clears the category but keeps the group when the All category pill is picked', async () => {
    const { document, mod } = await setUp();
    clickPill(document, 'groupPills', 'Violent');
    clickPill(document, 'categoryPills', 'Robbery');
    clickPill(document, 'categoryPills', 'All');
    assert.equal(mod.filters.category, '');
    assert.equal(mod.filters.group, 'Violent');
    assert.deepEqual(labelsIn(document, 'categoryPills'), ['All', 'Aggravated Assault', 'Robbery']);
  });
});

describe('date range', () => {
  it('sets the range and both date boxes from a preset pill', async () => {
    const { document, mod, field, changes } = await setUp();
    const expected = {
      '2025': ['2025-01-01', '2025-12-31'],
      '2026 to date': ['2026-01-01', '2026-10-28'],
      'Last 12 months': ['2025-10-29', '2026-10-28'],
      'Last 90 days': ['2026-07-31', '2026-10-28'],
      'All data': ['2025-01-01', '2026-10-28'],
    };
    for (const [label, [start, end]] of Object.entries(expected)) {
      clickPill(document, 'rangePills', label);
      assert.deepEqual([mod.filters.start, mod.filters.end], [start, end], label);
      assert.deepEqual([field('startDate').value, field('endDate').value], [start, end], label);
      assert.deepEqual(pressedIn(document, 'rangePills'), [label]);
    }
    assert.equal(changes.length, 5);
  });

  it('clears the preset pill when a typed range matches no preset', async () => {
    const { document, mod, type, changes } = await setUp();
    type('startDate', '2025-03-15');
    assert.equal(mod.filters.start, '2025-03-15');
    assert.deepEqual(pressedIn(document, 'rangePills'), []);
    assert.equal(changes.length, 1);
  });

  it('presses a preset when the typed dates match it', async () => {
    const { document, type } = await setUp();
    type('endDate', '2025-12-31');
    assert.deepEqual(pressedIn(document, 'rangePills'), ['2025']);
    type('startDate', '2025-05-01');
    assert.deepEqual(pressedIn(document, 'rangePills'), []);
    type('startDate', '2025-01-01');
    assert.deepEqual(pressedIn(document, 'rangePills'), ['2025']);
  });

  it('pulls typed dates back inside the data', async () => {
    const { mod, field, type } = await setUp();
    type('startDate', '2024-06-01');
    assert.equal(field('startDate').value, '2025-01-01');
    type('endDate', '2027-01-01');
    assert.equal(field('endDate').value, '2026-10-28');
    assert.deepEqual([mod.filters.start, mod.filters.end], ['2025-01-01', '2026-10-28']);
  });

  it('moves the start when the end is typed before it', async () => {
    const { mod, field, type } = await setUp();
    type('startDate', '2025-06-01');
    type('endDate', '2025-03-01');
    assert.equal(field('startDate').value, '2025-03-01');
    assert.deepEqual([mod.filters.start, mod.filters.end], ['2025-03-01', '2025-03-01']);
  });

  it('moves the end when the start is typed after it', async () => {
    const { mod, field, type } = await setUp();
    type('endDate', '2025-03-01');
    type('startDate', '2025-06-01');
    assert.equal(field('endDate').value, '2025-06-01');
    assert.deepEqual([mod.filters.start, mod.filters.end], ['2025-06-01', '2025-06-01']);
  });

  it('puts the last good date back when a date box is cleared', async () => {
    const { mod, field, type, changes } = await setUp();
    type('startDate', '');
    assert.equal(field('startDate').value, '2025-01-01');
    assert.equal(mod.filters.start, '2025-01-01');
    assert.equal(changes.length, 0);
  });
});

describe('measure and city pills', () => {
  it('switches between counts and rates', async () => {
    const { document, mod, changes } = await setUp();
    clickPill(document, 'measurePills', 'Per 100,000 residents');
    assert.equal(mod.filters.measure, 'rate');
    assert.deepEqual(pressedIn(document, 'measurePills'), ['Per 100,000 residents']);
    clickPill(document, 'measurePills', 'Offense count');
    assert.equal(mod.filters.measure, 'count');
    assert.equal(changes.length, 2);
  });

  it('toggles cities off and on in metadata order', async () => {
    const { document, mod } = await setUp();
    clickPill(document, 'cityToggles', 'San Diego');
    assert.deepEqual(mod.filters.cities, ['LA', 'SF']);
    clickPill(document, 'cityToggles', 'Los Angeles');
    clickPill(document, 'cityToggles', 'San Diego');
    assert.deepEqual(mod.filters.cities, ['SD', 'SF']);
    const states = pillsIn(document, 'cityToggles').map((pill) => pill.getAttribute('aria-pressed'));
    assert.deepEqual(states, ['false', 'true', 'true']);
  });

  it('keeps at least one city on', async () => {
    const { document, mod, changes } = await setUp();
    clickPill(document, 'cityToggles', 'Los Angeles');
    clickPill(document, 'cityToggles', 'San Diego');
    clickPill(document, 'cityToggles', 'San Francisco');
    assert.deepEqual(mod.filters.cities, ['SF']);
    assert.deepEqual(pressedIn(document, 'cityToggles'), ['San Francisco']);
    assert.equal(changes.length, 2);
  });

  it('gives every city a color swatch', async () => {
    const { document } = await setUp();
    const swatches = [...document.querySelectorAll('#cityToggles .city-swatch')];
    assert.equal(swatches.length, 3);
    assert.ok(swatches.every((swatch) => swatch.style.background !== ''));
  });
});

describe('undercount note for Los Angeles', () => {
  it('shows for Society and Other while LA is selected, and hides otherwise', async () => {
    const { document, field } = await setUp();
    const note = field('filterNote');
    assert.equal(note.hidden, true);

    clickPill(document, 'groupPills', 'Society');
    assert.equal(note.hidden, false);
    assert.match(note.textContent, /Society numbers are unreliable/);

    clickPill(document, 'groupPills', 'Violent');
    assert.equal(note.hidden, true);
    assert.equal(note.textContent, '');
  });

  it('hides when LA is switched off and returns when it is switched on', async () => {
    const { document, field } = await setUp();
    const note = field('filterNote');
    clickPill(document, 'groupPills', 'Society');
    clickPill(document, 'cityToggles', 'Los Angeles');
    assert.equal(note.hidden, true);
    clickPill(document, 'cityToggles', 'Los Angeles');
    assert.equal(note.hidden, false);
  });

  it('follows a category picked from the Society group', async () => {
    const { document, field } = await setUp();
    clickPill(document, 'categoryPills', 'Drug Offenses');
    assert.equal(field('filterNote').hidden, false);
  });
});

describe('row matching', () => {
  it('lets every row through when nothing is selected', async () => {
    const { mod } = await setUp();
    assert.equal(mod.selectedGroup(DATA), '');
    assert.equal(mod.categoryMatches(DATA, 'Robbery'), true);
    assert.equal(mod.categoryMatches(DATA, 'Burglary'), true);
    assert.equal(mod.groupMatches(DATA, 'Property'), true);
  });

  it('matches only the selected group', async () => {
    const { document, mod } = await setUp();
    clickPill(document, 'groupPills', 'Property');
    assert.equal(mod.selectedGroup(DATA), 'Property');
    assert.equal(mod.categoryMatches(DATA, 'Burglary'), true);
    assert.equal(mod.categoryMatches(DATA, 'Robbery'), false);
    assert.equal(mod.groupMatches(DATA, 'Property'), true);
    assert.equal(mod.groupMatches(DATA, 'Violent'), false);
  });

  it('takes the group from the category when only a category is set', async () => {
    const { mod } = await setUp();
    mod.filters.category = 'Robbery';
    assert.equal(mod.selectedGroup(DATA), 'Violent');
    assert.equal(mod.groupMatches(DATA, 'Violent'), true);
    assert.equal(mod.groupMatches(DATA, 'Property'), false);
  });

  it('matches only the selected category, and its group at the group level', async () => {
    const { document, mod } = await setUp();
    clickPill(document, 'categoryPills', 'Robbery');
    assert.equal(mod.selectedGroup(DATA), 'Violent');
    assert.equal(mod.categoryMatches(DATA, 'Robbery'), true);
    assert.equal(mod.categoryMatches(DATA, 'Aggravated Assault'), false);
    assert.equal(mod.groupMatches(DATA, 'Violent'), true);
    assert.equal(mod.groupMatches(DATA, 'Property'), false);
  });
});
