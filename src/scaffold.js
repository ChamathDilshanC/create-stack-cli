import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';
import ora from 'ora';

import { applyDatabase } from './database.js';
import { applyDocker } from './docker.js';
import { applyEnvFiles } from './env.js';
import { applyQuality } from './quality.js';
import { createVenv, pipInstallOrRecord, venvBinPath } from './python-utils.js';
import { normalizePackageJson, runScaffolder, scaffolderInvocation } from './scaffold-utils.js';
import { generateEnterpriseStructure, modelsDirFor } from './structure.js';
import { applyStyling } from './styling.js';
import { commandOutputTail, logger, spinnerFail, spinnerSucceed } from './utils.js';

/* ------------------------------------------------------------------ */
/* Frontend                                                            */
/* ------------------------------------------------------------------ */

async function runViteCreate(options) {
  const { pm, framework, language, quality, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);
  const viteTemplate = options.viteTemplate[language];

  const flags = ['--template', viteTemplate, '--no-interactive', '--no-immediate'];
  // create-vite's React templates lint with Oxlint by default; the official
  // --eslint switch opts back into ESLint when the user asked for it.
  if (framework === 'react' && quality === 'eslint-prettier') {
    flags.push('--eslint');
  }

  const args =
    pm === 'npm'
      ? ['create', 'vite@latest', dirArg, '--', ...flags]
      : ['create', 'vite', dirArg, ...flags];

  await runScaffolder({
    label: `Scaffolding ${framework} project with create-vite...`,
    success: `Vite project scaffolded (template: ${viteTemplate}).`,
    command: pm,
    args,
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

/** ng project names are stricter than npm package names (no scope, ~, _, .). */
function toSafeAppName(packageName) {
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

  const appName = toSafeAppName(options.packageName);
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

async function handleFrontend(options, warnings) {
  if (options.framework === 'angular') {
    await runAngularCreate(options);
  } else {
    await runViteCreate(options);
  }

  await normalizePackageJson(options);
  await applyStyling(options, warnings);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });
  await applyQuality(options, warnings, {
    eslintHandledInline: options.framework === 'react' && options.quality === 'eslint-prettier',
  });

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'static', buildCommand: 'npm run build', port: 8080 });
  }
}

/* ------------------------------------------------------------------ */
/* Fullstack                                                           */
/* ------------------------------------------------------------------ */

async function runNextCreate(options) {
  const { pm, language, styling, quality, install, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  const flags = [
    language === 'ts' ? '--ts' : '--js',
    styling === 'tailwind' ? '--tailwind' : '--no-tailwind',
    quality === 'eslint-prettier' ? '--eslint' : '--no-eslint',
    '--app',
    `--use-${pm}`,
    '--disable-git',
    '--yes',
  ];
  if (quality === 'biome') flags.push('--biome');
  if (!install) flags.push('--skip-install');

  await runScaffolder({
    label: 'Scaffolding Next.js project with create-next-app...',
    success: 'Next.js project scaffolded.',
    command: 'npx',
    args: ['create-next-app@latest', dirArg, ...flags],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function runNuxtCreate(options) {
  const { pm, install, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  // nuxi init requires --template and --gitInit explicitly when run
  // non-interactively — it won't fall back to defaults on its own.
  const flags = ['--template', 'minimal', '--no-gitInit', '--packageManager', pm];
  if (!install) flags.push('--no-install');

  await runScaffolder({
    label: 'Scaffolding Nuxt project with nuxi...',
    success: 'Nuxt project scaffolded.',
    command: 'npx',
    args: ['nuxi@latest', 'init', dirArg, ...flags],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function runSvelteKitCreate(options) {
  const { pm, language, styling, quality, database, install, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  // sv create's --add addons cover Tailwind, ESLint+Prettier, and Drizzle
  // natively — using them beats a post-hoc config rewrite, so the relevant
  // steps below are skipped for those specific combinations.
  // sv create only skips its interactive prompts when every option of every
  // addon is explicitly set — a bare addon name with sub-options (like
  // tailwindcss's plugin picker) still stops to ask.
  const addons = [];
  if (styling === 'tailwind') addons.push('tailwindcss=plugins:none');
  if (quality === 'eslint-prettier') addons.push('eslint', 'prettier');
  if (database === 'drizzle') addons.push('drizzle=database:sqlite+client:better-sqlite3');

  const flags = [
    '--template',
    'minimal',
    ...(language === 'ts' ? ['--types', 'ts'] : ['--no-types']),
    ...(addons.length > 0 ? ['--add', ...addons] : ['--no-add-ons']),
    ...(install ? ['--install', pm] : ['--no-install']),
  ];

  await runScaffolder({
    label: 'Scaffolding SvelteKit project with sv create...',
    success: 'SvelteKit project scaffolded.',
    command: 'npx',
    args: ['sv@latest', 'create', dirArg, ...flags],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function runAstroCreate(options) {
  const { install, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  // create-astro's own `--add tailwind` requires a live install (it fails
  // outright under --no-install), so Tailwind is wired in afterwards by
  // applyStyling instead — same generic path as Nuxt.
  const flags = ['--template', 'basics', '--no-git', '--yes'];
  flags.push(install ? '--install' : '--no-install');

  await runScaffolder({
    label: 'Scaffolding Astro project with create-astro...',
    success: 'Astro project scaffolded.',
    command: 'npx',
    args: ['create-astro@latest', dirArg, ...flags],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function handleFullstack(options, warnings) {
  const { framework } = options;

  if (framework === 'next') await runNextCreate(options);
  else if (framework === 'nuxt') await runNuxtCreate(options);
  else if (framework === 'sveltekit') await runSvelteKitCreate(options);
  else if (framework === 'astro') await runAstroCreate(options);

  await normalizePackageJson(options);

  // Tailwind is handled inline (scaffold-time flags) only for Next.js and
  // SvelteKit; Nuxt and Astro always go through the generic post-hoc
  // injector (Astro's own --add requires a live install, so it can't be
  // used unconditionally). UnoCSS/CSS Modules always use the generic path,
  // since none of these tools have a native addon for them.
  const tailwindHandledInline = ['next', 'sveltekit'].includes(framework) && options.styling === 'tailwind';
  if (!tailwindHandledInline) {
    await applyStyling(options, warnings);
  }

  const hasSrcDir = await fs.pathExists(path.join(options.targetDir, 'src'));
  const modelsDir = hasSrcDir ? path.join('src', modelsDirNameOnly(options)) : modelsDirNameOnly(options);
  const drizzleHandledInline = framework === 'sveltekit' && options.database === 'drizzle';
  if (options.database !== 'none' && !drizzleHandledInline) {
    await applyDatabase(options, warnings, { modelsDir });
  }

  const eslintHandledInline =
    (framework === 'next' && options.quality !== 'none') ||
    (framework === 'sveltekit' && options.quality === 'eslint-prettier');
  const prettierHandledInline = framework === 'sveltekit' && options.quality === 'eslint-prettier';
  const biomeHandledInline = framework === 'next' && options.quality === 'biome';
  if (!biomeHandledInline) {
    await applyQuality(options, warnings, { eslintHandledInline, prettierHandledInline });
  }

  // Each framework's own real srcDir, not a one-size-fits-all guess: Nuxt 4
  // already uses app/ as its srcDir, so the enterprise layout goes there
  // instead of creating a second, unused src/ alongside it; the rest use
  // (or gain) a plain src/, which none of them otherwise occupy at root.
  const fullstackBaseDir = { nuxt: 'app' }[framework] ?? 'src';
  await generateEnterpriseStructure(options, warnings, { baseDir: fullstackBaseDir });

  if (options.docker) {
    const nodeStart = { next: 'npm start', nuxt: 'node .output/server/index.mjs', astro: 'node ./dist/server/entry.mjs' };
    await applyDocker(options, warnings, {
      flavor: 'node',
      buildCommand: 'npm run build',
      startCommand: nodeStart[framework] ?? 'npm start',
      port: 3000,
    });
  }
}

function modelsDirNameOnly(options) {
  return options.database === 'drizzle' ? 'db' : 'models';
}

/* ------------------------------------------------------------------ */
/* Backend                                                              */
/* ------------------------------------------------------------------ */

const EXPRESS_SERVER = (isTs) => `import express from 'express';${isTs ? "\nimport type { Request, Response } from 'express';" : ''}

const app = express();
const port = process.env.PORT ?? 3000;

app.use(express.json());

app.get('/', (${isTs ? '_req: Request, res: Response' : '_req, res'}) => {
  res.json({ message: 'Hello from Express!' });
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`);
});
`;

const FASTIFY_SERVER = (isTs) => `import Fastify from 'fastify';

const fastify = Fastify({ logger: true });

fastify.get('/', async () => {
  return { message: 'Hello from Fastify!' };
});

const port = Number(process.env.PORT ?? 3000);

fastify.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
`;

const NODE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
`;

/**
 * Express and Fastify have no official modern scaffolding CLI, so this
 * writes a clean package.json + server entry by hand instead of running an
 * initializer — the one deliberate exception to "always use the official
 * tool" in this CLI.
 */
async function runManualBackendScaffold(options, kind) {
  const { targetDir, packageName, language, pm } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';

  await fs.ensureDir(targetDir);

  const serverContent = kind === 'express' ? EXPRESS_SERVER(isTs) : FASTIFY_SERVER(isTs);
  await fs.outputFile(path.join(targetDir, 'src', `server.${ext}`), serverContent);

  const dependencies = kind === 'express' ? { express: '^4.21.0' } : { fastify: '^5.0.0' };
  const devDependencies = isTs
    ? {
        typescript: '^5.6.0',
        tsx: '^4.19.0',
        '@types/node': '^22.0.0',
        ...(kind === 'express' ? { '@types/express': '^4.17.0' } : {}),
      }
    : {};

  const pkg = {
    name: packageName,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: isTs
      ? { dev: 'tsx watch src/server.ts', build: 'tsc', start: 'node dist/server.js' }
      : { dev: 'node --watch src/server.js', start: 'node src/server.js' },
    dependencies,
    devDependencies,
  };
  await fs.writeJson(path.join(targetDir, 'package.json'), pkg, { spaces: 2 });

  if (isTs) {
    await fs.writeFile(path.join(targetDir, 'tsconfig.json'), NODE_TSCONFIG);
  }
  await fs.writeFile(path.join(targetDir, '.gitignore'), 'node_modules\ndist\n.env\n');

  logger.dim(`  › Wrote package.json + src/server.${ext} by hand (${kind} has no official scaffolder).`);

  if (options.install) {
    const { installDependencies } = await import('./install.js');
    await installDependencies(targetDir, pm);
  }
}

async function runNestCreate(options) {
  const { pm, install, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  const flags = ['--package-manager', pm, '--skip-git', '--strict'];
  if (!install) flags.push('--skip-install');

  await runScaffolder({
    label: 'Scaffolding NestJS project with the Nest CLI...',
    success: 'NestJS project scaffolded.',
    command: 'npx',
    args: ['@nestjs/cli@latest', 'new', dirArg, ...flags],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function runHonoCreate(options) {
  const { pm, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  // create-hono prompts interactively for "install dependencies?" and has
  // no negation flag for it (--no-install isn't recognized) — always
  // answering yes is the only way to skip that prompt non-interactively.
  const flags = ['--template', 'nodejs', '--pm', pm, '--install'];

  await runScaffolder({
    label: 'Scaffolding Hono project with create-hono...',
    success: 'Hono project scaffolded.',
    command: 'npx',
    args: ['create-hono@latest', dirArg, ...flags],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function handleBackend(options, warnings) {
  const { framework } = options;

  if (framework === 'express') return handleManualBackend(options, warnings, 'express');
  if (framework === 'fastify') return handleManualBackend(options, warnings, 'fastify');
  if (framework === 'nestjs') return handleNestBackend(options, warnings);
  if (framework === 'hono') return handleHonoBackend(options, warnings);
  if (framework === 'django') return handleDjangoBackend(options, warnings);
  if (framework === 'flask') return handleManualPythonBackend(options, warnings, 'flask');
  if (framework === 'fastapi') return handleManualPythonBackend(options, warnings, 'fastapi');

  throw new Error(`Unknown backend framework: ${framework}`);
}

async function handleManualBackend(options, warnings, kind) {
  await runManualBackendScaffold(options, kind);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });
  if (options.database !== 'none') {
    await applyDatabase(options, warnings, { modelsDir: modelsDirFor(options, 'src') });
  }
  await applyQuality(options, warnings);
  if (options.docker) {
    const isTs = options.language === 'ts';
    await applyDocker(options, warnings, {
      flavor: 'node',
      buildCommand: isTs ? 'npm run build' : undefined,
      startCommand: 'npm start',
      port: 3000,
    });
  }
}

async function handleNestBackend(options, warnings) {
  await runNestCreate(options);
  await normalizePackageJson(options);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });
  if (options.database !== 'none') {
    await applyDatabase(options, warnings, { modelsDir: modelsDirFor(options, 'src') });
  }
  // `nest new` always ships its own ESLint + Prettier config, with no flag
  // to opt out — Biome still gets layered on top if that's what was asked
  // for, but there's no CLI-level way to suppress Nest's own linting setup.
  if (options.quality === 'eslint-prettier') {
    warnings.push('NestJS ships its own ESLint + Prettier config by default; nothing further was needed.');
  } else if (options.quality === 'biome') {
    await applyQuality(options, warnings);
    warnings.push(
      'NestJS also ships its own ESLint + Prettier config by default — remove eslint.config.mjs/.prettierrc if you want Biome to be the only linter.'
    );
  } else {
    warnings.push('NestJS always includes its own ESLint + Prettier config; there is no CLI flag to omit it.');
  }
  if (options.docker) {
    await applyDocker(options, warnings, {
      flavor: 'node',
      buildCommand: 'npm run build',
      startCommand: 'npm run start:prod',
      port: 3000,
    });
  }
}

async function handleHonoBackend(options, warnings) {
  await runHonoCreate(options);
  // create-hono makes some network install activity regardless of
  // --no-install, but (unlike Tauri/Electron) it doesn't reliably finish
  // installing everything it puts in package.json — so, unlike those two,
  // this does NOT force options.install for the steps below; a normal final
  // `npm install` (respecting the user's real choice) still runs afterward.
  if (!options.install) {
    warnings.push('create-hono has no way to skip its dependency install — --no-install could not be honored here.');
  }
  await normalizePackageJson(options);
  const hasSrcDir = await fs.pathExists(path.join(options.targetDir, 'src'));
  await generateEnterpriseStructure(options, warnings, { baseDir: hasSrcDir ? 'src' : '.' });
  if (options.database !== 'none') {
    await applyDatabase(options, warnings, { modelsDir: modelsDirFor(options, hasSrcDir ? 'src' : '.') });
  }
  // create-hono's nodejs template already lists eslint/prettier/typescript-eslint
  // in package.json (but ships no config file at all) — reinstalling those
  // exact packages collides with npm's dependency resolution, so only the
  // config-writing half of applyQuality runs for eslint-prettier.
  await applyQuality(options, warnings, { depsAlreadyPresent: true });
  if (options.docker) {
    await applyDocker(options, warnings, {
      flavor: 'node',
      buildCommand: undefined,
      startCommand: 'npm start',
      port: 3000,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Backend — Python (Django / Flask / FastAPI)                         */
/* ------------------------------------------------------------------ */

/** Django project package names are Python identifiers: no hyphens, can't start with a digit. */
function toPythonIdentifier(name) {
  const base = name
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safe = /^[a-zA-Z_]/.test(base) ? base : `app_${base}`;
  return safe || 'app';
}

async function handleDjangoBackend(options, warnings) {
  const { targetDir } = options;
  await fs.ensureDir(targetDir);

  const venvReady = await createVenv(targetDir, warnings);
  await pipInstallOrRecord({ options, warnings, packages: ['django'], label: 'Django', venvReady });

  const projectName = toPythonIdentifier(options.packageName);
  if (venvReady && options.install) {
    const djangoAdmin = venvBinPath(targetDir, 'django-admin');
    const spinner = ora({ text: 'Scaffolding Django project with django-admin...', indent: 2 }).start();
    try {
      await execa(djangoAdmin, ['startproject', projectName, '.'], { cwd: targetDir, stdin: 'ignore' });
      spinnerSucceed(spinner, 'Django project scaffolded (django-admin startproject).');
    } catch (err) {
      spinnerFail(spinner, 'Django project scaffolding failed.');
      const tail = commandOutputTail(err);
      warnings.push(
        `django-admin startproject could not run (${tail || err.message}) — run it yourself once dependencies are installed: ` +
          `.venv/bin/django-admin startproject ${projectName} .`
      );
    }
  } else {
    warnings.push(
      `Django itself isn't installed yet, so django-admin couldn't run — after \`pip install -r requirements.txt\`, run: django-admin startproject ${projectName} .`
    );
  }

  // Django's own startproject already creates <projectName>/settings.py,
  // urls.py, etc. — the enterprise layout goes inside that same package
  // rather than cluttering the root next to manage.py.
  const structureBaseDir = await fs.pathExists(path.join(targetDir, projectName)) ? projectName : '.';
  await generateEnterpriseStructure(options, warnings, { baseDir: structureBaseDir });

  await applyPythonQuality(options, warnings, venvReady);

  if (options.docker) {
    await applyDocker(options, warnings, {
      flavor: 'python',
      startCommand: 'python manage.py runserver 0.0.0.0:8000',
      port: 8000,
    });
  }
}

const FASTAPI_MAIN = `from fastapi import FastAPI

app = FastAPI()


@app.get("/")
async def root():
    return {"message": "Hello from FastAPI!"}
`;

const FLASK_MAIN = `from flask import Flask, jsonify

app = Flask(__name__)


@app.route("/")
def index():
    return jsonify(message="Hello from Flask!")


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
`;

/**
 * Flask and FastAPI have no official project-scaffolding command (FastAPI's
 * own CLI runs/dev-serves a file, it doesn't generate one) — this writes a
 * clean requirements.txt + app/main.py by hand instead, the same exception
 * already made for Express/Fastify on the Node side.
 */
async function handleManualPythonBackend(options, warnings, kind) {
  const { targetDir } = options;
  await fs.ensureDir(targetDir);

  await fs.outputFile(path.join(targetDir, 'app', 'main.py'), kind === 'flask' ? FLASK_MAIN : FASTAPI_MAIN);
  await fs.outputFile(path.join(targetDir, 'app', '__init__.py'), '');
  await fs.writeFile(path.join(targetDir, '.gitignore'), '.venv/\n__pycache__/\n*.pyc\n.env\n');

  const venvReady = await createVenv(targetDir, warnings);
  const packages = kind === 'flask' ? ['flask'] : ['fastapi[standard]'];
  await pipInstallOrRecord({ options, warnings, packages, label: kind === 'flask' ? 'Flask' : 'FastAPI', venvReady });

  await generateEnterpriseStructure(options, warnings, { baseDir: 'app' });
  await applyPythonQuality(options, warnings, venvReady);

  if (options.docker) {
    await applyDocker(options, warnings, {
      flavor: 'python',
      startCommand:
        kind === 'flask'
          ? 'python app/main.py'
          : 'uvicorn app.main:app --host 0.0.0.0 --port 8000',
      port: kind === 'flask' ? 5000 : 8000,
    });
  }
}

/** Ruff or Black+Flake8 — Python's equivalents of the Node quality.js path, kept local since none of it is Node-specific. */
async function applyPythonQuality(options, warnings, venvReady) {
  const { targetDir, quality } = options;
  if (quality === 'none') return;

  if (quality === 'ruff') {
    await pipInstallOrRecord({ options, warnings, packages: ['ruff'], label: 'Ruff', venvReady });
    await fs.writeFile(
      path.join(targetDir, 'ruff.toml'),
      `line-length = 100\n\n[lint]\nselect = ["E", "F", "I"]\n\n[format]\nquote-style = "double"\n`
    );
  } else if (quality === 'black-flake8') {
    await pipInstallOrRecord({
      options,
      warnings,
      packages: ['black', 'flake8'],
      label: 'Black + Flake8',
      venvReady,
    });
    // Unlike Black/Ruff, flake8 has no default excludes at all — without an
    // explicit list it happily recurses into .venv and lints every
    // third-party package installed there too.
    await fs.writeFile(
      path.join(targetDir, '.flake8'),
      '[flake8]\nmax-line-length = 100\nextend-ignore = E203\nexclude = .venv,__pycache__,.git\n'
    );
    await fs.writeFile(path.join(targetDir, 'pyproject.toml'), '[tool.black]\nline-length = 100\n');
  }
}

/* ------------------------------------------------------------------ */
/* Desktop                                                              */
/* ------------------------------------------------------------------ */

const TAURI_TEMPLATE = { ts: 'vanilla-ts', js: 'vanilla' };
const ELECTRON_TEMPLATE = { ts: 'vite-typescript', js: 'vite' };

async function runTauriCreate(options) {
  const { pm, language, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  await runScaffolder({
    label: 'Scaffolding Tauri app with create-tauri-app...',
    success: 'Tauri app scaffolded.',
    command: 'npx',
    args: [
      'create-tauri-app@latest',
      dirArg,
      '--manager',
      pm,
      '--template',
      TAURI_TEMPLATE[language],
      '--yes',
    ],
    cwd,
    expectFile: path.join(targetDir, 'src-tauri', 'Cargo.toml'),
  });
}

async function runElectronCreate(options) {
  const { language, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  await runScaffolder({
    label: 'Scaffolding Electron app with Electron Forge...',
    success: 'Electron app scaffolded.',
    command: 'npx',
    args: ['create-electron-app@latest', dirArg, `--template=${ELECTRON_TEMPLATE[language]}`, '--skip-git'],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function handleDesktop(options, warnings) {
  const { framework } = options;

  if (framework === 'tauri') await runTauriCreate(options);
  else await runElectronCreate(options);

  // Neither create-tauri-app nor Electron Forge's initializer exposes a
  // "skip install" flag — both always install dependencies as part of
  // scaffolding, so --no-install can't be honored for this category. Any
  // styling/quality tooling added afterward still respects the user's real
  // options.install (merge-only when false, same as every other category) —
  // a normal final `npm install` covers it when the user did ask for one.
  if (!options.install) {
    warnings.push(
      `${framework === 'tauri' ? 'create-tauri-app' : 'Electron Forge'} always installs dependencies during scaffolding — --no-install could not be honored here.`
    );
  }

  await normalizePackageJson(options);

  if (framework === 'tauri') {
    await applyStyling(options, warnings);
  } else if (options.styling !== 'none') {
    warnings.push(`${options.styling} was not auto-wired for Electron — see the project's vite.renderer.config for manual setup.`);
  }

  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });

  // Electron Forge's template ships a complete, working legacy ESLint 8
  // setup (.eslintrc.json + @typescript-eslint/eslint-plugin+parser@5) —
  // layering our modern ESLint 9 flat-config + unified typescript-eslint@8
  // package on top doesn't just duplicate it, the two require incompatible
  // major ESLint versions and conflict outright. Tauri ships no such thing,
  // so it always gets the normal generic setup.
  if (framework === 'electron' && options.quality === 'eslint-prettier') {
    warnings.push('Electron Forge already ships its own ESLint config (.eslintrc.json); nothing further was needed.');
  } else if (framework === 'electron' && options.quality === 'biome') {
    await applyQuality(options, warnings);
    warnings.push(
      'Electron Forge also ships its own ESLint config (.eslintrc.json) — remove it if you want Biome to be the only linter.'
    );
  } else if (framework === 'electron' && options.quality === 'none') {
    warnings.push('Electron Forge always includes its own ESLint config (.eslintrc.json); there is no flag to omit it.');
  } else {
    await applyQuality(options, warnings);
  }

  if (options.docker) {
    warnings.push('Docker support was skipped — desktop apps run natively and are not typically containerized.');
  }
}

/* ------------------------------------------------------------------ */
/* Mobile                                                               */
/* ------------------------------------------------------------------ */

const EXPO_CREATE_ARGS = {
  npm: ['create-expo-app@latest'],
  yarn: ['create', 'expo-app'],
  pnpm: ['create', 'expo-app'],
  bun: ['create', 'expo-app'],
};

async function runExpoCreate(options) {
  const { pm, language, install, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  const flags = ['--template', language === 'ts' ? 'blank-typescript' : 'blank', '--yes'];
  if (!install) flags.push('--no-install');

  const command = pm === 'npm' ? 'npx' : pm;
  const args = pm === 'npm' ? [...EXPO_CREATE_ARGS.npm, dirArg, ...flags] : [...EXPO_CREATE_ARGS[pm], dirArg, ...flags];

  await runScaffolder({
    label: 'Scaffolding Expo app with create-expo-app...',
    success: 'Expo app scaffolded.',
    command,
    args,
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function handleMobile(options, warnings) {
  await runExpoCreate(options);
  await normalizePackageJson(options);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });
  await applyQuality(options, warnings);

  if (options.docker) {
    warnings.push('Docker support was skipped — Expo apps run on-device/in-simulator and are not typically containerized.');
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const HANDLERS = {
  frontend: handleFrontend,
  fullstack: handleFullstack,
  backend: handleBackend,
  desktop: handleDesktop,
  mobile: handleMobile,
};

/**
 * Orchestrates the whole scaffold: dispatches to the category handler for
 * options.projectType, which runs the official initializer for the chosen
 * framework (or, for Express/Fastify, writes one by hand) and layers the
 * selected extras on top. Returns non-fatal `warnings` for the final summary.
 */
export async function scaffoldProject(options) {
  const warnings = [];
  const handler = HANDLERS[options.projectType];
  if (!handler) throw new Error(`Unknown project type: ${options.projectType}`);

  await handler(options, warnings);
  // Every project type gets .env/.env.local/.env.production, regardless of
  // which handler ran — one call here instead of one per handler.
  await applyEnvFiles(options, warnings);

  return { warnings };
}
