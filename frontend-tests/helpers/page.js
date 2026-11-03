import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';

import { FRONTEND } from './paths.js';

let loads = 0;

/** A fresh copy of index.html as the global page, so each test starts clean. */
export function loadPage() {
  const { window } = new JSDOM(readFileSync(join(FRONTEND, 'index.html'), 'utf8'));
  globalThis.window = window;
  globalThis.document = window.document;
  return { window, document: window.document };
}

/** Imports a frontend module as a new copy, so its state and page lookups start over. */
export function importFrontend(name) {
  return import(`${pathToFileURL(join(FRONTEND, name)).href}?load=${loads++}`);
}

/** Dates and labels that the filter bar tests read back. */
export function pillsIn(document, id) {
  return [...document.querySelectorAll(`#${id} button`)];
}

export function labelsIn(document, id) {
  return pillsIn(document, id).map((pill) => pill.textContent);
}

export function pressedIn(document, id) {
  return pillsIn(document, id).filter((pill) => pill.getAttribute('aria-pressed') === 'true').map((pill) => pill.textContent);
}

export function clickPill(document, id, label) {
  const pill = pillsIn(document, id).find((candidate) => candidate.textContent === label);
  if (!pill) throw new Error(`No "${label}" pill in #${id}`);
  pill.click();
}
