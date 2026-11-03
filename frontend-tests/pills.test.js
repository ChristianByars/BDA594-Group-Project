import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { importFrontend, loadPage } from './helpers/page.js';

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

let createPills;
let container;
let changes;

const pill = (value) => container.querySelector(`[data-value="${value}"]`);
const labels = () => [...container.children].map((child) => child.textContent);
const pressed = () => [...container.children]
  .filter((child) => child.getAttribute('aria-pressed') === 'true')
  .map((child) => child.dataset.value);
const make = (options = OPTIONS, value = 'a') => createPills(container, options, value, (next) => changes.push(next));

beforeEach(async () => {
  const { document } = loadPage();
  ({ createPills } = await importFrontend('pills.js'));
  container = document.createElement('div');
  document.body.append(container);
  changes = [];
});

describe('createPills', () => {
  it('draws one button per option and presses the starting value', () => {
    make();
    assert.deepEqual(labels(), ['Alpha', 'Beta', 'Gamma']);
    assert.deepEqual(pressed(), ['a']);
    assert.ok([...container.children].every((child) => child.tagName === 'BUTTON' && child.type === 'button'));
  });

  it('presses a clicked pill and reports its value once', () => {
    const pills = make();
    pill('b').click();
    assert.deepEqual(pressed(), ['b']);
    assert.equal(pills.value, 'b');
    assert.deepEqual(changes, ['b']);
  });

  it('ignores a click on the pill that is already pressed', () => {
    make();
    pill('a').click();
    assert.deepEqual(changes, []);
    assert.deepEqual(pressed(), ['a']);
  });

  it('select() presses a pill without reporting a change', () => {
    const pills = make();
    pills.select('c');
    assert.deepEqual(pressed(), ['c']);
    assert.equal(pills.value, 'c');
    assert.deepEqual(changes, []);
  });

  it('presses nothing when the value matches no pill', () => {
    const pills = make();
    pills.select('');
    assert.deepEqual(pressed(), []);
  });

  it('handles an empty-string value such as the All pill', () => {
    const pills = make([{ value: '', label: 'All' }, ...OPTIONS], '');
    assert.deepEqual(pressed(), ['']);
    pill('b').click();
    pill('').click();
    assert.deepEqual(changes, ['b', '']);
    assert.equal(pills.value, '');
  });

  it('ignores clicks that land between pills', () => {
    make();
    container.click();
    assert.deepEqual(changes, []);
  });
});

describe('setOptions', () => {
  it('keeps existing buttons, drops stale ones and adds new ones in order', () => {
    const pills = make();
    const alpha = pill('a');
    const beta = pill('b');
    pills.setOptions([OPTIONS[0], { value: 'd', label: 'Delta' }, OPTIONS[1]]);
    assert.deepEqual(labels(), ['Alpha', 'Delta', 'Beta']);
    assert.equal(pill('a'), alpha);
    assert.equal(pill('b'), beta);
    assert.equal(pill('c'), null);
  });

  it('puts kept buttons in the new order', () => {
    const pills = make();
    pills.setOptions([OPTIONS[2], OPTIONS[0]]);
    assert.deepEqual(labels(), ['Gamma', 'Alpha']);
  });

  it('updates the label of a kept button', () => {
    const pills = make();
    pills.setOptions([{ value: 'a', label: 'Alpha 2' }, OPTIONS[1], OPTIONS[2]]);
    assert.deepEqual(labels(), ['Alpha 2', 'Beta', 'Gamma']);
  });

  it('keeps the current value unless a new one is given', () => {
    const pills = make();
    pills.select('b');
    pills.setOptions(OPTIONS);
    assert.deepEqual(pressed(), ['b']);
    pills.setOptions(OPTIONS, 'c');
    assert.deepEqual(pressed(), ['c']);
    assert.equal(pills.value, 'c');
  });

  it('presses nothing when the current value is no longer offered', () => {
    const pills = make();
    pills.setOptions([OPTIONS[1], OPTIONS[2]]);
    assert.deepEqual(pressed(), []);
  });

  it('reports a click on a pill added later', () => {
    const pills = make([], '');
    pills.setOptions(OPTIONS, 'a');
    pill('c').click();
    assert.deepEqual(changes, ['c']);
  });
});

describe('setDisabled', () => {
  it('disables every pill, blocks clicks, and can be undone', () => {
    const pills = make();
    pills.setDisabled(true);
    assert.ok([...container.children].every((child) => child.disabled));
    pill('b').click();
    assert.deepEqual(changes, []);
    assert.equal(pills.value, 'a');

    pills.setDisabled(false);
    assert.ok([...container.children].every((child) => !child.disabled));
    pill('b').click();
    assert.deepEqual(changes, ['b']);
  });

  it('ignores a click event that reaches a disabled pill anyway', () => {
    const pills = make();
    pills.setDisabled(true);
    pill('b').dispatchEvent(new container.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(changes, []);
    assert.equal(pills.value, 'a');
  });
});
