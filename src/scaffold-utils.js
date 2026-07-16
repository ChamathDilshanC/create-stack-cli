import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import ora from 'ora';

import { commandOutputTail, logger, spinnerFail, spinnerSucceed } from './utils.js';

/** `<pm> <args> <packages>` prefix that adds dev dependencies, per manager. */
export const ADD_DEV_ARGS = {
  npm: ['install', '--save-dev'],
  yarn: ['add', '--dev'],
  pnpm: ['add', '--save-dev'],
  bun: ['add', '--dev'],
};

/** `<pm> <args> <packages>` prefix that adds runtime dependencies, per manager. */
export const ADD_DEP_ARGS = {
  npm: ['install'],
  yarn: ['add'],
  pnpm: ['add'],
  bun: ['add'],
};

export const formatCommand = (command, args) => [command, ...args].join(' ');

/**
 * Runs a required step behind a spinner. `stdin: 'ignore'` makes any
 * unexpected interactive prompt in the child fail fast instead of hanging
 * the CLI forever. Some scaffolders (e.g. @angular/create's Node version
 * check) print an error but still exit 0, so a successful exit only counts
 * when `expectFile` was actually created.
 */
export async function runScaffolder({ label, success, command, args, cwd, expectFile }) {
  logger.dim(`  › ${formatCommand(command, args)}`);
  const spinner = ora({ text: label, indent: 2 }).start();
  let result;
  try {
    result = await execa(command, args, { cwd, stdin: 'ignore' });
  } catch (err) {
    spinnerFail(spinner, `${label.replace(/\.{3}$/, '')} failed.`);
    const tail = commandOutputTail(err);
    throw new Error(
      `\`${formatCommand(command, args)}\` exited with an error.` +
        (tail ? `\n\n${tail}` : '') +
        '\n\nIf this looks like a network hiccup, check your connection and try again.'
    );
  }

  if (expectFile && !(await fs.pathExists(expectFile))) {
    spinnerFail(spinner, `${label.replace(/\.{3}$/, '')} failed.`);
    const tail = commandOutputTail(result);
    throw new Error(
      `\`${formatCommand(command, args)}\` finished without creating a project.` +
        (tail ? `\n\n${tail}` : '')
    );
  }

  spinnerSucceed(spinner, success);
}

/** Runs an optional step behind a spinner; reports failure instead of throwing. */
export async function tryRun({ label, success, failure, command, args, cwd }) {
  logger.dim(`  › ${formatCommand(command, args)}`);
  const spinner = ora({ text: label, indent: 2 }).start();
  try {
    await execa(command, args, { cwd, stdin: 'ignore' });
    spinnerSucceed(spinner, success);
    return true;
  } catch (err) {
    spinnerFail(spinner, failure);
    const tail = commandOutputTail(err);
    if (tail) logger.dim(tail);
    return false;
  }
}

/**
 * Scaffolders are always invoked from the target directory's *parent*, with
 * just the leaf folder name as the argument — the same way `npm create
 * vite@latest my-app` is documented. A relative path computed from our own
 * (arbitrary) cwd can require many "../" segments — e.g. CI checks out the
 * repo somewhere and scaffolds into /tmp — and tools like the Angular CLI's
 * --directory validate against that shape; path.relative() can also never
 * cross drive letters on Windows. Using the parent dir as cwd sidesteps both.
 */
export async function scaffolderInvocation(targetDir) {
  const cwd = path.dirname(targetDir);
  await fs.ensureDir(cwd);
  return { cwd, dirArg: path.basename(targetDir) };
}

/** The scaffolders derive the name from the directory; use the validated one. */
export async function normalizePackageJson(options) {
  const pkgPath = path.join(options.targetDir, 'package.json');
  if (!(await fs.pathExists(pkgPath))) return;

  const pkg = await fs.readJson(pkgPath);
  pkg.name = options.packageName;
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}

/** Adds dependencies without touching ranges a live install already wrote. */
export async function mergeDependencies(targetDir, deps, field = 'devDependencies') {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = await fs.readJson(pkgPath);

  const existing = { ...(pkg[field] ?? {}) };
  for (const [name, range] of Object.entries(deps)) {
    if (existing[name] || pkg.dependencies?.[name] || pkg.devDependencies?.[name]) continue;
    existing[name] = range;
  }

  pkg[field] = Object.fromEntries(Object.entries(existing).sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}

/** Back-compat alias — most call sites only ever touched devDependencies. */
export const mergeDevDependencies = (targetDir, deps) => mergeDependencies(targetDir, deps, 'devDependencies');

/**
 * Installs `packages` (dev or runtime) with a live command when allowed on
 * the network; otherwise (or on failure) merges version floors into
 * package.json so the user's next `<pm> install` resolves them. Pushes a
 * warning on the fallback path so the summary tells them what's left to do.
 *
 * If any of `packages` are already declared in package.json (some official
 * scaffolders — Electron Forge, create-hono — ship eslint/prettier-family
 * packages of their own, sometimes at older major versions with peer
 * requirements of their own), a live install is skipped in favor of the
 * same safe merge-only fallback: forcing our version range on top of an
 * already-resolved one is exactly what triggers npm ERESOLVE conflicts.
 */
export async function installOrRecord({ options, warnings, packages, floors, dev = true, label }) {
  const { pm, targetDir, install } = options;
  const args = dev ? ADD_DEV_ARGS[pm] : ADD_DEP_ARGS[pm];

  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = (await fs.pathExists(pkgPath)) ? await fs.readJson(pkgPath) : {};
  const alreadyDeclared = packages.some(
    (name) => pkg.dependencies?.[name] || pkg.devDependencies?.[name]
  );

  if (install && !alreadyDeclared) {
    const installed = await tryRun({
      label: `Installing ${label}...`,
      success: `${label} installed.`,
      failure: `${label} could not be downloaded.`,
      command: pm,
      args: [...args, ...packages],
      cwd: targetDir,
    });
    if (installed) return;
    warnings.push(
      `${label} were added to package.json but not downloaded — run "${pm} install" inside the project to finish setup.`
    );
  }

  await mergeDependencies(targetDir, floors, dev ? 'devDependencies' : 'dependencies');
}
