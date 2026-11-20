import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { importFrontend, loadPage } from './helpers/page.js';

let perHundredThousand;
let quantileBreaks;
let zipCounts;
let legendHtml;

beforeEach(async () => {
  loadPage();
  ({ perHundredThousand, quantileBreaks, zipCounts, legendHtml } = await importFrontend('map.js'));
});

describe('perHundredThousand', () => {
  it('scales offenses to a population of 100,000', () => {
    assert.equal(perHundredThousand(50, 10000), 500);
    assert.equal(perHundredThousand(1, 100000), 1);
    assert.equal(perHundredThousand(250, 1000000), 25);
  });

  it('is 100 times the per-1,000 rate', () => {
    assert.equal(perHundredThousand(3, 2000), 150);
  });

  it('is 0 when there are no offenses', () => {
    assert.equal(perHundredThousand(0, 10000), 0);
  });

  it('is null when the population is missing or zero', () => {
    assert.equal(perHundredThousand(5, 0), null);
    assert.equal(perHundredThousand(5, null), null);
    assert.equal(perHundredThousand(5, undefined), null);
  });
});

describe('quantileBreaks', () => {
  it('splits a run of 8 values into 4 classes', () => {
    assert.deepEqual(quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8], 4), [3, 5, 7]);
  });

  it('rounds a fractional class boundary down to the lower index', () => {
    assert.deepEqual(quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4), [3, 6, 8]);
  });

  it('collapses duplicate breaks when values repeat', () => {
    assert.deepEqual(quantileBreaks([1, 1, 1, 1, 5, 5, 5, 5], 4), [5]);
  });

  it('ignores null values', () => {
    assert.deepEqual(quantileBreaks([1, null, 2, null], 2), [2]);
  });

  it('is empty for no values', () => {
    assert.deepEqual(quantileBreaks([], 4), []);
  });
});

describe('zipCounts', () => {
  // All SD unless noted; row shape { city, month, zip, category, count }.
  const rows = [
    { city: 'SD', month: '2025-01', zip: '92101', category: 'Burglary', count: 3 },
    { city: 'SD', month: '2025-01', zip: '92101', category: 'Theft', count: 5 },
    { city: 'SD', month: '2025-02', zip: '92101', category: 'Burglary', count: 7 },
    { city: 'SD', month: '2025-01', zip: '92102', category: 'Theft', count: 11 },
    { city: 'SD', month: '2025-03', zip: '92103', category: 'Theft', count: 2 },
    { city: 'SD', month: '2025-01', zip: null, category: 'Theft', count: 17 },
    { city: 'SF', month: '2025-01', zip: '94110', category: 'Theft', count: 13 },
  ];

  it('sums every matching category for every ZIP in the city', () => {
    const months = { start: '2025-01', end: '2025-01' };
    assert.deepEqual(zipCounts(rows, 'SD', months, () => true), { 92101: 8, 92102: 11, 92103: 0 });
  });

  it('sums only the matching category', () => {
    const months = { start: '2025-01', end: '2025-01' };
    assert.deepEqual(zipCounts(rows, 'SD', months, (category) => category === 'Burglary'), { 92101: 3, 92102: 0, 92103: 0 });
  });

  it('includes every month in range', () => {
    const months = { start: '2025-01', end: '2025-02' };
    assert.deepEqual(zipCounts(rows, 'SD', months, (category) => category === 'Burglary'), { 92101: 10, 92102: 0, 92103: 0 });
  });

  it('drops the null-ZIP row and rows from other cities', () => {
    const months = { start: '2025-01', end: '2025-01' };
    const counts = zipCounts(rows, 'SD', months, () => true);
    assert.equal(Object.keys(counts).length, 3);
    assert.equal(counts.null, undefined);
  });
});

describe('legendHtml', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8];
  const breaks = [3, 5, 7];

  function rowsOf(div) {
    return [...div.querySelectorAll('.legend-swatch')].map((swatch) => swatch.parentElement);
  }

  it('titles count values "Offenses" with one row per class', () => {
    const div = document.createElement('div');
    div.innerHTML = legendHtml({ breaks, values, measure: 'count' });
    assert.equal(div.querySelector('strong').textContent, 'Offenses');
    assert.deepEqual(rowsOf(div).map((row) => row.textContent), ['1 – 3', '3 – 5', '5 – 7', '7 – 8']);
  });

  it('puts only a --swatch custom property in style, never anything else', () => {
    const div = document.createElement('div');
    div.innerHTML = legendHtml({ breaks, values, measure: 'count' });
    for (const element of div.querySelectorAll('*')) {
      if (element.classList.contains('legend-swatch')) {
        assert.match(element.getAttribute('style'), /^--swatch:#[0-9a-f]{6}$/);
      } else {
        assert.equal(element.getAttribute('style'), null);
      }
    }
  });

  it('titles rate values "Offenses per 100,000 residents"', () => {
    const div = document.createElement('div');
    div.innerHTML = legendHtml({ breaks, values, measure: 'rate' });
    assert.equal(div.querySelector('strong').textContent, 'Offenses per 100,000 residents');
  });

  it('adds a no-data row when a value is null', () => {
    const div = document.createElement('div');
    div.innerHTML = legendHtml({ breaks, values: [...values, null], measure: 'count' });
    const rows = rowsOf(div);
    assert.equal(rows.length, 5);
    assert.equal(rows.at(-1).textContent, 'No residents or no population data');
  });

  it('is empty when every value is null', () => {
    assert.equal(legendHtml({ breaks: [], values: [null, null], measure: 'count' }), '');
  });
});

describe('escapeHtml', () => {
  let escapeHtml;
  beforeEach(async () => {
    ({ escapeHtml } = await importFrontend('display.js'));
  });

  it('escapes the five HTML-significant characters', () => {
    assert.equal(escapeHtml('<img id="x" src=a>&"\''), '&lt;img id=&quot;x&quot; src=a&gt;&amp;&quot;&#39;');
  });

  it('is empty for null or undefined', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
  });

  it('leaves a number as its string', () => {
    assert.equal(escapeHtml(5), '5');
  });

  it('defeats an injection into innerHTML', () => {
    const div = document.createElement('div');
    div.innerHTML = escapeHtml('<img id="x" src=a>&"\'');
    assert.equal(div.querySelector('#x'), null);
  });
});

describe('index.html map panel', () => {
  it('has no city or measure pills, and has the legend and grid', () => {
    const { document } = loadPage();
    assert.equal(document.getElementById('mapCity'), null);
    assert.equal(document.getElementById('mapMeasure'), null);
    assert.equal(document.querySelector('#mapPanel .panel-controls'), null);
    assert.notEqual(document.getElementById('mapLegend'), null);
    assert.notEqual(document.getElementById('mapGrid'), null);
  });
});
