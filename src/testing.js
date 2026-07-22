import path from 'node:path';
import fs from 'fs-extra';

import { installOrRecord, mergeScripts } from './scaffold-utils.js';

/** Human labels for the warning path — kept local rather than importing prompts.js's TESTING_OPTIONS, since this module only ever needs these three. */
const NOT_YET_WIRED_LABELS = {
  jest: 'Jest',
  playwright: 'Playwright',
  cypress: 'Cypress',
};

const VITEST_CONFIG = (environment) => `/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: '${environment}',
    globals: true,
  },
});
`;

/**
 * Deliberately minimal: a trivial, always-passing sanity assertion, not a
 * real component/route test. Wiring `@testing-library/react` (or its Vue/
 * Svelte/Solid equivalents) or a supertest-backed request against the actual
 * server is real, separate scope for a later step — this one only proves
 * Vitest itself is correctly installed and configured.
 */
const EXAMPLE_TEST = `import { describe, expect, it } from 'vitest';

describe('sanity check', () => {
  it('confirms Vitest itself is wired up correctly', () => {
    expect(1 + 1).toBe(2);
  });
});
`;

async function setupVitest(options, warnings, { environment, testDir }) {
  const { targetDir, language } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';

  const deps = { vitest: '^3.0.0' };
  // Vitest doesn't bundle a DOM implementation — jsdom is only needed (and
  // only installed) for frontend/fullstack, where component code actually
  // touches `document`/`window`; plain backend code has no use for it.
  if (environment === 'jsdom') deps.jsdom = '^25.0.0';

  await installOrRecord({ options, warnings, packages: Object.keys(deps), floors: deps, dev: true, label: 'Vitest' });

  await fs.writeFile(path.join(targetDir, `vitest.config.${ext}`), VITEST_CONFIG(environment));
  await fs.outputFile(path.join(targetDir, testDir, `example.test.${ext}`), EXAMPLE_TEST);
  await mergeScripts(targetDir, { test: 'vitest run', 'test:watch': 'vitest' });
}

/**
 * `environment`/`testDir` are decided by the caller (scaffold.js's
 * handlers), which already knows whether this framework's code runs in a
 * browser-like context (jsdom) or plain Node, and where its source lives —
 * same division of responsibility `applyDatabase`'s `modelsDir` param uses.
 */
export async function applyTesting(options, warnings, { environment = 'node', testDir = 'src' } = {}) {
  if (!options.testing || options.testing === 'none') return;

  if (options.testing !== 'vitest') {
    const label = NOT_YET_WIRED_LABELS[options.testing] ?? options.testing;
    warnings.push(`${label} was selected for testing but isn't wired up in this CLI yet — install it yourself, or re-run and pick Vitest/None.`);
    return;
  }

  return setupVitest(options, warnings, { environment, testDir });
}
