import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// FRONTEND_DIR points the tests at another copy of the page.
export const FRONTEND = process.env.FRONTEND_DIR
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend');
