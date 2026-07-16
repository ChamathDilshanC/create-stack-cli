import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import ora from 'ora';

import {
  ANGULAR_POSTCSS_CONFIG,
  TAILWIND_CSS_ENTRY,
  TAILWIND_STARTERS,
  VITE_CONFIG_WITH_TAILWIND,
} from './starters.js';
import { commandOutputTail, logger } from './utils.js';

/** CSS entry point that receives the Tailwind import, per framework. */
const CSS_ENTRY = {
  react: 'src/index.css',
  vue: 'src/style.css',
  vanilla: 'src/style.css',
  angular: 'src/styles.css',
};

/** `<pm> <args> <packages>` prefix that adds dev dependencies, per manager. */
const ADD_DEV_ARGS = {
  npm: ['install', '--save-dev'],
  yarn: ['add', '--dev'],
  pnpm: ['add', '--save-dev'],
  bun: ['add', '--dev'],
};

/**
 * Tailwind v4 packages per build pipeline. Vite projects use the first-party
 * Vite plugin; Angular's builder isn't Vite-pluggable, so it goes through
 * PostCSS — both exactly as the official framework guides describe.
 */
const TAILWIND_PACKAGES = {
  vite: ['tailwindcss', '@tailwindcss/vite'],
  angular: ['tailwindcss', '@tailwindcss/postcss', 'postcss'],
};

/**
 * Version floors written to package.json when a live install isn't possible
 * (--no-install, or a network failure mid-setup). Carets resolve to the
 * latest release within the major on the user's next `<pm> install`.
 */
const VERSION_FLOORS = {
  tailwindcss: '^4.0.0',
  '@tailwindcss/vite': '^4.0.0',
  '@tailwindcss/postcss': '^4.0.0',
  postcss: '^8.4.0',
};

const ESLINT_DEPS = {
  eslint: '^9.0.0',
  '@eslint/js': '^9.0.0',
  globals: '^15.0.0',
};
const ESLINT_TS_DEPS = { 'typescript-eslint': '^8.0.0' };
const ESLINT_VUE_DEPS = { 'eslint-plugin-vue': '^9.28.0' };
const ESLINT_PRETTIER_DEPS = { 'eslint-config-prettier': '^9.1.0' };
const PRETTIER_DEPS = { prettier: '^3.0.0' };

/* ------------------------------------------------------------------ */
/* Command runners                                                     */
/* ------------------------------------------------------------------ */

const formatCommand = (command, args) => [command, ...args].join(' ');

/**
 * Runs a required step behind a spinner. `stdin: 'ignore'` makes any
 * unexpected interactive prompt in the child fail fast instead of hanging
 * the CLI forever. Some scaffolders (e.g. @angular/create's Node version
 * check) print an error but still exit 0, so a successful exit only counts
 * when `expectFile` was actually created.
 */
async function runScaffolder({ label, success, command, args, cwd, expectFile }) {
  logger.dim(`  › ${formatCommand(command, args)}`);
  const spinner = ora({ text: label, indent: 2 }).start();
  let result;
  try {
    result = await execa(command, args, { cwd, stdin: 'ignore' });
  } catch (err) {
    spinner.fail(`${label.replace(/\.{3}$/, '')} failed.`);
    const tail = commandOutputTail(err);
    throw new Error(
      `\`${formatCommand(command, args)}\` exited with an error.` +
        (tail ? `\n\n${tail}` : '') +
        '\n\nIf this looks like a network hiccup, check your connection and try again.'
    );
  }

  if (expectFile && !(await fs.pathExists(expectFile))) {
    spinner.fail(`${label.replace(/\.{3}$/, '')} failed.`);
    const tail = commandOutputTail(result);
    throw new Error(
      `\`${formatCommand(command, args)}\` finished without creating a project.` +
        (tail ? `\n\n${tail}` : '')
    );
  }

  spinner.succeed(success);
}

/** Runs an optional step behind a spinner; reports failure instead of throwing. */
async function tryRun({ label, success, failure, command, args, cwd }) {
  logger.dim(`  › ${formatCommand(command, args)}`);
  const spinner = ora({ text: label, indent: 2 }).start();
  try {
    await execa(command, args, { cwd, stdin: 'ignore' });
    spinner.succeed(success);
    return true;
  } catch (err) {
    spinner.fail(failure);
    const tail = commandOutputTail(err);
    if (tail) logger.dim(tail);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Official scaffolders                                                */
/* ------------------------------------------------------------------ */

/**
 * Scaffolders are always invoked from the target directory's *parent*, with
 * just the leaf folder name as the argument — the same way `npm create
 * vite@latest my-app` is documented. A relative path computed from our own
 * (arbitrary) cwd can require many "../" segments — e.g. CI checks out the
 * repo somewhere and scaffolds into /tmp — and the Angular CLI's --directory
 * validation rejects paths shaped like that; path.relative() can also never
 * cross drive letters on Windows. Using the parent dir as cwd sidesteps both.
 */
async function scaffolderInvocation(targetDir) {
  const cwd = path.dirname(targetDir);
  await fs.ensureDir(cwd);
  return { cwd, dirArg: path.basename(targetDir) };
}

async function runViteCreate(options) {
  const { pm, viteTemplate, extras, framework, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  const flags = ['--template', viteTemplate, '--no-interactive', '--no-immediate'];
  // create-vite's React templates lint with Oxlint by default; the official
  // --eslint switch opts back into ESLint when the user asked for it.
  if (framework === 'react' && extras.includes('eslint')) {
    flags.push('--eslint');
  }

  // Only npm needs `--` so the flags reach create-vite instead of npm itself;
  // yarn, pnpm, and bun forward everything after the package name as-is.
  const args =
    pm === 'npm'
      ? ['create', 'vite@latest', dirArg, '--', ...flags]
      : ['create', 'vite', dirArg, ...flags];

  await runScaffolder({
    label: `Scaffolding ${options.variant} project with create-vite...`,
    success: `Vite project scaffolded (template: ${viteTemplate}).`,
    command: pm,
    args,
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

/** ng project names are stricter than npm package names (no scope, ~, _, .). */
function toAngularAppName(packageName) {
  const base = packageName.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9-]/g, '-');
  return /^[a-zA-Z]/.test(base) ? base : `app-${base}`;
}

async function runAngularCreate(options) {
  const { pm, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  const ngFlags = [
    '--defaults',
    '--style',
    'css',
    '--skip-git',
    '--skip-install',
    '--package-manager',
    pm,
    '--directory',
    dirArg,
  ];

  const appName = toAngularAppName(options.packageName);
  const args =
    pm === 'npm'
      ? ['init', '@angular@latest', appName, '--', ...ngFlags]
      : ['create', '@angular', appName, ...ngFlags];

  await runScaffolder({
    label: 'Scaffolding Angular workspace with the Angular CLI...',
    success: 'Angular workspace scaffolded (ng new).',
    command: pm,
    args,
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

/* ------------------------------------------------------------------ */
/* package.json rewrites                                               */
/* ------------------------------------------------------------------ */

/** The scaffolders derive the name from the directory; use the validated one. */
async function normalizePackageJson(options) {
  const pkgPath = path.join(options.targetDir, 'package.json');
  if (!(await fs.pathExists(pkgPath))) return;

  const pkg = await fs.readJson(pkgPath);
  pkg.name = options.packageName;
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}

/** Adds dev dependencies without touching ranges a live install already wrote. */
async function mergeDevDependencies(targetDir, deps) {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = await fs.readJson(pkgPath);

  const devDependencies = { ...(pkg.devDependencies ?? {}) };
  for (const [name, range] of Object.entries(deps)) {
    if (devDependencies[name] || pkg.dependencies?.[name]) continue;
    devDependencies[name] = range;
  }

  pkg.devDependencies = Object.fromEntries(
    Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b))
  );
  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}

/* ------------------------------------------------------------------ */
/* Tailwind CSS (v4, official setup)                                   */
/* ------------------------------------------------------------------ */

/**
 * Injects the @tailwindcss/vite plugin into the generated Vite config, or
 * writes a fresh one when the template ships without (vanilla). Returns false
 * when the config exists but can't be transformed safely.
 */
async function wireTailwindIntoViteConfig({ targetDir, language }) {
  const configNames = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'];
  let configName = null;
  for (const name of configNames) {
    if (await fs.pathExists(path.join(targetDir, name))) {
      configName = name;
      break;
    }
  }

  if (!configName) {
    const freshName = language === 'ts' ? 'vite.config.ts' : 'vite.config.js';
    await fs.writeFile(path.join(targetDir, freshName), VITE_CONFIG_WITH_TAILWIND);
    return true;
  }

  const configPath = path.join(targetDir, configName);
  let source = await fs.readFile(configPath, 'utf8');
  if (source.includes('@tailwindcss/vite')) return true;

  source = `import tailwindcss from '@tailwindcss/vite'\n${source}`;
  if (/plugins\s*:\s*\[/.test(source)) {
    source = source.replace(/plugins\s*:\s*\[/, 'plugins: [tailwindcss(), ');
  } else if (/defineConfig\(\{/.test(source)) {
    source = source.replace(/defineConfig\(\{/, 'defineConfig({\n  plugins: [tailwindcss()],');
  } else {
    return false;
  }

  await fs.writeFile(configPath, source);
  return true;
}

/**
 * Swaps the scaffolder's starter component for one styled with Tailwind
 * utility classes, so the project renders proof that Tailwind works instead
 * of shipping an installed-but-unused dependency.
 */
async function writeTailwindStarter(options, warnings) {
  const starter = TAILWIND_STARTERS[options.framework];
  if (!starter) return;

  const candidates = starter.candidates(options.language);
  let target = null;
  for (const rel of candidates) {
    if (await fs.pathExists(path.join(options.targetDir, rel))) {
      target = rel;
      break;
    }
  }

  if (!target) {
    warnings.push(
      `Could not locate the starter component (looked for ${candidates.join(', ')}); ` +
        'Tailwind is configured, but the demo component was skipped.'
    );
    return;
  }

  await fs.writeFile(path.join(options.targetDir, target), starter.content(options.language));

  await Promise.all(
    starter.obsolete.map(async (rel) => {
      const abs = path.join(options.targetDir, rel);
      if (await fs.pathExists(abs)) await fs.remove(abs);
    })
  );
}

async function setupTailwind(options, warnings) {
  const { framework, targetDir, pm } = options;
  const isAngular = framework === 'angular';
  const packages = TAILWIND_PACKAGES[isAngular ? 'angular' : 'vite'];
  const floors = Object.fromEntries(packages.map((name) => [name, VERSION_FLOORS[name]]));

  // 1. Dependencies — the official install command when we're allowed on the
  //    network; otherwise (or on failure) a package.json merge the user's
  //    next `<pm> install` resolves.
  if (options.install) {
    const installed = await tryRun({
      label: 'Installing Tailwind CSS...',
      success: 'Tailwind CSS installed.',
      failure: 'Tailwind CSS could not be downloaded.',
      command: pm,
      args: [...ADD_DEV_ARGS[pm], ...packages],
      cwd: targetDir,
    });
    if (!installed) {
      await mergeDevDependencies(targetDir, floors);
      warnings.push(
        `Tailwind packages were added to package.json but not downloaded — run "${pm} install" inside the project to finish setup.`
      );
    }
  } else {
    await mergeDevDependencies(targetDir, floors);
  }

  // 2. Build wiring + CSS entry + starter component, all via fs rewrites.
  const spinner = ora({ text: 'Configuring Tailwind CSS...', indent: 2 }).start();
  try {
    if (isAngular) {
      await fs.writeFile(path.join(targetDir, '.postcssrc.json'), ANGULAR_POSTCSS_CONFIG);
    } else if (!(await wireTailwindIntoViteConfig(options))) {
      warnings.push(
        'vite.config could not be updated automatically — add the @tailwindcss/vite plugin manually: https://tailwindcss.com/docs/installation/using-vite'
      );
    }

    await fs.outputFile(path.join(targetDir, CSS_ENTRY[framework]), TAILWIND_CSS_ENTRY);
    await writeTailwindStarter(options, warnings);

    spinner.succeed('Tailwind CSS configured (v4, official setup).');
  } catch (err) {
    spinner.fail('Tailwind CSS configuration failed.');
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* ESLint / Prettier extras                                            */
/* ------------------------------------------------------------------ */

/**
 * Writes a flat ESLint config for non-React frameworks. React projects get
 * the official setup from create-vite's --eslint flag instead (see
 * runViteCreate), so this is never called for them.
 */
async function setupEslint(options) {
  const { targetDir, language, framework, extras } = options;
  const isTs = language === 'ts';
  const withPrettier = extras.includes('prettier');

  const deps = { ...ESLINT_DEPS };
  const imports = ["import js from '@eslint/js';", "import globals from 'globals';"];
  const configParts = ['js.configs.recommended'];

  if (isTs) {
    imports.push("import tseslint from 'typescript-eslint';");
    configParts.push('...tseslint.configs.recommended');
    Object.assign(deps, ESLINT_TS_DEPS);
  }
  if (framework === 'vue') {
    imports.push("import pluginVue from 'eslint-plugin-vue';");
    configParts.push("...pluginVue.configs['flat/recommended']");
    Object.assign(deps, ESLINT_VUE_DEPS);
  }
  if (withPrettier) {
    imports.push("import eslintConfigPrettier from 'eslint-config-prettier';");
    configParts.push('eslintConfigPrettier');
    Object.assign(deps, ESLINT_PRETTIER_DEPS);
  }

  const content = `${imports.join('\n')}

export default [
  { ignores: ['dist', 'dist/**', '**/*.d.ts'] },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  ${configParts.join(',\n  ')},
];
`;

  await fs.writeFile(path.join(targetDir, 'eslint.config.js'), content);
  await mergeDevDependencies(targetDir, deps);
}

async function setupPrettier(options) {
  await fs.writeJson(
    path.join(options.targetDir, '.prettierrc.json'),
    {
      semi: true,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 80,
    },
    { spaces: 2 }
  );
  await fs.writeFile(
    path.join(options.targetDir, '.prettierignore'),
    'dist\nnode_modules\ncoverage\n'
  );
  await mergeDevDependencies(options.targetDir, PRETTIER_DEPS);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Orchestrates the whole scaffold: runs the official initializer for the
 * chosen framework, then layers the selected extras on top with live install
 * commands and targeted fs rewrites. Returns non-fatal `warnings` for the
 * final summary.
 */
export async function scaffoldProject(options) {
  const warnings = [];

  if (options.framework === 'angular') {
    await runAngularCreate(options);
  } else {
    await runViteCreate(options);
  }

  await normalizePackageJson(options);

  if (options.extras.includes('tailwind')) {
    await setupTailwind(options, warnings);
  }
  if (options.extras.includes('eslint') && options.framework !== 'react') {
    await setupEslint(options);
  }
  if (options.extras.includes('prettier')) {
    await setupPrettier(options);
  }

  return { warnings };
}
