import assert from 'node:assert/strict';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { FRONTEND } from './helpers/paths.js';
import { importFrontend, loadPage } from './helpers/page.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

let stats;

beforeEach(async () => {
  loadPage();
  stats = await importFrontend('statistics.js');
});

describe('describe', () => {
  it('summarises a list of daily totals', () => {
    const summary = stats.describe([1, 2, 3, 4]);
    assert.equal(summary.n, 4);
    assert.equal(summary.sum, 10);
    near(summary.mean, 2.5);
    near(summary.median, 2.5);
    near(summary.q1, 1.75);
    near(summary.q3, 3.25);
    near(summary.sd, Math.sqrt(5 / 3));
  });

  it('ignores values that are not finite numbers', () => {
    const summary = stats.describe([2, NaN, Infinity, 4, null, undefined]);
    assert.equal(summary.n, 2);
    near(summary.mean, 3);
  });

  it('returns a complete summary of zeros for an empty list', () => {
    const summary = stats.describe([]);
    for (const key of ['n', 'sum', 'mean', 'median', 'sd', 'cv', 'skew', 'min', 'max', 'q1', 'q3', 'iqr', 'p90', 'p95']) {
      assert.equal(summary[key], 0, key);
    }
  });
});

describe('giniCoefficient', () => {
  it('is 0 when every day is equal', () => {
    near(stats.giniCoefficient([5, 5, 5, 5]), 0);
  });

  it('is 0.75 when one of four days holds every offense', () => {
    near(stats.giniCoefficient([0, 0, 0, 10]), 0.75);
  });

  it('is 0 for fewer than two days or no offenses', () => {
    assert.equal(stats.giniCoefficient([7]), 0);
    assert.equal(stats.giniCoefficient([0, 0, 0]), 0);
    assert.equal(stats.giniCoefficient([]), 0);
  });
});

describe('lorenzPoints', () => {
  it('accumulates the share of offenses from the quietest day up', () => {
    const { x, y } = stats.lorenzPoints([2, 1, 1]);
    assert.equal(x.length, 4);
    near(x[1], 100 / 3);
    near(x[3], 100);
    assert.deepEqual(y, [0, 25, 50, 100]);
  });

  it('falls back to the line of equality when there is nothing to plot', () => {
    assert.deepEqual(stats.lorenzPoints([]), { x: [0, 100], y: [0, 100] });
    assert.deepEqual(stats.lorenzPoints([0, 0]), { x: [0, 100], y: [0, 100] });
  });
});

describe('fillZeroDays', () => {
  it('adds a 0 for each missing date and keeps the dates that have offenses', () => {
    const totals = new Map([['2025-01-02', 7]]);
    stats.fillZeroDays(totals, '2025-01-01', '2025-01-03');
    assert.deepEqual([...totals.entries()].sort(), [['2025-01-01', 0], ['2025-01-02', 7], ['2025-01-03', 0]]);
  });

  it('adds nothing when the range is empty', () => {
    const totals = new Map();
    stats.fillZeroDays(totals, '2025-01-05', '2025-01-01');
    assert.equal(totals.size, 0);
  });
});

describe('Statistics tab', () => {
  const DATA = {
    cities: {
      LA: { name: 'Los Angeles', first_date: '2025-01-01', last_date: '2025-01-04' },
      SD: { name: 'San Diego', first_date: '2025-01-01', last_date: '2025-01-02' },
    },
    groupOf: { Homicide: 'Violent', Burglary: 'Property' },
    populations: { LA: { 2025: 100000 }, SD: { 2025: 100000 } },
    dailyCounts: [
      { city: 'LA', date: '2025-01-01', category: 'Homicide', count: 4 },
      { city: 'LA', date: '2025-01-02', category: 'Burglary', count: 6 },
      { city: 'SD', date: '2025-01-01', category: 'Burglary', count: 2 },
    ],
  };

  let document;
  let filters;

  async function render(overrides) {
    ({ document } = loadPage());
    globalThis.Plotly = { react() {} };
    ({ filters } = await import(pathToFileURL(join(FRONTEND, 'filters.js')).href));
    Object.assign(filters, {
      cities: ['LA', 'SD'], group: '', category: '', start: '2025-01-01', end: '2025-01-04', measure: 'count',
    }, overrides);
    const page = await importFrontend('statistics.js');
    page.setUpStatistics(DATA);
    page.renderStatistics(DATA);
    return [...document.querySelectorAll('.stats-kpi-card')];
  }

  it('counts days with no matching offenses, so the mean is over every day', async () => {
    const [la] = await render({ category: 'Homicide' });
    assert.match(la.textContent, /4 days/);
    assert.match(la.textContent, /Daily Mean:\s*1\.0 offenses\/day/);
  });

  it('keeps a city that has no matching offenses and shows its zeros', async () => {
    const [, sd] = await render({ category: 'Homicide' });
    assert.match(sd.textContent, /2 days/);
    assert.match(sd.textContent, /Daily Mean:\s*0\.0/);
    assert.match(sd.textContent, /Peak Day:\s*—/);
  });

  it('shows a no-data card for a city whose data ends before the selected dates', async () => {
    const [la, sd] = await render({ start: '2025-01-03', end: '2025-01-04' });
    assert.match(la.textContent, /2 days/);
    assert.match(sd.textContent, /No data for this city in the selected dates/);
  });

  it('still fills the records table when a city has no matching offenses', async () => {
    await render({ category: 'Homicide' });
    assert.equal(document.querySelectorAll('#statsTableBody tr').length, 1);
  });

  describe('threshold query', () => {
    function setThreshold(value) {
      const input = document.getElementById('statsThresholdInput');
      input.value = value;
      input.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
      return document.getElementById('statsThresholdOutput').textContent;
    }

    it('counts days that meet the threshold, zero days included', async () => {
      await render({ category: 'Homicide' });
      const text = setThreshold('4');
      assert.match(text, /Los Angeles: 1 of 4 days \(25\.0%\) met or exceeded 4, holding 100\.0% of total offenses/);
      assert.match(text, /San Diego: 0 of 2 days \(0\.0%\) met or exceeded 4, holding 0\.0%/);
    });

    it('names the unit of the current measure', async () => {
      await render({});
      assert.equal(document.getElementById('statsThresholdLabel').textContent, 'Threshold (offenses per day):');
      await render({ measure: 'rate' });
      assert.equal(
        document.getElementById('statsThresholdLabel').textContent,
        'Threshold (offenses per 100,000 residents per day):',
      );
    });

    it('says so when a city has no data in the selected dates', async () => {
      await render({ start: '2025-01-03', end: '2025-01-04' });
      assert.match(setThreshold('1'), /San Diego: no data in the selected dates/);
    });

    it('rejects a negative threshold', async () => {
      await render({});
      assert.equal(setThreshold('-1'), 'Please enter a valid non-negative number.');
    });
  });
});
