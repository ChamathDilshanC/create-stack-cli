import path from 'node:path';
import prompts from 'prompts';
import pc from 'picocolors';
import {
  CancelledError,
  detectPackageManager,
  formatTargetDir,
  isValidPackageName,
  toValidPackageName,
} from './utils.js';

/**
 * The full decision tree: project type -> framework -> scaffolder metadata.
 * `scaffolder` is the id scaffold.js dispatches on; `viteTemplate` is only
 * present for frameworks create-vite itself supports; `forceLanguage` skips
 * Q3 entirely for frameworks that only ship a TypeScript template.
 */
export const PROJECT_TYPES = [
  { value: 'frontend', title: 'Frontend', color: pc.cyan },
  { value: 'fullstack', title: 'Fullstack', color: pc.magenta },
  { value: 'backend', title: 'Backend', color: pc.green },
  { value: 'desktop', title: 'Desktop', color: pc.yellow },
  { value: 'mobile', title: 'Mobile', color: pc.red },
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
  ],
  desktop: [
    { value: 'electron', title: 'Electron', scaffolder: 'electron' },
    { value: 'tauri', title: 'Tauri', scaffolder: 'tauri' },
  ],
  mobile: [{ value: 'expo', title: 'Expo (React Native)', scaffolder: 'expo' }],
};

export const STYLING_OPTIONS = [
  { value: 'tailwind', title: 'Tailwind CSS (v4)' },
  { value: 'unocss', title: 'UnoCSS' },
  { value: 'css-modules', title: 'CSS Modules' },
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

/** Styling only makes sense where there's UI to style. */
export const supportsStyling = (projectType) =>
  projectType === 'frontend' || projectType === 'fullstack' || projectType === 'desktop';

/** A database/ORM only makes sense where there's a server to run it in. */
export const supportsDatabase = (projectType) => projectType === 'backend' || projectType === 'fullstack';

function onCancel() {
  throw new CancelledError('Scaffold cancelled.');
}

/** Sentinel a select-style step resolves to when the user picks "← Back" instead of answering. */
const BACK = Symbol('back');

/** Appends a "← Back" choice to a list of select choices. Always last, so existing `initial` indexes stay valid. */
function withBack(choices) {
  return [...choices, { title: pc.dim('← Back'), value: BACK }];
}

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
  const { projectName } = await prompts(
    {
      type: 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'my-app',
      onState: (state) => {
        state.value = formatTargetDir(state.value) || 'my-app';
      },
    },
    { onCancel }
  );
  result.projectName = projectName;
  return 'ok';
}

async function stepPackageName(result) {
  const targetDir = formatTargetDir(result.projectName);
  const computedPackageName = path.basename(path.resolve(targetDir));

  if (isValidPackageName(computedPackageName)) {
    result.packageName = computedPackageName;
    return 'skip';
  }

  const { overwritePackageName } = await prompts(
    {
      type: 'text',
      name: 'overwritePackageName',
      message: 'Package name:',
      initial: toValidPackageName(computedPackageName),
      validate: (name) => isValidPackageName(name) || 'Invalid package.json name.',
    },
    { onCancel }
  );
  result.packageName = overwritePackageName;
  return 'ok';
}

async function stepProjectType(result) {
  if (result.projectType) return 'skip';
  const { projectType } = await prompts(
    {
      type: 'select',
      name: 'projectType',
      message: 'What are you building?',
      choices: withBack(PROJECT_TYPES.map((t) => ({ title: t.color(t.title), value: t.value }))),
    },
    { onCancel }
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
      const { framework } = await prompts(
        {
          type: 'select',
          name: 'framework',
          message: 'Select a framework:',
          choices: withBack(frameworkChoices.map((f) => ({ title: f.title, value: f.value }))),
        },
        { onCancel }
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

/** Hidden entirely when the framework forces one (Angular, NestJS, every Python framework). */
async function stepLanguage(result) {
  const frameworkDef = getFrameworkDef(result);
  if (frameworkDef.forceLanguage) {
    result.language = frameworkDef.forceLanguage;
    return 'skip';
  }
  if (result.language) return 'skip';

  const { language } = await prompts(
    {
      type: 'select',
      name: 'language',
      message: 'Language:',
      choices: withBack([
        { title: 'TypeScript', value: 'ts' },
        { title: 'JavaScript', value: 'js' },
      ]),
      initial: 0,
    },
    { onCancel }
  );
  if (language === BACK) return 'back';
  result.language = language;
  return 'ok';
}

/** Only where there's UI to style. */
async function stepStyling(result) {
  if (!supportsStyling(result.projectType)) {
    result.styling = 'none';
    return 'skip';
  }
  if (result.styling) return 'skip';

  const { styling } = await prompts(
    {
      type: 'select',
      name: 'styling',
      message: 'Styling:',
      choices: withBack(STYLING_OPTIONS),
    },
    { onCancel }
  );
  if (styling === BACK) return 'back';
  result.styling = styling;
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

  const { database } = await prompts(
    {
      type: 'select',
      name: 'database',
      message: 'Database / ORM:',
      choices: withBack(result.runtime === 'python' ? DATABASE_OPTIONS_PYTHON : DATABASE_OPTIONS),
    },
    { onCancel }
  );
  if (database === BACK) return 'back';
  result.database = database;
  return 'ok';
}

/**
 * A single select, not two checkboxes: ESLint and Biome (or Ruff and
 * Black+Flake8, for Python) are mutually exclusive tools, so a radio choice
 * makes that impossible to violate instead of just discouraged.
 */
async function stepQuality(result) {
  if (result.quality) return 'skip';
  const { quality } = await prompts(
    {
      type: 'select',
      name: 'quality',
      message: 'Code quality tooling:',
      choices: withBack(result.runtime === 'python' ? QUALITY_OPTIONS_PYTHON : QUALITY_OPTIONS),
    },
    { onCancel }
  );
  if (quality === BACK) return 'back';
  result.quality = quality;
  return 'ok';
}

async function stepDocker(result) {
  if (result.docker !== undefined) return 'skip';
  const { docker } = await prompts(
    {
      type: 'select',
      name: 'docker',
      message: 'Add Docker support (Dockerfile + docker-compose.yml)?',
      choices: withBack([
        { title: 'No', value: false },
        { title: 'Yes', value: true },
      ]),
      initial: 0,
    },
    { onCancel }
  );
  if (docker === BACK) return 'back';
  result.docker = docker;
  return 'ok';
}

/** Python has no npm-family equivalent; pip inside a venv is used unconditionally, so there's nothing to ask. */
async function stepPackageManager(result) {
  if (result.runtime === 'python') {
    result.pm = 'pip';
    return 'skip';
  }
  if (result.pm) return 'skip';

  const { pm } = await prompts(
    {
      type: 'select',
      name: 'pm',
      message: 'Install dependencies with:',
      choices: withBack(PACKAGE_MANAGERS.map((name) => ({ title: name, value: name }))),
      initial: PACKAGE_MANAGERS.indexOf(detectPackageManager()),
    },
    { onCancel }
  );
  if (pm === BACK) return 'back';
  result.pm = pm;
  return 'ok';
}

async function stepInstall(result) {
  if (result.install !== undefined) return 'skip';
  const { install } = await prompts(
    {
      type: 'select',
      name: 'install',
      message: 'Install dependencies now?',
      choices: withBack([
        { title: 'Yes', value: true },
        { title: 'No', value: false },
      ]),
      initial: 0,
    },
    { onCancel }
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
  stepLanguage,
  stepStyling,
  stepDatabase,
  stepQuality,
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
export async function getProjectOptions(preset = {}) {
  const result = { ...preset };
  const history = [];
  let i = 0;

  while (i < STEPS.length) {
    const snapshotBefore = { ...result };
    const outcome = await STEPS[i](result);

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
