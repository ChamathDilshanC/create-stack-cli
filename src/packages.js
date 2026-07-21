import path from 'node:path';
import fs from 'fs-extra';

import { installOrRecord } from './scaffold-utils.js';
import { pipInstallOrRecord } from './python-utils.js';

const NPM_SEARCH_BASE = 'https://registry.npmjs.org/-/v1/search';
const NPM_REGISTRY_BASE = 'https://registry.npmjs.org';
const PYPI_BASE = 'https://pypi.org/pypi';

/**
 * Searches the live npm registry — the same public search API npmjs.com's
 * own website search uses — instead of maintaining any kind of curated
 * package list in this CLI. Unlike Spring Initializr's ~150-entry dependency
 * catalog (small enough to fetch whole and filter client-side), npm has
 * millions of packages, so this is a real per-query search rather than a
 * one-time fetch — see prompts.js's stepExtraPackages for the search loop
 * this powers. Returns clack's `{ value, label, hint }` option shape.
 */
export async function searchNpmPackages(query, size = 15) {
  const params = new URLSearchParams({ text: query, size: String(size) });
  const res = await fetch(`${NPM_SEARCH_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`npm registry search responded with HTTP ${res.status}`);
  const data = await res.json();
  return (data.objects ?? []).map(({ package: pkg }) => ({
    value: pkg.name,
    label: `${pkg.name}@${pkg.version}`,
    hint: pkg.description ?? '',
  }));
}

/** True if `name` exists on PyPI right now. PyPI retired its old public search API years ago, so an existence check is the closest live equivalent available for Python. */
export async function pypiPackageExists(name) {
  const res = await fetch(`${PYPI_BASE}/${encodeURIComponent(name)}/json`);
  return res.ok;
}

/** The latest published version on npm, resolved fresh right before installing — the same "pin a floor, don't guess" approach every other Node dependency in this CLI already uses. */
async function latestNpmVersion(name) {
  try {
    const res = await fetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(name)}/latest`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Installs whatever extra packages were picked during the wizard (or passed
 * via --extra-packages) — searched/checked live against npm or PyPI, never a
 * list bundled in this package. A no-op when nothing was picked, which is
 * the common case, so every project type can call this unconditionally.
 *
 * Existence is verified here, not just in prompts.js's interactive search
 * loop: --extra-packages skips that loop entirely (it's meant for scripting,
 * with no interactive validation opportunity), so a typo'd or nonexistent
 * package name would otherwise land silently in requirements.txt/package.json
 * with no error and no warning.
 */
export async function applyExtraPackages(options, warnings) {
  const requested = options.extraPackages ?? [];
  if (requested.length === 0) return;

  if (options.runtime === 'python') {
    const exists = await Promise.all(requested.map((name) => pypiPackageExists(name)));
    const packages = requested.filter((_, i) => exists[i]);
    const missing = requested.filter((_, i) => !exists[i]);
    if (missing.length > 0) {
      warnings.push(`Not found on PyPI, so not added: ${missing.join(', ')}. Check the spelling and add manually if needed.`);
    }
    if (packages.length === 0) return;

    const venvReady = await fs.pathExists(path.join(options.targetDir, '.venv'));
    await pipInstallOrRecord({ options, warnings, packages, label: 'Extra packages', venvReady });
    return;
  }

  if (options.runtime === 'node') {
    const versions = await Promise.all(requested.map((name) => latestNpmVersion(name)));
    const floors = {};
    requested.forEach((name, i) => {
      if (versions[i]) floors[name] = `^${versions[i]}`;
    });
    const packages = Object.keys(floors);
    const missing = requested.filter((name) => !floors[name]);
    if (missing.length > 0) {
      warnings.push(`Not found on npm, so not added: ${missing.join(', ')}. Check the spelling and add manually if needed.`);
    }
    if (packages.length === 0) return;

    await installOrRecord({ options, warnings, packages, floors, dev: false, label: 'Extra packages' });
  }
}
