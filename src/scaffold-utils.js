import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';

import { commandOutputTail, createSpinner, logger, spinnerFail, spinnerSucceed } from './utils.js';

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
  const spinner = createSpinner(label);
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

/**
 * Runs an optional step behind a spinner; reports failure instead of
 * throwing. `timeout` (ms) is for steps that run through a slow/unreliable
 * external process (e.g. `php artisan migrate` under a PHP setup with
 * Xdebug or similar attached) — execa kills the child and rejects once it's
 * exceeded, so a genuinely stuck process can't hang the whole CLI forever;
 * that rejection is handled the same as any other failure above.
 */
export async function tryRun({ label, success, failure, command, args, cwd, timeout }) {
  logger.dim(`  › ${formatCommand(command, args)}`);
  const spinner = createSpinner(label);
  try {
    await execa(command, args, { cwd, stdin: 'ignore', ...(timeout ? { timeout } : {}) });
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

/** Adds `scripts` entries without overwriting one the scaffolder already defined (e.g. Next.js's own dev/build/start/lint) — same "never touch what's already resolved" idea as mergeDependencies above. */
export async function mergeScripts(targetDir, scripts) {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = await fs.readJson(pkgPath);

  const existing = { ...(pkg.scripts ?? {}) };
  for (const [name, command] of Object.entries(scripts)) {
    if (existing[name]) continue;
    existing[name] = command;
  }

  pkg.scripts = existing;
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}

/**
 * React (Vite) scaffolds from this CLI always root everything under src/ —
 * confirmed by the react/react-ts Vite templates' own layout. Next.js's App
 * Router does not: create-next-app's current default (no --src-dir flag
 * passed by runNextCreate) puts app/ at the project root with no src/ at
 * all, and its tsconfig's "@/*" path alias maps straight to "./*" — the
 * same thing auth.js's setupNextAuth already assumes for app/api/auth/.
 * Shared here so state-management.js/api-layer.js/ui-kits.js don't each
 * have to special-case this per framework themselves.
 */
export function jsSrcRoot(framework) {
  return framework === 'next' ? '' : 'src';
}

/* ------------------------------------------------------------------ */
/* Next.js client-provider composition                                 */
/* ------------------------------------------------------------------ */

const NEXT_PROVIDERS_START = '{/* PROVIDERS */}';
const NEXT_PROVIDERS_END = '{/* /PROVIDERS */}';

/**
 * A JSX comment (an expression container holding only a comment) is only
 * legal as a JSX *child* — placed directly inside return(...)'s parens
 * instead, it parses as a plain (empty) object literal, immediately
 * followed by a second, illegally-adjacent expression: a syntax error. The
 * outer fragment below exists solely so the two NEXT_PROVIDERS sentinels
 * have a legal child position to sit in.
 */
const freshNextProvidersFile = (isTs) => `'use client';
${isTs ? "\nimport type { ReactNode } from 'react';\n" : ''}
export function Providers({ children }${isTs ? ': { children: ReactNode }' : ''}) {
  return (
    <>
      ${NEXT_PROVIDERS_START}
      <>{children}</>
      ${NEXT_PROVIDERS_END}
    </>
  );
}
`;

/**
 * Next.js's App Router root layout (app/layout.tsx) is a server component,
 * so any client-side context provider — Redux's <Provider>, Apollo's
 * <ApolloProvider>, MUI's <ThemeProvider>, ... — needs its own 'use client'
 * wrapper. State management, the API layer, and UI kits can each need one of
 * these, so rather than each feature writing (and clobbering) its own
 * src/app/providers.tsx, this nests a new provider around whatever already
 * sits between the PROVIDERS sentinel comments — safe to do repeatedly and
 * in any order because this file's exact shape is entirely ours; nothing
 * external ever generates or reads it except the one-time instruction
 * finalizeNextProviders() below pushes for wiring it into layout.tsx.
 */
export async function registerNextProvider(targetDir, isTs, { importLines, open, close }) {
  const ext = isTs ? 'tsx' : 'jsx';
  const providersPath = path.join(targetDir, 'app', `providers.${ext}`);

  let source = (await fs.pathExists(providersPath)) ? await fs.readFile(providersPath, 'utf8') : freshNextProvidersFile(isTs);

  // Inserted together (not one replace() per line) so a caller passing
  // several import lines gets them in declared order, each on its own
  // line — looping individual replace() calls against the same
  // "'use client';\n" anchor would instead insert each new call's lines
  // right after that anchor and ahead of every earlier call's, reversing
  // order across calls and (without a trailing newline on the anchor's
  // replacement) running consecutive lines from a single call together.
  const newLines = importLines.filter((line) => !source.includes(line));
  if (newLines.length > 0) {
    source = source.replace("'use client';\n", `'use client';\n${newLines.join('\n')}\n`);
  }

  const startIdx = source.indexOf(NEXT_PROVIDERS_START);
  const endIdx = source.indexOf(NEXT_PROVIDERS_END);
  if (startIdx === -1 || endIdx === -1) return false;

  const before = source.slice(0, startIdx + NEXT_PROVIDERS_START.length);
  const inner = source.slice(startIdx + NEXT_PROVIDERS_START.length, endIdx).trim();
  const after = source.slice(endIdx);

  // Idempotency guard: a re-run (or a duplicate call) sees its own tag
  // already wrapping the inner content and leaves it alone.
  const tagName = open.match(/^<([A-Za-z0-9_.]+)/)?.[1];
  if (tagName && inner.startsWith(`<${tagName}`)) return true;

  source = `${before}\n    ${open}\n      ${inner}\n    ${close}\n    ${after}`;
  await fs.writeFile(providersPath, source);
  return true;
}

/**
 * Wraps <App /> in a plain Vite React app's src/main.tsx|jsx with a client
 * provider — Redux's <Provider>, MUI's <ThemeProvider>, ... — via a single
 * literal string replace rather than a full JSX parse. Safe because Vite's
 * react/react-ts templates have kept this exact `<App />` render shape for
 * years; still guarded (returns false instead of guessing) if it's ever not
 * found, so a template change fails loud in a warning instead of silently
 * no-op-ing.
 */
export async function wrapViteReactRoot(targetDir, isTs, { importLine, open, close }) {
  const mainPath = path.join(targetDir, 'src', isTs ? 'main.tsx' : 'main.jsx');
  if (!(await fs.pathExists(mainPath))) return false;

  let source = await fs.readFile(mainPath, 'utf8');
  if (source.includes(importLine)) return true;
  if (!source.includes('<App />')) return false;

  source = `${importLine}\n${source}`;
  source = source.replace('<App />', `${open}\n      <App />\n    ${close}`);
  await fs.writeFile(mainPath, source);
  return true;
}

/**
 * Called once, after every feature that might have called
 * registerNextProvider() above has run — pushes a single "wire this in"
 * instruction (rather than one per feature) only when at least one provider
 * actually got composed. Mirrors auth.js's Express instruction: this CLI
 * never string-patches a file it didn't write itself (app/layout.tsx comes
 * from create-next-app, whose exact template text isn't ours to depend on),
 * so the last step is always a precise, copy-pasteable instruction instead.
 */
export async function finalizeNextProviders(targetDir, isTs, warnings) {
  const ext = isTs ? 'tsx' : 'jsx';
  const providersPath = path.join(targetDir, 'app', `providers.${ext}`);
  if (!(await fs.pathExists(providersPath))) return;

  warnings.push(
    `An app/providers.${ext} was generated to hold your client-side providers — wrap your app in it: add ` +
      `"import { Providers } from './providers';" near the top of app/layout.${ext}, then change "{children}" to "<Providers>{children}</Providers>".`
  );
}

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
