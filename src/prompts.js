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
export const supportsDatabase = (projectType) =>
  projectType === 'backend' || projectType === 'fullstack';

function onCancel() {
  throw new CancelledError('Scaffold cancelled.');
}

/**
 * Runs the interactive decision tree. Any value already supplied via CLI
 * flags (in `preset`) is used as-is and its corresponding question is
 * skipped — including questions later steps make irrelevant (e.g. styling
 * for a backend project is never asked, preset or not).
 */
export async function getProjectOptions(preset = {}) {
  const result = { ...preset };

  // 1. Project name / target directory.
  if (!result.projectName) {
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
  }

  const targetDir = formatTargetDir(result.projectName);
  const packageName = path.basename(path.resolve(targetDir));

  if (!isValidPackageName(packageName)) {
    const { overwritePackageName } = await prompts(
      {
        type: 'text',
        name: 'overwritePackageName',
        message: 'Package name:',
        initial: toValidPackageName(packageName),
        validate: (name) => isValidPackageName(name) || 'Invalid package.json name.',
      },
      { onCancel }
    );
    result.packageName = overwritePackageName;
  } else {
    result.packageName = packageName;
  }

  // 2. Project type (Q1).
  if (!result.projectType) {
    const { projectType } = await prompts(
      {
        type: 'select',
        name: 'projectType',
        message: 'What are you building?',
        choices: PROJECT_TYPES.map((t) => ({ title: t.color(t.title), value: t.value })),
      },
      { onCancel }
    );
    result.projectType = projectType;
  }

  const frameworkChoices = FRAMEWORKS[result.projectType];
  if (!frameworkChoices) {
    throw new Error(`Unknown project type: ${result.projectType}`);
  }

  // 3. Framework (Q2) — skipped when the category only has one option (Mobile).
  if (!result.framework) {
    if (frameworkChoices.length === 1) {
      result.framework = frameworkChoices[0].value;
    } else {
      const { framework } = await prompts(
        {
          type: 'select',
          name: 'framework',
          message: 'Select a framework:',
          choices: frameworkChoices.map((f) => ({ title: f.title, value: f.value })),
        },
        { onCancel }
      );
      result.framework = framework;
    }
  }

  const frameworkDef = frameworkChoices.find((f) => f.value === result.framework);
  if (!frameworkDef) {
    throw new Error(`Unknown framework "${result.framework}" for project type "${result.projectType}".`);
  }
  result.scaffolder = frameworkDef.scaffolder;
  result.viteTemplate = frameworkDef.viteTemplate;
  // Everything else in this CLI assumes Node (npm-family package manager,
  // ESLint/Biome, package.json) unless a module explicitly checks this.
  result.runtime = frameworkDef.runtime ?? 'node';

  // 4. Language (Q3) — hidden entirely when the framework forces one (Angular, NestJS).
  if (frameworkDef.forceLanguage) {
    result.language = frameworkDef.forceLanguage;
  } else if (!result.language) {
    const { language } = await prompts(
      {
        type: 'select',
        name: 'language',
        message: 'Language:',
        choices: [
          { title: 'TypeScript', value: 'ts' },
          { title: 'JavaScript', value: 'js' },
        ],
        initial: 0,
      },
      { onCancel }
    );
    result.language = language;
  }

  // 5. Styling (Q4) — only where there's UI to style.
  if (supportsStyling(result.projectType)) {
    if (!result.styling) {
      const { styling } = await prompts(
        {
          type: 'select',
          name: 'styling',
          message: 'Styling:',
          choices: STYLING_OPTIONS,
        },
        { onCancel }
      );
      result.styling = styling;
    }
  } else {
    result.styling = 'none';
  }

  // 6. Database / ORM (Q5) — only where there's a server to run it in.
  // Django always ships its own ORM, so this is forced/skipped for it, the
  // same way Angular/NestJS force a language above.
  if (frameworkDef.forceDatabase) {
    result.database = frameworkDef.forceDatabase;
  } else if (supportsDatabase(result.projectType)) {
    if (!result.database) {
      const { database } = await prompts(
        {
          type: 'select',
          name: 'database',
          message: 'Database / ORM:',
          choices: result.runtime === 'python' ? DATABASE_OPTIONS_PYTHON : DATABASE_OPTIONS,
        },
        { onCancel }
      );
      result.database = database;
    }
  } else {
    result.database = 'none';
  }

  // 7. Code quality (Q6a) — a single select, not two checkboxes: ESLint and
  // Biome (or Ruff and Black+Flake8, for Python) are mutually exclusive
  // tools, so a radio choice makes that impossible to violate instead of
  // just discouraged.
  if (!result.quality) {
    const { quality } = await prompts(
      {
        type: 'select',
        name: 'quality',
        message: 'Code quality tooling:',
        choices: result.runtime === 'python' ? QUALITY_OPTIONS_PYTHON : QUALITY_OPTIONS,
      },
      { onCancel }
    );
    result.quality = quality;
  }

  // 8. Docker (Q6b).
  if (result.docker === undefined) {
    const { docker } = await prompts(
      {
        type: 'confirm',
        name: 'docker',
        message: 'Add Docker support (Dockerfile + docker-compose.yml)?',
        initial: false,
      },
      { onCancel }
    );
    result.docker = docker;
  }

  // 9. Package manager — Python has no npm-family equivalent; pip inside a
  // venv is used unconditionally, so there's nothing to ask.
  if (result.runtime === 'python') {
    result.pm = 'pip';
  } else if (!result.pm) {
    const { pm } = await prompts(
      {
        type: 'select',
        name: 'pm',
        message: 'Install dependencies with:',
        choices: PACKAGE_MANAGERS.map((name) => ({ title: name, value: name })),
        initial: PACKAGE_MANAGERS.indexOf(detectPackageManager()),
      },
      { onCancel }
    );
    result.pm = pm;
  }

  // 10. Auto-install confirmation.
  if (result.install === undefined) {
    const { install } = await prompts(
      {
        type: 'confirm',
        name: 'install',
        message: 'Install dependencies now?',
        initial: true,
      },
      { onCancel }
    );
    result.install = install;
  }

  return result;
}
