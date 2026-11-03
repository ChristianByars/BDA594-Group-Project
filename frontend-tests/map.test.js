import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { importFrontend, loadPage } from './helpers/page.js';

let perHundredThousand;

beforeEach(async () => {
  loadPage();
  ({ perHundredThousand } = await importFrontend('map.js'));
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
