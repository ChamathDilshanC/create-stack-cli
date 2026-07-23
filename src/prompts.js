import path from 'node:path';
import pc from 'picocolors';
import { autocomplete, autocompleteMultiselect, groupMultiselect, log, multiselect, select, text } from '@clack/prompts';
import { hex } from './color.js';
import { pypiPackageExists, searchNpmPackages } from './packages.js';
import { checkToolchain } from './runtime-check.js';
import { getSpringChoices } from './spring.js';
import {
  CancelledError,
  detectPackageManager,
  formatTargetDir,
  guardCancel,
  isValidPackageName,
  toValidPackageName,
} from './utils.js';

/**
 * The full decision tree: project type -> framework -> scaffolder metadata.
 * `scaffolder` is the id scaffold.js dispatches on; `viteTemplate` is only
 * present for frameworks create-vite itself supports; `forceLanguage` skips
 * Q3 entirely for frameworks that only ship a TypeScript template.
 *
 * Colors are real 24-bit hex (via color.js's `hex()`), not picocolors' 16
 * standard ANSI ones — ANSI blue in particular renders as a near-unreadable
 * dark navy on a plain black terminal background, which is exactly the
 * problem these six were picked to avoid (all vibrant/light enough to read
 * clearly regardless of terminal theme). Frontend/AI-ML originally used
 * #9b5de5/#5a189a — both too dark/muted next to the other four's saturation
 * on an actual black terminal — swapped for lighter stops off the same
 * purple gradient family instead. banner.js reuses these same six for the
 * "Frontend · Fullstack · ..." summary line, so the picker below and that
 * summary always agree on which color means which project type; the
 * banner's own decorative bars/gradient are a separate, unrelated palette.
 */
export const PROJECT_TYPES = [
  { value: 'frontend', title: 'Frontend', color: hex('#c77dff') },
  { value: 'fullstack', title: 'Fullstack', color: hex('#f15bb5') },
  { value: 'backend', title: 'Backend', color: hex('#fee440') },
  { value: 'desktop', title: 'Desktop', color: hex('#00bbf9') },
  { value: 'mobile', title: 'Mobile', color: hex('#00f5d4') },
  { value: 'ai', title: 'AI / ML', color: hex('#e0aaff') },
];

export const FRAMEWORKS = {
  frontend: [
    { value: 'react', title: 'React', scaffolder: 'vite', viteTemplate: { ts: 'react-ts', js: 'react' } },
    { value: 'vue', title: 'Vue', scaffolder: 'vite', viteTemplate: { ts: 'vue-ts', js: 'vue' } },
    { value: 'angular', title: 'Angular', scaffolder: 'angular', forceLanguage: 'ts' },
    { value: 'svelte', title: 'Svelte', scaffolder: 'vite', viteTemplate: { ts: 'svelte-ts', js: 'svelte' } },
    { value: 'solid', title: 'SolidJS', scaffolder: 'vite', viteTemplate: { ts: 'solid-ts', js: 'solid' } },
  ],
  fullstack: [
    { value: 'next', title: 'Next.js', scaffolder: 'next' },
    { value: 'nuxt', title: 'Nuxt.js', scaffolder: 'nuxt' },
    { value: 'sveltekit', title: 'SvelteKit', scaffolder: 'sveltekit' },
    { value: 'astro', title: 'Astro', scaffolder: 'astro' },
  ],
  backend: [
    { value: 'express', title: 'Express.js', scaffolder: 'manual-express' },
    { value: 'nestjs', title: 'NestJS', scaffolder: 'nestjs', forceLanguage: 'ts' },
    { value: 'fastify', title: 'Fastify', scaffolder: 'manual-fastify' },
    { value: 'hono', title: 'Hono', scaffolder: 'hono' },
    // Python's own ecosystem: no ts/js split, no npm-family package manager,
    // and its own quality/database tooling — runtime: 'python' is what
    // every other module branches on instead of assuming Node throughout.
    {
      value: 'django',
      title: 'Django (Python)',
      scaffolder: 'django',
      runtime: 'python',
      forceLanguage: 'python',
      forceDatabase: 'django-orm',
    },
    {
      value: 'flask',
      title: 'Flask (Python)',
      scaffolder: 'manual-flask',
      runtime: 'python',
      forceLanguage: 'python',
    },
    {
      value: 'fastapi',
      title: 'FastAPI (Python)',
      scaffolder: 'fastapi',
      runtime: 'python',
      forceLanguage: 'python',
    },
    // Java's own ecosystem, mirroring the Python frameworks above: no ts/js
    // split, no npm-family package manager, its own build tool instead
    // (Maven/Gradle). Database/ORM is never asked either — Spring's own
    // dependency catalog (fetched live below) already covers Spring Data
    // JPA, drivers, etc., so a separate ORM question would just be a second,
    // conflicting way to answer the same question.
    {
      value: 'spring',
      title: 'Spring Boot (Java)',
      scaffolder: 'spring',
      runtime: 'java',
      forceLanguage: 'java',
      forceDatabase: 'spring-initializr',
    },
    // Rust's own ecosystem, mirroring Python/Java above: no ts/js split, no
    // npm-family package manager (Cargo instead), and Cargo itself resolves
    // + builds dependencies on first run, so there's no separate install
    // step either. Axum has no official project-scaffolding CLI (no
    // "cargo new --template axum"), so it's hand-written the same way
    // Express/Fastify/Flask/FastAPI are below.
    {
      value: 'rust-axum',
      title: 'Axum (Rust)',
      scaffolder: 'rust',
      runtime: 'rust',
      forceLanguage: 'rust',
      forceDatabase: 'none',
    },
    // Actix-web: same Rust ecosystem/skips as Axum above, just a different
    // hand-written Cargo.toml + src/main.rs template — scaffold.js branches
    // on the framework value to pick the right one.
    {
      value: 'rust-actix',
      title: 'Actix-web (Rust)',
      scaffolder: 'rust',
      runtime: 'rust',
      forceLanguage: 'rust',
      forceDatabase: 'none',
    },
    // Go's own ecosystem: no ts/js split, no npm-family package manager (Go
    // modules instead), and none of Gin/Fiber/Echo has an official project-
    // scaffolding CLI — hand-written in backend-go.js the same way
    // Express/Fastify/Axum/Actix-web are above. forceDatabase 'none' is the
    // same "descope for this step" call already made for Rust/Spring.
    { value: 'go-gin', title: 'Gin (Go)', scaffolder: 'go', runtime: 'go', forceLanguage: 'go', forceDatabase: 'none' },
    { value: 'go-fiber', title: 'Fiber (Go)', scaffolder: 'go', runtime: 'go', forceLanguage: 'go', forceDatabase: 'none' },
    { value: 'go-echo', title: 'Echo (Go)', scaffolder: 'go', runtime: 'go', forceLanguage: 'go', forceDatabase: 'none' },
    // Laravel: a real official scaffolder (composer create-project
    // laravel/laravel, in backend-php.js), unlike the hand-written Go
    // frameworks above. Ships its own Eloquent ORM (SQLite configured by
    // default) — forceDatabase here is purely informational, the same trick
    // Django's forceDatabase already uses, since there's no separate ORM
    // question left to ask.
    {
      value: 'laravel',
      title: 'Laravel (PHP)',
      scaffolder: 'laravel',
      runtime: 'php',
      forceLanguage: 'php',
      forceDatabase: 'laravel-eloquent',
    },
    // Rails: another real official scaffolder (rails new, in
    // backend-ruby.js) — same "own ORM already wired in" story as Laravel
    // above (ActiveRecord + SQLite).
    {
      value: 'rails',
      title: 'Ruby on Rails (Ruby)',
      scaffolder: 'rails',
      runtime: 'ruby',
      forceLanguage: 'ruby',
      forceDatabase: 'rails-activerecord',
    },
    // ASP.NET Core: `dotnet new webapi` is the .NET SDK's own official
    // template (backend-dotnet.js). No ORM question yet (EF Core is a
    // follow-up) — forceDatabase 'none' mirrors Rust/Spring/Go above rather
    // than Laravel/Rails.
    {
      value: 'dotnet',
      title: 'ASP.NET Core (C#)',
      scaffolder: 'dotnet',
      runtime: 'dotnet',
      forceLanguage: 'csharp',
      forceDatabase: 'none',
    },
    // Deno's own ecosystem: deno.json instead of package.json, no npm-family
    // package manager, imports resolved (and cached) straight from JSR/npm
    // specifiers on first run — no separate install step, same story as
    // Rust/Cargo. Both forced to TypeScript: Fresh is TS-first, and keeping
    // Oak's hand-written template to one language variant (rather than a
    // ts/js split like Express) keeps this step's scope tighter.
    {
      value: 'deno-fresh',
      title: 'Fresh (Deno)',
      scaffolder: 'deno-fresh',
      runtime: 'deno',
      forceLanguage: 'ts',
      forceDatabase: 'none',
    },
    // Oak has no official project-scaffolding CLI (a middleware framework,
    // like Express) — hand-written in backend-deno.js the same way
    // Express/Fastify/Go are above.
    {
      value: 'deno-oak',
      title: 'Oak (Deno)',
      scaffolder: 'deno-oak',
      runtime: 'deno',
      forceLanguage: 'ts',
      forceDatabase: 'none',
    },
    // Ktor: unlike Spring Boot's start.spring.io, start.ktor.io has no
    // documented public generator API this CLI could safely integrate with —
    // so this is hand-written in backend-kotlin.js (a Gradle Kotlin DSL
    // project), the same exception already made for Axum/Actix-web/Go/Oak
    // above, rather than a live catalog like Spring's.
    {
      value: 'ktor',
      title: 'Ktor (Kotlin)',
      scaffolder: 'ktor',
      runtime: 'kotlin',
      forceLanguage: 'kotlin',
      forceDatabase: 'none',
    },
  ],
  desktop: [
    { value: 'electron', title: 'Electron', scaffolder: 'electron' },
    { value: 'tauri', title: 'Tauri', scaffolder: 'tauri' },
    // Wails: Go backend + a webview frontend (Go's answer to Tauri/Electron
    // — a Go binary embedding a native OS webview instead of Chromium/Rust).
    // Its own `wails init` scaffolds both halves in one project, the same
    // "call the real official tool" story every runScaffolder-based entry
    // here follows. forceDatabase 'none' mirrors every other Go entry
    // (Gin/Fiber/Echo above) — no separate ORM question either.
    { value: 'wails', title: 'Wails (Go + Web)', scaffolder: 'wails', runtime: 'go', forceLanguage: 'go', forceDatabase: 'none' },
    // Neutralino.js: a lightweight native wrapper like Tauri/Wails, but
    // needs neither Rust nor Go — just Node + its own small compiled
    // binary (fetched by @neutralinojs/neu itself at scaffold time), so it
    // stays on runtime 'node' like Electron rather than forcing a new one.
    { value: 'neutralino', title: 'Neutralino.js', scaffolder: 'neutralino' },
  ],
  mobile: [
    // Bare React Native via the official Community CLI — no Expo layer.
    // Its current template ships TypeScript only (no JS flag exists in the
    // CLI anymore, confirmed against @react-native-community/cli@20.2.0's
    // own --help), so this forces TS the same way Angular/NestJS do.
    { value: 'react-native', title: 'React Native', scaffolder: 'react-native', forceLanguage: 'ts' },
    { value: 'expo', title: 'Expo (React Native)', scaffolder: 'expo' },
    // Flutter is its own ecosystem entirely — Dart, not JS: no ts/js split,
    // no npm-family package manager (`flutter create` resolves its own pub
    // packages), and its own lint/format tooling (flutter_lints +
    // `flutter analyze`, already wired into every generated project) means
    // the quality/database/styling questions below are all skipped for it.
    { value: 'flutter', title: 'Flutter (Dart)', scaffolder: 'flutter', runtime: 'dart', forceLanguage: 'dart' },
    // Ionic's own `ionic start` scaffolds a Capacitor-backed hybrid app;
    // this CLI always asks for the React flavor (Ionic also offers Angular/
    // Vue starters, but one is enough to keep this entry's scope the same
    // size as every other single-flavor mobile framework here) — its React
    // starter is TypeScript-only, same story as bare React Native above.
    { value: 'ionic', title: 'Ionic (React)', scaffolder: 'ionic', forceLanguage: 'ts' },
    // Kotlin Multiplatform reuses Ktor's own runtime 'kotlin' (no npm-family
    // package manager, Gradle instead, quality/database/testing questions
    // all skipped the same way) — see backend-kotlin.js's handleKtorBackend
    // for the precedent this mirrors.
    { value: 'kmp', title: 'Kotlin Multiplatform (KMP)', scaffolder: 'kmp', runtime: 'kotlin', forceLanguage: 'kotlin', forceDatabase: 'none' },
  ],
  ai: [
    // Not a web backend — a plain Python project preloaded with whichever
    // data-science/ML library bundles were picked in stepMlLibraries below.
    { value: 'python-ml', title: 'Python (Data Science / ML)', scaffolder: 'python-ml', runtime: 'python', forceLanguage: 'python' },
    // The JS/TS track: a real Next.js app (not a plain script, unlike the
    // Python entry above) pre-wired with the Vercel AI SDK + LangChain.js —
    // an opinionated preset in the same spirit as Flutter/Rust/Spring
    // above, not a wizard-configurable framework: project type 'ai' isn't
    // in supportsStyling/supportsDatabase/supportsAuth/supportsTesting/etc
    // (see those predicates further down), so none of those questions get
    // asked for it either — ai.js's own handler makes those calls itself
    // (always TypeScript + Tailwind) rather than reading options.styling.
    { value: 'ai-nextjs', title: 'Next.js + Vercel AI SDK (JS/TS)', scaffolder: 'ai-nextjs', forceLanguage: 'ts' },
  ],
};

/**
 * Curated PyPI bundles for the AI/ML project type, grouped the same way
 * start.spring.io groups its own dependency catalog. Picked for being
 * actively maintained where a maintained alternative exists (e.g. Pillow
 * over the long-abandoned PIL, scikit-learn over unmaintained peers) —
 * this is a static list (unlike Spring's live-fetched one or PyPI search in
 * stepExtraPackages) since there's no equivalent live "top ML packages" API.
 */
export const ML_LIBRARY_GROUPS = {
  'Machine Learning': [
    { value: 'numpy', title: 'NumPy' },
    { value: 'pandas', title: 'Pandas' },
    { value: 'scipy', title: 'SciPy' },
    { value: 'matplotlib', title: 'Matplotlib' },
    { value: 'seaborn', title: 'Seaborn' },
    { value: 'scikit-learn', title: 'Scikit-learn' },
    { value: 'tensorflow', title: 'TensorFlow' },
    { value: 'keras', title: 'Keras' },
    { value: 'torch', title: 'PyTorch' },
  ],
  'Web Scraping': [
    { value: 'requests', title: 'Requests' },
    { value: 'beautifulsoup4', title: 'Beautiful Soup' },
    { value: 'scrapy', title: 'Scrapy' },
    { value: 'selenium', title: 'Selenium' },
    { value: 'lxml', title: 'lxml' },
  ],
  'Image Processing': [
    { value: 'opencv-python', title: 'OpenCV' },
    { value: 'scikit-image', title: 'scikit-image' },
    { value: 'mahotas', title: 'Mahotas' },
    { value: 'SimpleITK', title: 'SimpleITK' },
    { value: 'Pillow', title: 'Pillow' },
  ],
  'Game Development': [
    { value: 'pygame', title: 'Pygame' },
    { value: 'pyglet', title: 'Pyglet' },
    { value: 'PyOpenGL', title: 'PyOpenGL' },
    { value: 'arcade', title: 'Arcade' },
    { value: 'panda3d', title: 'Panda3D' },
  ],
  'Automation Testing': [
    { value: 'pytest', title: 'Pytest' },
    { value: 'splinter', title: 'Splinter' },
    { value: 'robotframework', title: 'Robot Framework' },
    { value: 'behave', title: 'Behave' },
  ],
};

export const STYLING_OPTIONS = [
  { value: 'tailwind', title: 'Tailwind CSS (v4)' },
  { value: 'unocss', title: 'UnoCSS' },
  { value: 'css-modules', title: 'CSS Modules' },
  { value: 'none', title: 'None' },
];

/** Mobile's own styling choice — Tailwind/UnoCSS/CSS Modules are web-only; NativeWind is React Native's Tailwind-compatible equivalent. Not offered for Flutter (a completely different, widget-based styling system) — see stepStyling's runtime check below. */
export const STYLING_OPTIONS_MOBILE = [
  { value: 'nativewind', title: 'NativeWind' },
  { value: 'none', title: 'None' },
];

/** React/Next.js's state management choices — see stepStateManagement below for the Vue/Nuxt (Pinia) counterpart. */
export const STATE_MANAGEMENT_OPTIONS_REACT = [
  { value: 'zustand', title: 'Zustand' },
  { value: 'redux-toolkit', title: 'Redux Toolkit' },
  { value: 'jotai', title: 'Jotai' },
  { value: 'none', title: 'None' },
];

/** Vue/Nuxt's own state management choice — Pinia is Vue's official successor to Vuex, with no real alternative worth offering alongside it here. */
export const STATE_MANAGEMENT_OPTIONS_VUE = [
  { value: 'pinia', title: 'Pinia' },
  { value: 'none', title: 'None' },
];

/** Real scaffolding only for tRPC/GraphQL on React and Next.js so far (see api-layer.js) — offered across every frontend/fullstack framework anyway, the same "full menu, one real implementation" story TESTING_OPTIONS below already tells. */
export const API_LAYER_OPTIONS = [
  { value: 'trpc', title: 'tRPC' },
  { value: 'graphql-apollo', title: 'GraphQL (Apollo Client)' },
  { value: 'graphql-urql', title: 'GraphQL (URQL)' },
  { value: 'none', title: 'None' },
];

/** React/Next.js's UI kit choices when Tailwind is the styling pick — shadcn/ui and DaisyUI are both Tailwind-only (see stepUiKit below for the non-Tailwind and non-React variants). */
export const UI_KIT_OPTIONS_REACT_TAILWIND = [
  { value: 'shadcn', title: 'shadcn/ui' },
  { value: 'mui', title: 'Material UI' },
  { value: 'chakra', title: 'Chakra UI' },
  { value: 'antd', title: 'Ant Design' },
  { value: 'daisyui', title: 'DaisyUI' },
  { value: 'none', title: 'None' },
];

/** React/Next.js without Tailwind — shadcn/ui and DaisyUI drop off the list above since both require it. */
export const UI_KIT_OPTIONS_REACT = [
  { value: 'mui', title: 'Material UI' },
  { value: 'chakra', title: 'Chakra UI' },
  { value: 'antd', title: 'Ant Design' },
  { value: 'none', title: 'None' },
];

/** Every other frontend/fullstack framework with Tailwind on (Vue, Svelte, Angular, ...) — DaisyUI is a plain Tailwind plugin with no React dependency, so it's the one kit this CLI can safely offer outside the React family. */
export const UI_KIT_OPTIONS_DAISYUI_ONLY = [
  { value: 'daisyui', title: 'DaisyUI' },
  { value: 'none', title: 'None' },
];

export const DATABASE_OPTIONS = [
  { value: 'prisma', title: 'Prisma' },
  { value: 'drizzle', title: 'Drizzle ORM' },
  { value: 'mongoose', title: 'Mongoose' },
  { value: 'none', title: 'None' },
];

/** Flask/FastAPI's database choice — Django always forces 'django-orm' instead (see forceDatabase above), skipping this question entirely. */
export const DATABASE_OPTIONS_PYTHON = [
  { value: 'sqlalchemy', title: 'SQLAlchemy' },
  { value: 'none', title: 'None' },
];

export const QUALITY_OPTIONS = [
  { value: 'eslint-prettier', title: 'ESLint + Prettier' },
  { value: 'biome', title: 'Biome' },
  { value: 'none', title: 'None' },
];

export const QUALITY_OPTIONS_PYTHON = [
  { value: 'ruff', title: 'Ruff (lint + format)' },
  { value: 'black-flake8', title: 'Black + Flake8' },
  { value: 'none', title: 'None' },
];

export const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'];

/**
 * Only Vitest has real scaffolding logic behind it (testing.js) — Jest,
 * Playwright, and Cypress are still listed (rather than left off the menu
 * entirely) so the question reflects the full space this CLI is growing
 * toward; picking one of those three still scaffolds successfully, just
 * with a "not yet wired" warning in the final summary instead of a real
 * config, the same "not yet automated" story already true for Rust/Spring
 * Boot's quality question.
 */
export const TESTING_OPTIONS = [
  { value: 'vitest', title: 'Vitest' },
  { value: 'jest', title: 'Jest' },
  { value: 'playwright', title: 'Playwright' },
  { value: 'cypress', title: 'Cypress' },
  { value: 'none', title: 'None' },
];

/** Same "full menu, one real implementation" story as TESTING_OPTIONS above — only Auth.js has real scaffolding logic behind it (auth.js), and even then only for Next.js/Express (see stepAuth's callers in scaffold.js). */
export const AUTH_OPTIONS = [
  { value: 'authjs', title: 'Auth.js (NextAuth)' },
  { value: 'clerk', title: 'Clerk' },
  { value: 'lucia', title: 'Lucia' },
  { value: 'passport', title: 'Passport' },
  { value: 'none', title: 'None' },
];

/** Styling only makes sense where there's UI to style. Mobile included since NativeWind applies to React Native (bare or Expo) — Flutter opts back out itself, in stepStyling below. */
export const supportsStyling = (projectType) =>
  projectType === 'frontend' || projectType === 'fullstack' || projectType === 'desktop' || projectType === 'mobile';

/** A database/ORM only makes sense where there's a server to run it in. */
export const supportsDatabase = (projectType) => projectType === 'backend' || projectType === 'fullstack';

/** Testing makes sense anywhere there's Node code to test at all — including a plain frontend SPA, unlike Database above. */
export const supportsTesting = (projectType) =>
  projectType === 'frontend' || projectType === 'fullstack' || projectType === 'backend';

/** Same reasoning as Database above — auth needs a server/session to hold, so this is never asked for a plain frontend SPA (or Desktop/Mobile/AI). */
export const supportsAuth = (projectType) => projectType === 'backend' || projectType === 'fullstack';

/**
 * Only `backend` gets asked — frontend/fullstack's own dev server (Vite,
 * Next.js, Nuxt, SvelteKit, Astro) already hot-reloads with nothing to
 * configure, and Desktop/Mobile/AI have no long-running dev server this CLI
 * manages at all. Unlike supportsTesting/supportsAuth above, this isn't
 * restricted to `runtime === 'node'` — Python and Go backends get asked too
 * (see stepHotReload below).
 */
export const supportsHotReload = (projectType) => projectType === 'backend';

/**
 * Shared by stepStateManagement, stepApiLayer, and stepUiKit below — state
 * management, an API layer, and a UI kit are all "how the UI is built"
 * decisions, so (unlike Auth/Database/Testing above, which need a server to
 * mean anything) they only make sense where there's a UI at all: a plain
 * frontend SPA or a fullstack app, never Backend/Desktop/Mobile/AI.
 */
export const supportsUiLayer = (projectType) => projectType === 'frontend' || projectType === 'fullstack';

/** Sentinel a select-style step resolves to when the user picks "← Back" instead of answering. */
const BACK = Symbol('back');

/** Appends a "← Back" choice to a list of clack `{ value, label }` options. Always last, so existing `initialValue`s stay valid. */
function withBack(options) {
  return [...options, { value: BACK, label: pc.dim('← Back') }];
}

/** This codebase's `{ value, title }` shape → clack's own `{ value, label }` option shape. */
const toOptions = (choices) => choices.map((c) => ({ value: c.value, label: c.title }));

function getFrameworkDef(result) {
  const frameworkChoices = FRAMEWORKS[result.projectType];
  if (!frameworkChoices) throw new Error(`Unknown project type: ${result.projectType}`);
  const frameworkDef = frameworkChoices.find((f) => f.value === result.framework);
  if (!frameworkDef) {
    throw new Error(`Unknown framework "${result.framework}" for project type "${result.projectType}".`);
  }
  return frameworkDef;
}

/*
 * Each step below mutates `result` in place and returns one of:
 *   'ok'   — a question was actually shown and answered; the driver records
 *            a snapshot so a later step's "← Back" can return here.
 *   'skip' — nothing was asked (preset via CLI flag, forced by the chosen
 *            framework, or not applicable to this project type); the driver
 *            does not record a snapshot, so "← Back" jumps straight past it.
 *   'back' — the user picked "← Back"; the driver rewinds to the previous
 *            recorded snapshot and re-runs that step.
 */

async function stepProjectName(result) {
  if (result.projectName) return 'skip';
  const projectName = guardCancel(
    await text({
      message: 'Project name:',
      placeholder: 'my-app',
      defaultValue: 'my-app',
    })
  );
  result.projectName = formatTargetDir(projectName) || 'my-app';
  return 'ok';
}

async function stepPackageName(result) {
  const targetDir = formatTargetDir(result.projectName);
  const computedPackageName = path.basename(path.resolve(targetDir));

  if (isValidPackageName(computedPackageName)) {
    result.packageName = computedPackageName;
    return 'skip';
  }

  const overwritePackageName = guardCancel(
    await text({
      message: 'Package name:',
      initialValue: toValidPackageName(computedPackageName),
      validate: (name) => (isValidPackageName(name) ? undefined : 'Invalid package.json name.'),
    })
  );
  result.packageName = overwritePackageName;
  return 'ok';
}

/**
 * Each option's `hint` lists every framework that project type contains
 * (e.g. Frontend → "React, Vue, Angular, Svelte, SolidJS") — clack's
 * autocomplete filter matches against label AND hint, so typing a framework
 * name ("django", "vue", "nestjs") surfaces its parent category here too,
 * not just a project type's own name. The hint itself only renders next to
 * whichever option is currently focused, so it doubles as a quick "what's
 * in here" preview while arrowing through the list.
 */
async function stepProjectType(result) {
  if (result.projectType) return 'skip';
  const projectType = guardCancel(
    await autocomplete({
      message: 'What are you building?',
      options: withBack(
        PROJECT_TYPES.map((t) => ({
          value: t.value,
          label: t.color(t.title),
          hint: FRAMEWORKS[t.value].map((f) => f.title).join(', '),
        }))
      ),
      placeholder: 'Type to search...',
    })
  );
  if (projectType === BACK) return 'back';
  result.projectType = projectType;
  return 'ok';
}

/** Skipped when the category only has one option (Mobile) — nothing to choose. */
async function stepFramework(result) {
  const frameworkChoices = FRAMEWORKS[result.projectType];
  if (!frameworkChoices) throw new Error(`Unknown project type: ${result.projectType}`);

  let prompted = false;
  if (!result.framework) {
    if (frameworkChoices.length === 1) {
      result.framework = frameworkChoices[0].value;
    } else {
      const framework = guardCancel(
        await autocomplete({
          message: 'Select a framework:',
          options: withBack(toOptions(frameworkChoices)),
          placeholder: 'Type to search...',
        })
      );
      if (framework === BACK) return 'back';
      result.framework = framework;
      prompted = true;
    }
  }

  const frameworkDef = getFrameworkDef(result);
  result.scaffolder = frameworkDef.scaffolder;
  result.viteTemplate = frameworkDef.viteTemplate;
  // Everything else in this CLI assumes Node (npm-family package manager,
  // ESLint/Biome, package.json) unless a module explicitly checks this.
  result.runtime = frameworkDef.runtime ?? 'node';

  return prompted ? 'ok' : 'skip';
}

/**
 * Laravel/Rails/.NET/Fresh have no hand-written fallback (see backend-php.js/
 * backend-ruby.js/backend-dotnet.js/backend-deno.js) — a missing toolchain
 * there hard-fails the whole scaffold. Go/Oak/Ktor are deliberately absent
 * from this table: those already write their hand-written files and just
 * warn, so there's nothing for a preflight check to prevent.
 */
const OFFICIAL_TOOLCHAIN_REQUIREMENTS = {
  laravel: [{ command: 'composer', versionArgs: ['--version'], label: 'Composer', installHint: 'https://getcomposer.org/download/' }],
  rails: [
    { command: 'ruby', versionArgs: ['--version'], label: 'Ruby', installHint: 'https://www.ruby-lang.org/en/downloads/' },
    { command: 'rails', versionArgs: ['--version'], label: 'The Rails gem ("gem install rails")', installHint: 'https://www.ruby-lang.org/en/downloads/' },
  ],
  dotnet: [{ command: 'dotnet', versionArgs: ['--version'], label: 'The .NET SDK', installHint: 'https://dotnet.microsoft.com/download' }],
  'deno-fresh': [{ command: 'deno', versionArgs: ['--version'], label: 'Deno', installHint: 'https://docs.deno.com/runtime/getting_started/installation/' }],
};

/**
 * Catches a missing Composer/Ruby+Rails/.NET SDK/Deno right after the
 * framework is picked, instead of letting it surface as a hard crash deep
 * inside scaffold.js after every other question has already been answered.
 * Reuses the exact same "← Back" rewind mechanism every other step's BACK
 * sentinel already drives — returning 'back' here pops right back to
 * stepFramework's own history entry, so picking a different framework just
 * works, no special-case restart logic needed. Skipped entirely outside
 * interactive mode (--yes): scripts/CI should still fail fast with a clear
 * message, not stop to ask a question nothing is there to answer.
 */
async function stepToolchainPreflight(result, { interactive } = {}) {
  const requirements = OFFICIAL_TOOLCHAIN_REQUIREMENTS[result.framework];
  if (!requirements || !interactive) return 'skip';

  for (const { command, versionArgs, label, installHint } of requirements) {
    const found = await checkToolchain(command, versionArgs);
    if (found) continue;

    log.error(`${label} was not found on PATH — required to scaffold ${getFrameworkDef(result).title}. Install it first: ${installHint}`);
    const choice = guardCancel(
      await select({
        message: 'What would you like to do?',
        options: [
          { value: 'back', label: 'Pick a different framework' },
          { value: 'exit', label: 'Exit and install it myself' },
        ],
      })
    );
    if (choice === 'exit') {
      throw new CancelledError(`Scaffold cancelled — install ${label} first, then re-run.`);
    }
    return 'back';
  }
  return 'skip';
}

/** Hidden entirely when the framework forces one (Angular, NestJS, every Python/Java framework). */
async function stepLanguage(result) {
  const frameworkDef = getFrameworkDef(result);
  if (frameworkDef.forceLanguage) {
    result.language = frameworkDef.forceLanguage;
    return 'skip';
  }
  if (result.language) return 'skip';

  const language = guardCancel(
    await select({
      message: 'Language:',
      options: withBack([
        { value: 'ts', label: 'TypeScript' },
        { value: 'js', label: 'JavaScript' },
      ]),
      initialValue: 'ts',
    })
  );
  if (language === BACK) return 'back';
  result.language = language;
  return 'ok';
}

/** Only where there's UI to style. Flutter is 'mobile' too but is a widget-based, non-CSS styling system entirely — forced/skipped the same way Java/Rust skip quality below. */
async function stepStyling(result) {
  if (!supportsStyling(result.projectType) || result.runtime === 'dart') {
    result.styling = 'none';
    return 'skip';
  }
  if (result.styling) return 'skip';

  const styling = guardCancel(
    await autocomplete({
      message: 'Styling:',
      options: withBack(toOptions(result.projectType === 'mobile' ? STYLING_OPTIONS_MOBILE : STYLING_OPTIONS)),
      placeholder: 'Type to search...',
    })
  );
  if (styling === BACK) return 'back';
  result.styling = styling;
  return 'ok';
}

/** Frameworks with a real state-management choice wired up (see state-management.js) — everything else (Svelte, Solid, Angular, SvelteKit, Astro) skips the question entirely rather than offering options that would just fall through to "not yet wired". */
const STATE_MANAGEMENT_REACT_FAMILY = new Set(['react', 'next']);
const STATE_MANAGEMENT_VUE_FAMILY = new Set(['vue', 'nuxt']);

async function stepStateManagement(result) {
  const isReactFamily = STATE_MANAGEMENT_REACT_FAMILY.has(result.framework);
  const isVueFamily = STATE_MANAGEMENT_VUE_FAMILY.has(result.framework);
  if (!supportsUiLayer(result.projectType) || (!isReactFamily && !isVueFamily)) {
    result.stateManagement = 'none';
    return 'skip';
  }
  if (result.stateManagement) return 'skip';

  const stateManagement = guardCancel(
    await autocomplete({
      message: 'State management:',
      options: withBack(toOptions(isReactFamily ? STATE_MANAGEMENT_OPTIONS_REACT : STATE_MANAGEMENT_OPTIONS_VUE)),
      placeholder: 'Type to search...',
    })
  );
  if (stateManagement === BACK) return 'back';
  result.stateManagement = stateManagement;
  return 'ok';
}

/** Asked across every frontend/fullstack framework (unlike state management above, whose option set itself is framework-specific) — api-layer.js pushes its own "not yet wired" warning for anything besides React/Next.js. */
async function stepApiLayer(result) {
  if (!supportsUiLayer(result.projectType)) {
    result.apiLayer = 'none';
    return 'skip';
  }
  if (result.apiLayer) return 'skip';

  const apiLayer = guardCancel(
    await autocomplete({
      message: 'API layer:',
      options: withBack(toOptions(API_LAYER_OPTIONS)),
      placeholder: 'Type to search...',
    })
  );
  if (apiLayer === BACK) return 'back';
  result.apiLayer = apiLayer;
  return 'ok';
}

/**
 * Runs after stepStyling (needs result.styling already resolved — shadcn/ui
 * and DaisyUI both require Tailwind). React/Next.js get the full menu
 * (narrowed further to drop shadcn/DaisyUI when Tailwind isn't picked);
 * every other framework only ever sees DaisyUI, and only with Tailwind on,
 * since MUI/Chakra/shadcn/Ant Design are all React-only (see ui-kits.js).
 */
const UI_KIT_REACT_FAMILY = new Set(['react', 'next']);

async function stepUiKit(result) {
  if (!supportsUiLayer(result.projectType)) {
    result.uiKit = 'none';
    return 'skip';
  }

  const isReactFamily = UI_KIT_REACT_FAMILY.has(result.framework);
  const hasTailwind = result.styling === 'tailwind';
  if (!isReactFamily && !hasTailwind) {
    result.uiKit = 'none';
    return 'skip';
  }
  if (result.uiKit) return 'skip';

  const options = isReactFamily ? (hasTailwind ? UI_KIT_OPTIONS_REACT_TAILWIND : UI_KIT_OPTIONS_REACT) : UI_KIT_OPTIONS_DAISYUI_ONLY;

  const uiKit = guardCancel(
    await autocomplete({
      message: 'UI kit:',
      options: withBack(toOptions(options)),
      placeholder: 'Type to search...',
    })
  );
  if (uiKit === BACK) return 'back';
  result.uiKit = uiKit;
  return 'ok';
}

/**
 * Only where there's a server to run it in. Django always ships its own ORM,
 * so this is forced/skipped for it, the same way Angular/NestJS force a
 * language above.
 */
async function stepDatabase(result) {
  const frameworkDef = getFrameworkDef(result);
  if (frameworkDef.forceDatabase) {
    result.database = frameworkDef.forceDatabase;
    return 'skip';
  }
  if (!supportsDatabase(result.projectType)) {
    result.database = 'none';
    return 'skip';
  }
  if (result.database) return 'skip';

  const database = guardCancel(
    await autocomplete({
      message: 'Database / ORM:',
      options: withBack(toOptions(result.runtime === 'python' ? DATABASE_OPTIONS_PYTHON : DATABASE_OPTIONS)),
      placeholder: 'Type to search...',
    })
  );
  if (database === BACK) return 'back';
  result.database = database;
  return 'ok';
}

/**
 * Next to Database, same idea: only makes sense where there's a server/
 * session to hold one. Node-only for now — none of Step 1's Go/PHP/Ruby/
 * .NET/Deno/Kotlin backends share a common Node auth ecosystem to hook into,
 * so this is skipped for every runtime other than 'node' the same way
 * stepExtraPackages already narrows to node/python only.
 */
async function stepAuth(result) {
  if (!supportsAuth(result.projectType) || result.runtime !== 'node') {
    result.auth = 'none';
    return 'skip';
  }
  if (result.auth) return 'skip';

  const auth = guardCancel(
    await autocomplete({
      message: 'Authentication:',
      options: withBack(toOptions(AUTH_OPTIONS)),
      placeholder: 'Type to search...',
    })
  );
  if (auth === BACK) return 'back';
  result.auth = auth;
  return 'ok';
}

/**
 * Broader than Database/Auth above — testing makes sense for a plain
 * frontend SPA too, so this is shown for Frontend as well as Backend/
 * Fullstack. Node-only, same reasoning as stepAuth above.
 */
async function stepTesting(result) {
  if (!supportsTesting(result.projectType) || result.runtime !== 'node') {
    result.testing = 'none';
    return 'skip';
  }
  if (result.testing) return 'skip';

  const testing = guardCancel(
    await autocomplete({
      message: 'Testing setup:',
      options: withBack(toOptions(TESTING_OPTIONS)),
      placeholder: 'Type to search...',
    })
  );
  if (testing === BACK) return 'back';
  result.testing = testing;
  return 'ok';
}

/**
 * Node/Python/Go backends all get wired to a real auto-restart-on-change
 * tool for "No" (see scaffold.js/backend-go.js) — this is the one question
 * behind all three, asked once regardless of which runtime ends up chosen.
 * Spring Boot skips this and asks its own equivalent instead (see
 * stepSpringHotReload below, via DevTools) rather than asking twice.
 */
async function stepHotReload(result) {
  if (!supportsHotReload(result.projectType) || isSpring(result)) {
    // Not this step's call to make (frontend/fullstack already hot-reload
    // out of the box; Spring has its own springHotReload question instead)
    // — dropped rather than left as whatever a blanket -y default or a
    // replayed config happened to carry in, so it never leaks into a saved
    // .create-stack.json for a project type it doesn't apply to.
    delete result.hotReload;
    return 'skip';
  }
  if (result.hotReload !== undefined) return 'skip';

  const hotReload = guardCancel(
    await select({
      message: 'Set up auto-restart / hot-reloading for development?',
      options: withBack([
        { value: true, label: 'Yes' },
        { value: false, label: 'No' },
      ]),
      initialValue: true,
    })
  );
  if (hotReload === BACK) return 'back';
  result.hotReload = hotReload;
  return 'ok';
}

/**
 * AI/ML project type only. A grouped multiselect over the static catalog
 * above — the same "search live, never bundle" philosophy behind Spring's
 * dependency picker and stepExtraPackages doesn't apply here since there's
 * no live "top ML packages" API to query, so this ships a curated list
 * instead. No "← Back" choice, for the same reason stepSpringDependencies
 * has none: a multiselect's choices are the answer itself, so there's no
 * single sentinel value to react to — Ctrl+C and re-running is the way out.
 */
async function stepMlLibraries(result) {
  if (result.framework !== 'python-ml') return 'skip';
  if (result.mlLibraries !== undefined) return 'skip';

  const options = Object.fromEntries(
    Object.entries(ML_LIBRARY_GROUPS).map(([group, pkgs]) => [group, toOptions(pkgs)])
  );

  const mlLibraries = guardCancel(
    await groupMultiselect({
      message: 'Library bundles to install (space to toggle, enter to confirm):',
      options,
      required: false,
    })
  );
  result.mlLibraries = mlLibraries;
  return 'ok';
}

const isSpring = (result) => result.framework === 'spring';

/** Spring Boot only — every other framework skips these three straight through. */
async function stepSpringBuildTool(result) {
  if (!isSpring(result)) return 'skip';
  if (result.buildTool) return 'skip';

  const buildTool = guardCancel(
    await select({
      message: 'Build tool:',
      options: withBack([
        { value: 'maven', label: 'Maven' },
        { value: 'gradle', label: 'Gradle' },
      ]),
    })
  );
  if (buildTool === BACK) return 'back';
  result.buildTool = buildTool;
  return 'ok';
}

async function stepSpringPackaging(result) {
  if (!isSpring(result)) return 'skip';
  if (result.packaging) return 'skip';

  const packaging = guardCancel(
    await select({
      message: 'Packaging:',
      options: withBack([
        { value: 'jar', label: 'Jar' },
        { value: 'war', label: 'War' },
      ]),
      initialValue: 'jar',
    })
  );
  if (packaging === BACK) return 'back';
  result.packaging = packaging;
  return 'ok';
}

/**
 * Fetches Spring Initializr's live metadata once (cached in spring.js at the
 * process level), pulls this run's current Java version choices from it, and
 * stashes the dependency catalog on `result` for stepSpringDependencies right
 * after — one network round trip for both steps instead of two. (The Boot
 * version itself is resolved separately, fresh, at actual generation time —
 * see spring.js's resolveBootVersion.)
 */
async function stepSpringJavaVersion(result) {
  if (!isSpring(result)) return 'skip';
  if (result.javaVersion) return 'skip';

  if (!result.promptWarnings) result.promptWarnings = [];
  const catalog = await getSpringChoices(result.promptWarnings);
  result._springDependencyChoices = catalog.dependencies;

  const javaVersion = guardCancel(
    await select({
      message: 'Java version:',
      options: withBack(catalog.javaVersions.map((v) => ({ value: v, label: v }))),
      initialValue: catalog.javaVersions[0],
    })
  );
  if (javaVersion === BACK) return 'back';
  result.javaVersion = javaVersion;
  return 'ok';
}

/**
 * Spring's own dependency catalog — fetched live from start.spring.io, never
 * bundled in this package (it's added to dozens of times a year). Search-as-
 * you-type over the full live catalog, exactly like start.spring.io's own
 * web UI. No "← Back" choice here: a multiselect's choices are the answer
 * itself, so there's no single sentinel value to react to the way every
 * select-type step above does — Ctrl+C and re-running is the way out.
 */
async function stepSpringDependencies(result) {
  if (!isSpring(result)) return 'skip';
  if (result.springDependencies) return 'skip';

  const dependencies = guardCancel(
    await autocompleteMultiselect({
      message: 'Dependencies (type to search, space to toggle, enter to confirm):',
      options: result._springDependencyChoices,
      placeholder: 'Type to search...',
      required: false,
    })
  );
  delete result._springDependencyChoices;
  result.springDependencies = dependencies;
  return 'ok';
}

/**
 * Spring Boot's own answer to nodemon: spring-boot-devtools restarts the app
 * automatically once it detects recompiled classes, and (paired with
 * Gradle's `--continuous` flag — wired into the dev command in index.js)
 * gives a genuine watch-and-reload loop with nothing extra to install.
 */
async function stepSpringHotReload(result) {
  if (!isSpring(result)) return 'skip';
  if (result.springHotReload !== undefined) return 'skip';

  const springHotReload = guardCancel(
    await select({
      message: 'Hot reload (auto-restart on code changes, via DevTools)?',
      options: withBack([
        { value: true, label: 'Yes' },
        { value: false, label: 'No' },
      ]),
      initialValue: true,
    })
  );
  if (springHotReload === BACK) return 'back';
  result.springHotReload = springHotReload;
  return 'ok';
}

/**
 * A single select, not two checkboxes: ESLint and Biome (or Ruff and
 * Black+Flake8, for Python) are mutually exclusive tools, so a radio choice
 * makes that impossible to violate instead of just discouraged. Java has no
 * equivalent wired up yet — Spring Initializr projects skip this entirely.
 * Rust skips it too — `cargo fmt`/`cargo clippy` already ship with the
 * toolchain, so there's no separate tool to choose between. Flutter's
 * `flutter create` already wires up `analysis_options.yaml` + the
 * `flutter_lints` package (its own `flutter analyze`/`dart format`), so it
 * skips this the same way. Go/PHP/Ruby/.NET/Deno/Kotlin skip it too, for
 * this step — each already has its own strong built-in/idiomatic tooling
 * (gofmt+vet, Laravel Pint, RuboCop convention, `dotnet format`, `deno fmt`+
 * `deno lint`, ktlint) that a later step can wire up individually.
 */
const QUALITY_SKIPPED_RUNTIMES = ['java', 'rust', 'dart', 'go', 'php', 'ruby', 'dotnet', 'deno', 'kotlin'];

async function stepQuality(result) {
  if (QUALITY_SKIPPED_RUNTIMES.includes(result.runtime)) {
    result.quality = 'none';
    return 'skip';
  }
  if (result.quality) return 'skip';
  const quality = guardCancel(
    await autocomplete({
      message: 'Code quality tooling:',
      options: withBack(toOptions(result.runtime === 'python' ? QUALITY_OPTIONS_PYTHON : QUALITY_OPTIONS)),
      placeholder: 'Type to search...',
    })
  );
  if (quality === BACK) return 'back';
  result.quality = quality;
  return 'ok';
}

/**
 * The same "search live, never bundle" idea Spring Boot's dependency picker
 * uses, extended to Node and Python. Unlike Spring Initializr's ~150-entry
 * catalog (small enough to fetch whole and filter client-side), npm has
 * millions of packages, so this loops instead: search a term, pick from that
 * batch, repeat until the search box is left blank. PyPI retired its public
 * search API years ago, so the closest live equivalent there is checking
 * each name actually exists on PyPI before adding it. Skipped entirely for
 * Java — Spring's own dependency step already covers that ecosystem.
 */
async function stepExtraPackages(result) {
  if (result.runtime !== 'node' && result.runtime !== 'python') return 'skip';
  if (result.extraPackages !== undefined) return 'skip';

  const isPython = result.runtime === 'python';
  const wantsMore = guardCancel(
    await select({
      message: `Add extra ${isPython ? 'PyPI' : 'npm'} packages? (checked live, never bundled in this CLI)`,
      options: withBack([
        { value: false, label: 'No' },
        { value: true, label: 'Yes' },
      ]),
      initialValue: false,
    })
  );
  if (wantsMore === BACK) return 'back';

  const picked = [];
  if (wantsMore && isPython) {
    while (true) {
      const name = guardCancel(
        await text({ message: 'PyPI package name (leave blank to finish):', placeholder: 'e.g. requests' })
      );
      if (!name?.trim()) break;
      const exists = await pypiPackageExists(name.trim());
      if (!exists) {
        log.error(`"${name.trim()}" was not found on PyPI — check the spelling and try again.`);
        continue;
      }
      if (!picked.includes(name.trim())) picked.push(name.trim());
    }
  } else if (wantsMore) {
    while (true) {
      const query = guardCancel(
        await text({ message: 'Search npm packages (leave blank to finish):', placeholder: 'e.g. axios, zod, dayjs' })
      );
      if (!query?.trim()) break;

      let matches;
      try {
        matches = await searchNpmPackages(query.trim());
      } catch (err) {
        log.error(`npm search failed (${err.message}) — check your connection and try again.`);
        continue;
      }
      if (matches.length === 0) {
        log.warn(`No npm packages found for "${query.trim()}".`);
        continue;
      }

      const chosen = guardCancel(
        await multiselect({ message: `Results for "${query.trim()}":`, options: matches, required: false })
      );
      for (const name of chosen) {
        if (!picked.includes(name)) picked.push(name);
      }
    }
  }

  result.extraPackages = picked;
  return 'ok';
}

async function stepDocker(result) {
  if (result.docker !== undefined) return 'skip';
  const docker = guardCancel(
    await select({
      message: 'Add Docker support (Dockerfile + docker-compose.yml)?',
      options: withBack([
        { value: false, label: 'No' },
        { value: true, label: 'Yes' },
      ]),
      initialValue: false,
    })
  );
  if (docker === BACK) return 'back';
  result.docker = docker;
  return 'ok';
}

/**
 * Python has no npm-family equivalent (pip in a venv, unconditionally); Java
 * uses whichever build tool was already chosen above; Rust always uses
 * Cargo; Flutter's own `flutter create` resolves pub packages itself — none
 * of those four has anything left to ask here. Go/PHP/Ruby/.NET/Deno/Kotlin
 * each have exactly one real package manager for their ecosystem too (Go
 * modules, Composer, Bundler, NuGet via the dotnet CLI, Deno's own
 * import-map resolution, Gradle), so none of them has a question to ask
 * either — `result.pm` here is purely informational (used by printSummary's
 * "next steps" and nowhere else for these runtimes).
 */
async function stepPackageManager(result) {
  if (result.runtime === 'python') {
    result.pm = 'pip';
    return 'skip';
  }
  if (result.runtime === 'java') {
    result.pm = result.buildTool;
    return 'skip';
  }
  if (result.runtime === 'rust') {
    result.pm = 'cargo';
    return 'skip';
  }
  if (result.runtime === 'dart') {
    result.pm = 'flutter';
    return 'skip';
  }
  if (result.runtime === 'go') {
    result.pm = 'go';
    return 'skip';
  }
  if (result.runtime === 'php') {
    result.pm = 'composer';
    return 'skip';
  }
  if (result.runtime === 'ruby') {
    result.pm = 'bundler';
    return 'skip';
  }
  if (result.runtime === 'dotnet') {
    result.pm = 'dotnet';
    return 'skip';
  }
  if (result.runtime === 'deno') {
    result.pm = 'deno';
    return 'skip';
  }
  if (result.runtime === 'kotlin') {
    result.pm = 'gradle';
    return 'skip';
  }
  if (result.pm) return 'skip';

  // The React Native Community CLI's own `--pm` flag only understands
  // yarn/npm/bun — no pnpm — so that's the only place the choice is narrowed.
  const availableManagers = result.framework === 'react-native' ? PACKAGE_MANAGERS.filter((pm) => pm !== 'pnpm') : PACKAGE_MANAGERS;

  const pm = guardCancel(
    await autocomplete({
      message: 'Install dependencies with:',
      options: withBack(availableManagers.map((name) => ({ value: name, label: name }))),
      initialValue: availableManagers.includes(detectPackageManager()) ? detectPackageManager() : availableManagers[0],
      placeholder: 'Type to search...',
    })
  );
  if (pm === BACK) return 'back';
  result.pm = pm;
  return 'ok';
}

/**
 * Maven/Gradle's own wrapper resolves dependencies itself on first build, so
 * does Cargo on first `cargo run`, and `flutter create` already runs
 * `flutter pub get` as part of scaffolding — none of the three has a
 * separate "install" step to offer. Go and .NET resolve the same lazy way
 * (`go build`/`dotnet build`); Deno resolves and caches its JSR/npm imports
 * on first run; Kotlin/Ktor's hand-written Gradle project resolves the same
 * way Java's does. Laravel and Rails are different: `composer
 * create-project`/`rails new` always install as part of scaffolding itself
 * (same as Tauri/Electron already do) — forcing this off here just means
 * "don't ask a question whose answer the tool ignores anyway"; their own
 * handlers push a warning if the user's real preference was actually "no".
 */
const NO_LIVE_INSTALL_STEP_RUNTIMES = ['java', 'rust', 'dart', 'go', 'php', 'ruby', 'dotnet', 'deno', 'kotlin'];

async function stepInstall(result) {
  // Wails shares runtime 'go' with the Gin/Fiber/Echo backends above (the
  // blanket skip this list gives them), but unlike a plain Go backend it
  // also has a genuine npm-installable frontend/ that nothing resolves
  // automatically the way `go build`/`cargo run` do — so it still gets
  // asked, the same as any Node-family framework would.
  // Neutralino ships no package.json at all (see desktop-neutralino.js) —
  // `neu create` already resolved everything (runtime binaries, client
  // library) as part of scaffolding, so there's nothing to ask about here
  // either, the same "nothing separate to resolve" story every runtime in
  // the list below already tells.
  if ((NO_LIVE_INSTALL_STEP_RUNTIMES.includes(result.runtime) && result.framework !== 'wails') || result.framework === 'neutralino') {
    result.install = false;
    return 'skip';
  }
  if (result.install !== undefined) return 'skip';
  const install = guardCancel(
    await select({
      message: 'Install dependencies now?',
      options: withBack([
        { value: true, label: 'Yes' },
        { value: false, label: 'No' },
      ]),
      initialValue: true,
    })
  );
  if (install === BACK) return 'back';
  result.install = install;
  return 'ok';
}

const STEPS = [
  stepProjectName,
  stepPackageName,
  stepProjectType,
  stepFramework,
  stepToolchainPreflight,
  stepLanguage,
  stepStyling,
  stepUiKit,
  stepStateManagement,
  stepApiLayer,
  stepDatabase,
  stepAuth,
  stepTesting,
  stepHotReload,
  stepMlLibraries,
  stepSpringBuildTool,
  stepSpringPackaging,
  stepSpringJavaVersion,
  stepSpringDependencies,
  stepSpringHotReload,
  stepQuality,
  stepExtraPackages,
  stepDocker,
  stepPackageManager,
  stepInstall,
];

/**
 * Runs the interactive decision tree. Any value already supplied via CLI
 * flags (in `preset`) is used as-is and its corresponding question is
 * skipped — including questions later steps make irrelevant (e.g. styling
 * for a backend project is never asked, preset or not).
 *
 * Every question also offers a "← Back" choice, so a wrong pick doesn't mean
 * restarting the whole wizard: a stack of snapshots (one per step that was
 * actually asked) lets "← Back" rewind to the previous question, re-ask it,
 * and — since later fields simply didn't exist yet in that snapshot — pick
 * back up from there with everything downstream recomputed fresh.
 */
export async function getProjectOptions(preset = {}, { interactive = true } = {}) {
  const result = { ...preset };
  const history = [];
  let i = 0;

  while (i < STEPS.length) {
    const snapshotBefore = { ...result };
    const outcome = await STEPS[i](result, { interactive });

    if (outcome === 'back') {
      const prev = history.pop();
      if (!prev) continue; // nothing earlier was actually asked — nowhere to go, re-show this step
      for (const key of Object.keys(result)) delete result[key];
      Object.assign(result, prev.snapshot);
      i = prev.index;
      continue;
    }

    if (outcome === 'ok') {
      history.push({ index: i, snapshot: snapshotBefore });
    }
    i += 1;
  }

  return result;
}
