import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';

import { applyApiLayer } from './api-layer.js';
import { applyAuth } from './auth.js';
import { applyDatabase } from './database.js';
import { applyTesting } from './testing.js';
import { applyStateManagement } from './state-management.js';
import { applyUiKit } from './ui-kits.js';
import { handleAiNextjs } from './ai-nextjs.js';
import { handleGoBackend } from './backend-go.js';
import { handleLaravelBackend } from './backend-php.js';
import { handleRailsBackend } from './backend-ruby.js';
import { handleDotnetBackend } from './backend-dotnet.js';
import { handleDenoFreshBackend, handleDenoOakBackend } from './backend-deno.js';
import { handleKtorBackend } from './backend-kotlin.js';
import { handleWailsDesktop } from './desktop-wails.js';
import { handleNeutralinoDesktop } from './desktop-neutralino.js';
import { handleIonicMobile } from './mobile-ionic.js';
import { handleKmpMobile } from './mobile-kmp.js';
import { applyDocker } from './docker.js';
import { appendEnvVars, applyEnvFiles } from './env.js';
import { applyExtraPackages } from './packages.js';
import { applyQuality } from './quality.js';
import { createVenv, pipInstallOrRecord, venvBinPath } from './python-utils.js';
import { finalizeNextProviders, normalizePackageJson, runScaffolder, scaffolderInvocation } from './scaffold-utils.js';
import { generateSpringStructure, scaffoldSpringProject } from './spring.js';
import { FLUTTER_DIRECTORIES, generateEnterpriseStructure, modelsDirFor } from './structure.js';
import { applyStyling } from './styling.js';
import { commandOutputTail, createSpinner, logger, spinnerFail, spinnerSucceed } from './utils.js';

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
  // UI kit before state management/API layer: shadcn/DaisyUI both need the
  // Tailwind stylesheet applyStyling above just wrote. None of these three
  // providers reads another's context, so the nesting order among them
  // otherwise doesn't matter — each just wraps one layer deeper around
  // whatever the previous one already wrapped (see wrapViteReactRoot/
  // registerNextProvider in scaffold-utils.js).
  await applyUiKit(options, warnings);
  await applyStateManagement(options, warnings);
  await applyApiLayer(options, warnings);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });
  await applyQuality(options, warnings, {
    eslintHandledInline: options.framework === 'react' && options.quality === 'eslint-prettier',
  });

  // Angular's own `ng test` (Karma/Jasmine, or a newer builder) is already
  // wired in by the Angular CLI itself — same "don't duplicate what's
  // already there" call NestJS's own Jest setup gets in handleNestBackend.
  if (options.framework === 'angular') {
    if (options.testing && options.testing !== 'none') {
      warnings.push('Angular already ships its own test runner (`ng test`); nothing further was needed.');
    }
  } else {
    await applyTesting(options, warnings, { environment: 'jsdom', testDir: 'src' });
  }

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'static', buildCommand: 'npm run build', port: 8080 });
  }
}

/* ------------------------------------------------------------------ */
/* Fullstack                                                           */
/* ------------------------------------------------------------------ */

export async function runNextCreate(options) {
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

  // Same three, same order, as handleFrontend above. UI kit's and state
  // management's own prompts (stepUiKit/stepStateManagement) already narrow
  // their offered choices per framework, so there's nothing left to
  // gracefully degrade for either here. API layer is the one exception — it
  // offers its full menu regardless of framework, so Nuxt/SvelteKit/Astro
  // can still get the same "not yet wired" warning the rest of this file
  // already gives Auth.js when tRPC/GraphQL is picked anyway.
  await applyUiKit(options, warnings);
  await applyStateManagement(options, warnings);
  await applyApiLayer(options, warnings);

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
  // Next.js's App Router lives at the project root (app/), not under src/ —
  // an empty src/pages/ from the generic structure list still trips Next's
  // "pages and app must be siblings" build-time validation, since it checks
  // the folder's mere existence, not whether it holds real page files.
  // Nuxt has the opposite problem: an empty app/pages/ doesn't fail the
  // build, but its mere presence auto-enables Nuxt's file-based router —
  // and since the starter app.vue renders its own content directly (no
  // <NuxtPage />), Vue Router ends up trying to match "/" against zero
  // page components and throws VUE_ROUTER_R0004 in the browser console.
  const structureExclude = framework === 'next' || framework === 'nuxt' ? ['pages'] : [];
  await generateEnterpriseStructure(options, warnings, { baseDir: fullstackBaseDir, exclude: structureExclude });

  await applyTesting(options, warnings, { environment: 'jsdom', testDir: fullstackBaseDir });
  // Real wiring only for Next.js — applyAuth itself pushes a "not yet wired"
  // warning for Nuxt/SvelteKit/Astro when Auth.js was picked anyway.
  await applyAuth(options, warnings);

  if (options.docker) {
    const nodeStart = { next: 'npm start', nuxt: 'node .output/server/index.mjs', astro: 'node ./dist/server/entry.mjs' };
    await applyDocker(options, warnings, {
      flavor: 'node',
      buildCommand: 'npm run build',
      startCommand: nodeStart[framework] ?? 'npm start',
      port: 3000,
    });
  }

  // Once, after everything above has had a chance to call
  // registerNextProvider() (state management, API layer, UI kit) — a single
  // "wire this into layout.tsx" instruction instead of one per feature.
  if (framework === 'next') {
    await finalizeNextProviders(options.targetDir, options.language === 'ts', warnings);
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

  // `--watch`/`tsx watch` restart on every save; dropping it for a "No"
  // answer to the hot-reload question (prompts.js's stepHotReload) still
  // leaves a working dev script, just without the auto-restart.
  const devScript = isTs
    ? options.hotReload
      ? 'tsx watch src/server.ts'
      : 'tsx src/server.ts'
    : options.hotReload
      ? 'node --watch src/server.js'
      : 'node src/server.js';

  const pkg = {
    name: packageName,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: isTs
      ? { dev: devScript, build: 'tsc', start: 'node dist/server.js' }
      : { dev: devScript, start: 'node src/server.js' },
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
  if (framework === 'spring') return handleSpringBackend(options, warnings);
  if (framework === 'rust-axum' || framework === 'rust-actix') return handleRustBackend(options, warnings);
  if (framework === 'go-gin' || framework === 'go-fiber' || framework === 'go-echo') return handleGoBackend(options, warnings);
  if (framework === 'laravel') return handleLaravelBackend(options, warnings);
  if (framework === 'rails') return handleRailsBackend(options, warnings);
  if (framework === 'dotnet') return handleDotnetBackend(options, warnings);
  if (framework === 'deno-fresh') return handleDenoFreshBackend(options, warnings);
  if (framework === 'deno-oak') return handleDenoOakBackend(options, warnings);
  if (framework === 'ktor') return handleKtorBackend(options, warnings);

  throw new Error(`Unknown backend framework: ${framework}`);
}

async function handleManualBackend(options, warnings, kind) {
  await runManualBackendScaffold(options, kind);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });
  if (options.database !== 'none') {
    await applyDatabase(options, warnings, { modelsDir: modelsDirFor(options, 'src') });
  }
  await applyQuality(options, warnings);
  await applyTesting(options, warnings, { environment: 'node', testDir: 'src' });
  // Real wiring only for Express — applyAuth itself pushes a "not yet wired"
  // warning for Fastify when Auth.js was picked anyway.
  await applyAuth(options, warnings);
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
  // `nest new` already ships a full Jest setup (spec files + an e2e/ folder,
  // jest config in package.json) — same "don't duplicate what's already
  // there" call Angular's own `ng test` gets in handleFrontend.
  if (options.testing && options.testing !== 'none') {
    warnings.push('NestJS already ships its own Jest-based test setup (spec files + e2e/); nothing further was needed.');
  }
  // No official Auth.js integration for NestJS yet (its own idiomatic story
  // is @nestjs/passport) — applyAuth would just repeat this same "not yet
  // wired" warning itself, so this skips calling it entirely rather than
  // pushing two warnings for one choice.
  if (options.auth && options.auth !== 'none') {
    warnings.push(`${options.auth === 'authjs' ? 'Auth.js' : options.auth} was selected but isn't wired up yet for NestJS in this CLI — install it yourself, or re-run and pick None.`);
  }
  // `nest new` always ships `start:dev` running `nest start --watch` — same
  // "no CLI flag to opt out" story as ESLint/Jest above, so a "No" to the
  // hot-reload question can't be honored here yet either.
  if (options.hotReload === false) {
    warnings.push('NestJS always ships hot-reload via `npm run start:dev` (nest start --watch); there is no flag to omit it yet — use `npm run start` instead if you don\'t want it.');
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
  await applyTesting(options, warnings, { environment: 'node', testDir: hasSrcDir ? 'src' : '.' });
  // No official Auth.js integration for Hono yet — applyAuth pushes its own
  // "not yet wired" warning for any framework other than Next.js/Express.
  await applyAuth(options, warnings);
  // create-hono's "nodejs" template always ships `dev: tsx watch src/index.ts`
  // — same "no flag to opt out" story as NestJS above.
  if (options.hotReload === false) {
    warnings.push('Hono\'s create-hono template always ships hot-reload via `npm run dev` (tsx watch); there is no flag to omit it yet — edit package.json\'s "dev" script if you don\'t want it.');
  }
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
    const spinner = createSpinner('Scaffolding Django project with django-admin...');
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

/** `debug=True` is what actually enables Werkzeug's auto-reloader — a "No" answer to the hot-reload question (prompts.js's stepHotReload) turns it off at the source instead of just changing how the server happens to be started. */
const flaskMain = (hotReload) => `from flask import Flask, jsonify

app = Flask(__name__)


@app.route("/")
def index():
    return jsonify(message="Hello from Flask!")


if __name__ == "__main__":
    app.run(debug=${hotReload ? 'True' : 'False'}, host="0.0.0.0", port=5000)
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

  await fs.outputFile(path.join(targetDir, 'app', 'main.py'), kind === 'flask' ? flaskMain(options.hotReload) : FASTAPI_MAIN);
  await fs.outputFile(path.join(targetDir, 'app', '__init__.py'), '');
  await fs.writeFile(path.join(targetDir, '.gitignore'), '.venv/\n__pycache__/\n*.pyc\n.env\n');

  const venvReady = await createVenv(targetDir, warnings);
  const packages = kind === 'flask' ? ['flask'] : ['fastapi[standard]'];
  await pipInstallOrRecord({ options, warnings, packages, label: kind === 'flask' ? 'Flask' : 'FastAPI', venvReady });

  // Werkzeug's reloader (already on via flaskMain's debug=True above) auto-
  // upgrades from stat-polling to watchdog's OS-native file events the
  // moment watchdog is importable — nothing else to configure for it.
  if (kind === 'flask' && options.hotReload) {
    await pipInstallOrRecord({ options, warnings, packages: ['watchdog'], label: 'watchdog', venvReady });
  }

  await generateEnterpriseStructure(options, warnings, { baseDir: 'app' });
  if (options.database === 'sqlalchemy') {
    await applyPythonDatabase(options, warnings, venvReady);
  }
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

const SQLALCHEMY_DATABASE_PY = `from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = "sqlite:///./local.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
`;

const SQLALCHEMY_USER_MODEL_PY = `from sqlalchemy import Column, Integer, String

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
`;

/**
 * SQLAlchemy for Flask/FastAPI — Django always uses its own ORM instead
 * (forced via forceDatabase in prompts.js, never reaches this function).
 * Writes into the models/ folder generateEnterpriseStructure already
 * created, same as database.js does for the Node frameworks.
 */
async function applyPythonDatabase(options, warnings, venvReady) {
  const modelsDir = path.join(options.targetDir, 'app', 'models');
  await pipInstallOrRecord({ options, warnings, packages: ['sqlalchemy'], label: 'SQLAlchemy', venvReady });

  await fs.outputFile(path.join(modelsDir, '__init__.py'), '');
  await fs.outputFile(path.join(modelsDir, 'database.py'), SQLALCHEMY_DATABASE_PY);
  await fs.outputFile(path.join(modelsDir, 'user.py'), SQLALCHEMY_USER_MODEL_PY);

  await appendEnvVars(options.targetDir, { DATABASE_URL: 'sqlite:///./local.db' }, { DATABASE_URL: 'REPLACE_WITH_PRODUCTION_DATABASE_URL' });
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
/* Backend — Java (Spring Boot)                                        */
/* ------------------------------------------------------------------ */

/**
 * Spring Initializr generates a real Maven/Gradle project, package structure
 * (src/main/java/..., src/main/resources) and all — so unlike every other
 * backend above, there's no generateEnterpriseStructure or applyDatabase
 * call here: the generic enterprise layout is JS-shaped and would not fit
 * Java package conventions, and the dependency picker in prompts.js already
 * covers the database/ORM question (Spring Data JPA, drivers, ...) through
 * Spring's own catalog instead of this CLI's Node-oriented one. A
 * Java-shaped equivalent (controller/service/repository/model/...) is laid
 * down by generateSpringStructure instead, right below.
 */
async function handleSpringBackend(options, warnings) {
  const { javaPackage } = await scaffoldSpringProject(options);
  await generateSpringStructure(options, warnings, javaPackage);

  // spring-boot-devtools restarts the app on its own once it sees recompiled
  // classes, but neither build tool recompiles on save by itself — Gradle's
  // --continuous flag (wired into index.js's devCommand) closes that gap for
  // free, but Maven has no built-in watch mode, so DevTools alone won't
  // actually auto-reload without an IDE (or a manual `mvnw compile`) doing
  // the recompiling.
  if (options.springHotReload && options.buildTool === 'maven') {
    warnings.push(
      'Hot reload was enabled (DevTools is on the classpath), but Maven has no built-in watch mode — DevTools only restarts once something recompiles the changed classes. Your IDE\'s "build automatically" does this, or run "./mvnw compile" manually after each change. For fully automatic hot reload from the command line, use --build-tool gradle instead.'
    );
  }

  if (options.docker) {
    await applyDocker(options, warnings, {
      flavor: 'java',
      buildTool: options.buildTool,
      javaVersion: options.javaVersion,
      port: 8080,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Backend — Rust (Axum / Actix-web)                                    */
/* ------------------------------------------------------------------ */

/** Cargo package/binary names: lowercase, digits, hyphens, underscores; must start with a letter or underscore. */
function toCargoPackageName(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z_]/.test(base) ? base || 'app' : `app-${base}`;
}

const AXUM_CARGO_TOML = (cargoName) => `[package]
name = "${cargoName}"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`;

const AXUM_MAIN_RS = `mod config;
mod handlers;
mod models;
mod routes;

#[tokio::main]
async fn main() {
    let port = config::port();
    let app = routes::create_router();

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .unwrap();
    println!("Server running at http://localhost:{port}");
    axum::serve(listener, app).await.unwrap();
}
`;

const AXUM_ROUTES_RS = `use axum::{routing::get, Router};

use crate::handlers;

pub fn create_router() -> Router {
    Router::new().route("/", get(handlers::root))
}
`;

const AXUM_HANDLERS_RS = `use axum::Json;

use crate::models::Message;

pub async fn root() -> Json<Message> {
    Json(Message {
        message: "Hello from Axum!".to_string(),
    })
}
`;

const ACTIX_CARGO_TOML = (cargoName) => `[package]
name = "${cargoName}"
version = "0.1.0"
edition = "2021"

[dependencies]
actix-web = "4"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
`;

const ACTIX_MAIN_RS = `mod config;
mod handlers;
mod models;
mod routes;

use actix_web::{App, HttpServer};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let port = config::port();
    println!("Server running at http://localhost:{port}");

    HttpServer::new(|| App::new().configure(routes::configure))
        .bind(("0.0.0.0", port))?
        .run()
        .await
}
`;

const ACTIX_ROUTES_RS = `use actix_web::web::ServiceConfig;

use crate::handlers;

pub fn configure(cfg: &mut ServiceConfig) {
    cfg.service(handlers::root);
}
`;

const ACTIX_HANDLERS_RS = `use actix_web::{get, web::Json, Responder};

use crate::models::Message;

#[get("/")]
pub async fn root() -> impl Responder {
    Json(Message {
        message: "Hello from Actix-web!".to_string(),
    })
}
`;

/** Shared between Axum and Actix-web — a plain data struct, no framework-specific trait to differ on. */
const RUST_MODELS_RS = `use serde::Serialize;

#[derive(Serialize)]
pub struct Message {
    pub message: String,
}
`;

/** Also shared — reads PORT from the environment (wired into .env by env.js), same idea as every other backend's PORT var. */
const RUST_CONFIG_RS = `use std::env;

pub fn port() -> u16 {
    env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(3000)
}
`;

const RUST_TEMPLATES = {
  'rust-axum': {
    label: 'Axum',
    cargoToml: AXUM_CARGO_TOML,
    mainRs: AXUM_MAIN_RS,
    routesRs: AXUM_ROUTES_RS,
    handlersRs: AXUM_HANDLERS_RS,
  },
  'rust-actix': {
    label: 'Actix-web',
    cargoToml: ACTIX_CARGO_TOML,
    mainRs: ACTIX_MAIN_RS,
    routesRs: ACTIX_ROUTES_RS,
    handlersRs: ACTIX_HANDLERS_RS,
  },
};

/**
 * Neither Axum nor Actix-web has an official project-scaffolding CLI (no
 * "cargo new --template axum/actix"), so — like Express/Fastify/Flask/FastAPI
 * above — this writes Cargo.toml + src/*.rs by hand. Cargo itself resolves
 * and builds dependencies on the first `cargo run`/`cargo build`, so unlike
 * every Node/Python backend there's no separate install step to run here
 * (options.install is forced false in prompts.js's stepInstall for this
 * runtime). The generic JS-shaped enterprise folder structure is skipped —
 * same reasoning as Spring Boot — but unlike a bare single-file main.rs, this
 * still gets its own idiomatic Rust module split (`routes`, `handlers`,
 * `models`, `config`) mirroring what Spring's own real Java-shaped structure
 * does: a real, working, organized starting point instead of one big file.
 */
async function handleRustBackend(options, warnings) {
  const { targetDir, packageName, framework } = options;
  await fs.ensureDir(targetDir);

  const template = RUST_TEMPLATES[framework];
  const cargoName = toCargoPackageName(packageName);
  await fs.outputFile(path.join(targetDir, 'Cargo.toml'), template.cargoToml(cargoName));
  await fs.outputFile(path.join(targetDir, 'src', 'main.rs'), template.mainRs);
  await fs.outputFile(path.join(targetDir, 'src', 'routes.rs'), template.routesRs);
  await fs.outputFile(path.join(targetDir, 'src', 'handlers.rs'), template.handlersRs);
  await fs.outputFile(path.join(targetDir, 'src', 'models.rs'), RUST_MODELS_RS);
  await fs.outputFile(path.join(targetDir, 'src', 'config.rs'), RUST_CONFIG_RS);
  await fs.writeFile(path.join(targetDir, '.gitignore'), '/target\n.env\n');

  logger.dim(`  › Wrote Cargo.toml + src/{main,routes,handlers,models,config}.rs by hand (${template.label} has no official project scaffolder).`);
  warnings.push(`Rust/${template.label} projects build via Cargo directly — run "cargo run" to fetch dependencies, compile, and start the server (no separate install step).`);

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'rust', binaryName: cargoName, port: 3000 });
  }
}

/* ------------------------------------------------------------------ */
/* AI / ML (Python)                                                     */
/* ------------------------------------------------------------------ */

const AI_ML_MAIN_PY = `def main():
    print("Hello from your create-stack AI/ML project!")


if __name__ == "__main__":
    main()
`;

/**
 * Not a web backend — a plain Python project (its own .venv + requirements.txt,
 * same machinery Django/Flask/FastAPI use above) preloaded with whichever
 * library bundles were picked in prompts.js's stepMlLibraries. No official
 * scaffolder exists for "a Python project with these libraries", so this
 * writes a minimal main.py by hand, the same exception already made for
 * Express/Fastify/Flask/FastAPI/Axum.
 */
async function handlePythonMl(options, warnings) {
  const { targetDir, mlLibraries = [] } = options;
  await fs.ensureDir(targetDir);

  await fs.outputFile(path.join(targetDir, 'main.py'), AI_ML_MAIN_PY);
  await fs.writeFile(path.join(targetDir, '.gitignore'), '.venv/\n__pycache__/\n*.pyc\n.env\n.ipynb_checkpoints/\n');

  const venvReady = await createVenv(targetDir, warnings);
  if (mlLibraries.length > 0) {
    await pipInstallOrRecord({ options, warnings, packages: mlLibraries, label: 'Selected libraries', venvReady });
  }

  await applyPythonQuality(options, warnings, venvReady);

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'python', startCommand: 'python main.py', port: 8000 });
  }
}

async function handleAI(options, warnings) {
  if (options.framework === 'ai-nextjs') return handleAiNextjs(options, warnings);
  return handlePythonMl(options, warnings);
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

  if (framework === 'wails') return handleWailsDesktop(options, warnings);
  if (framework === 'neutralino') return handleNeutralinoDesktop(options, warnings);

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

// Pinned deliberately, not left on create-expo-app's own bleeding-edge
// default: the Expo Go app on the App Store/Play Store lags several weeks
// behind each new SDK release (expo/expo#43699, expo/expo#46846). Scaffolding
// straight off the newest SDK routinely produces a project that fails on a
// real phone with "Project is incompatible with this version of Expo Go" the
// moment someone runs `npx expo start`, since most users test through the
// Expo Go app rather than a custom dev client. Bump this once Expo Go on both
// stores has caught up to a newer SDK.
const EXPO_GO_COMPATIBLE_SDK = 'sdk-54';

async function runExpoCreate(options) {
  const { pm, language, install, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  const template = `${language === 'ts' ? 'blank-typescript' : 'blank'}@${EXPO_GO_COMPATIBLE_SDK}`;
  const flags = ['--template', template, '--yes'];
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

async function handleExpoMobile(options, warnings) {
  await runExpoCreate(options);
  await normalizePackageJson(options);
  await applyStyling(options, warnings);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });
  await applyQuality(options, warnings);

  warnings.push(
    `Scaffolded on Expo ${EXPO_GO_COMPATIBLE_SDK.replace('sdk-', 'SDK ')} for Expo Go compatibility — the Expo Go app on your phone usually lags a few weeks behind the newest SDK. To move to the latest SDK instead (only if your Expo Go app supports it), run "npx expo install expo@latest" followed by "npx expo install --fix".`
  );

  if (options.docker) {
    warnings.push('Docker support was skipped — Expo apps run on-device/in-simulator and are not typically containerized.');
  }
}

/** RN app names double as native Android/iOS identifiers: letters/digits only, must start with a letter (no hyphens, unlike the folder name). */
function toReactNativeAppName(packageName) {
  const base = packageName.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9]/g, '');
  return /^[A-Za-z]/.test(base) ? base : `App${base}`;
}

/**
 * The Community CLI's own `--pm` only understands yarn/npm/bun (pnpm was
 * already filtered out of the choice itself in prompts.js's
 * stepPackageManager); `--install-pods false` skips CocoaPods entirely — most
 * dev machines (and every CI runner) don't have Xcode/CocoaPods, and without
 * an explicit value the CLI stops to prompt interactively instead of failing
 * cleanly. `--skip-git-init` and `--skip-install` mirror every other
 * scaffolder in this file: git/dependency install are handled centrally, not
 * by the tool itself.
 */
async function runReactNativeCreate(options) {
  const { pm, packageName, targetDir } = options;
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  const appName = toReactNativeAppName(packageName);
  await runScaffolder({
    label: 'Scaffolding React Native app with the Community CLI...',
    success: 'React Native app scaffolded.',
    command: 'npx',
    args: [
      '@react-native-community/cli@latest',
      'init',
      appName,
      '--directory',
      dirArg,
      '--pm',
      pm,
      '--skip-install',
      '--install-pods',
      'false',
      '--skip-git-init',
    ],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });
}

async function handleReactNativeMobile(options, warnings) {
  await runReactNativeCreate(options);
  await normalizePackageJson(options);
  await applyStyling(options, warnings);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });

  // The Community CLI's template already ships a working ESLint 8 setup
  // (.eslintrc.js + @react-native/eslint-config) — the same situation
  // Electron Forge's template is in, handled identically below.
  if (options.quality === 'eslint-prettier') {
    warnings.push("React Native's own template already ships an ESLint + Prettier config; nothing further was needed.");
  } else if (options.quality === 'biome') {
    await applyQuality(options, warnings);
    warnings.push(
      "React Native's template also ships its own ESLint config (.eslintrc.js) — remove it if you want Biome to be the only linter."
    );
  } else if (options.quality === 'none') {
    warnings.push("React Native's template always includes its own ESLint + Prettier config; there is no flag to omit it.");
  } else {
    await applyQuality(options, warnings);
  }

  warnings.push(
    'Scaffolded without a live install (bare React Native has no Expo Go-style runtime, so builds always go through your own Android Studio/Xcode toolchain). Run "npm run android" or "npm run ios" once dependencies are installed.'
  );

  if (options.docker) {
    warnings.push('Docker support was skipped — React Native apps run on-device/in-simulator and are not typically containerized.');
  }
}

/** Flutter/Dart package names: lowercase_with_underscores, must start with a letter or underscore — Dart's own identifier rules, not npm's. */
function toFlutterProjectName(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z_]/.test(base) ? base || 'app' : `app_${base}`;
}

/**
 * `flutter create` is Flutter's own official scaffolder — unlike Express/
 * Axum/etc., there's a real tool to run here, so this dispatches to it the
 * same way `ng new`/`django-admin startproject` do. It takes the output
 * directory directly as its argument (not the parent-dir + leaf-name
 * convention scaffolderInvocation() sets up for npm-family tools), and
 * `flutter pub get` runs automatically as part of scaffolding (left at its
 * default rather than passed --no-pub), which is why prompts.js's
 * stepInstall skips the install question entirely for this runtime.
 */
async function runFlutterCreate(options) {
  const { targetDir, packageName } = options;
  const projectName = toFlutterProjectName(packageName);

  await runScaffolder({
    label: 'Scaffolding Flutter app with flutter create...',
    success: 'Flutter app scaffolded.',
    command: 'flutter',
    args: ['create', '--project-name', projectName, '--org', 'com.example', targetDir],
    cwd: path.dirname(targetDir),
    expectFile: path.join(targetDir, 'pubspec.yaml'),
  });
}

/**
 * Flutter's own `android/`, `ios/`, `pubspec.yaml` layout is idiomatic Dart,
 * not JS, so the generic (JS-shaped) enterprise structure doesn't apply
 * as-is — same reasoning Spring Boot's Java-shaped layout skip uses. But
 * `flutter create` on its own only ever produces a bare `lib/main.dart`, so
 * — mirroring Spring's own real Java-shaped structure rather than skipping
 * wholesale — this still adds a Dart-flavored folder set under `lib/`
 * (FLUTTER_DIRECTORIES in structure.js: config/models/screens/services/
 * utils/widgets). Styling, quality, database, and package-manager questions
 * are all forced/skipped upstream in prompts.js (Flutter uses its own
 * widget-based styling, ships flutter_lints out of the box, and flutter
 * create already resolved its own pub packages).
 */
async function handleFlutterMobile(options, warnings) {
  await runFlutterCreate(options);
  await generateEnterpriseStructure(options, warnings, { baseDir: 'lib', directories: FLUTTER_DIRECTORIES });

  if (options.docker) {
    warnings.push('Docker support was skipped — Flutter apps run on-device/in-simulator and are not typically containerized.');
  }
}

async function handleMobile(options, warnings) {
  if (options.framework === 'flutter') return handleFlutterMobile(options, warnings);
  if (options.framework === 'react-native') return handleReactNativeMobile(options, warnings);
  if (options.framework === 'ionic') return handleIonicMobile(options, warnings);
  if (options.framework === 'kmp') return handleKmpMobile(options, warnings);
  return handleExpoMobile(options, warnings);
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
  ai: handleAI,
};

/**
 * Orchestrates the whole scaffold: dispatches to the category handler for
 * options.projectType, which runs the official initializer for the chosen
 * framework (or, for Express/Fastify, writes one by hand) and layers the
 * selected extras on top. Returns non-fatal `warnings` for the final summary.
 */
export async function scaffoldProject(options) {
  // Carries over anything noted during the wizard itself (e.g. Spring's live
  // dependency catalog falling back to its offline default) into the same
  // final summary as everything scaffolding produces.
  const warnings = [...(options.promptWarnings ?? [])];
  const handler = HANDLERS[options.projectType];
  if (!handler) throw new Error(`Unknown project type: ${options.projectType}`);

  await handler(options, warnings);
  // Whatever was picked in stepExtraPackages (Node/Python only — Spring's own
  // dependency step already covers Java) — a no-op when nothing was picked.
  await applyExtraPackages(options, warnings);
  // Every project type gets .env/.env.local/.env.production, regardless of
  // which handler ran — one call here instead of one per handler.
  await applyEnvFiles(options, warnings);

  return { warnings };
}
