import path from 'node:path';
import fs from 'fs-extra';

import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

/**
 * Client-exposed env vars must be prefixed a specific way per bundler/
 * framework, or the build tool strips them out entirely (Vite/Next/
 * SvelteKit/Astro/Expo all silently drop unprefixed vars from client code —
 * this isn't a convention, it's how each of them decides what's safe to
 * ship to the browser).
 */
const PUBLIC_PREFIX = {
  react: 'VITE_',
  vue: 'VITE_',
  svelte: 'VITE_',
  solid: 'VITE_',
  tauri: 'VITE_',
  next: 'NEXT_PUBLIC_',
  nuxt: 'NUXT_PUBLIC_',
  sveltekit: 'PUBLIC_',
  astro: 'PUBLIC_',
  expo: 'EXPO_PUBLIC_',
};

/** Angular has no built-in .env mechanism — these files still get written for consistency, with a note on what's needed to actually read them. */
const ANGULAR_NOTE =
  '# Angular does not read .env files natively — install @ngx-env/builder\n' +
  '# (or wire process.env into angular.json yourself) to consume these.\n';

/** Spring Boot reads application.properties/application.yml, not .env — these still get written for consistency, same as Angular above. */
const JAVA_NOTE =
  '# Spring Boot does not read .env files natively — these map to real Spring\n' +
  '# properties (SERVER_PORT, SPRING_PROFILES_ACTIVE) if you export them into\n' +
  '# the environment yourself, or add a library like spring-dotenv.\n';

/** Each Python backend's own default dev port — Django/FastAPI both default to 8000, Flask to 5000. */
const PYTHON_PORT = { django: '8000', flask: '5000', fastapi: '8000' };

function baseVars(options) {
  const { projectType, framework, packageName, runtime } = options;

  if (projectType === 'backend' && runtime === 'python') {
    return { PORT: PYTHON_PORT[framework] ?? '8000', ENVIRONMENT: 'development' };
  }
  if (projectType === 'backend' && runtime === 'java') {
    return { SERVER_PORT: '8080', SPRING_PROFILES_ACTIVE: 'development' };
  }
  if (projectType === 'backend') {
    return { PORT: '3000', NODE_ENV: 'development' };
  }
  if (projectType === 'desktop' && framework === 'electron') {
    return { NODE_ENV: 'development' };
  }

  const prefix = PUBLIC_PREFIX[framework] ?? '';
  return {
    [`${prefix}APP_NAME`]: packageName,
    [`${prefix}API_URL`]: 'http://localhost:3000',
  };
}

function productionVars(options) {
  const { projectType, framework, runtime } = options;

  if (projectType === 'backend' && runtime === 'python') {
    return { PORT: PYTHON_PORT[framework] ?? '8000', ENVIRONMENT: 'production' };
  }
  if (projectType === 'backend' && runtime === 'java') {
    return { SERVER_PORT: '8080', SPRING_PROFILES_ACTIVE: 'production' };
  }
  if (projectType === 'backend') {
    return { PORT: '3000', NODE_ENV: 'production' };
  }
  if (projectType === 'desktop' && framework === 'electron') {
    return { NODE_ENV: 'production' };
  }

  const prefix = PUBLIC_PREFIX[framework] ?? '';
  return { [`${prefix}API_URL`]: 'https://api.example.com' };
}

function serialize(vars) {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

/** Adds `vars` to an existing env file's content without touching lines already there (or overwriting a value someone already set). */
async function mergeEnvFile(filePath, vars, { header = '' } = {}) {
  const existing = (await fs.pathExists(filePath)) ? await fs.readFile(filePath, 'utf8') : '';
  const existingKeys = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.split('=')[0])
      .filter(Boolean)
  );

  const additions = Object.entries(vars).filter(([key]) => !existingKeys.has(key));
  if (additions.length === 0 && existing) return;

  const additionText = serialize(Object.fromEntries(additions));
  const body = existing
    ? `${existing}${existing.endsWith('\n') ? '' : '\n'}${additionText}`
    : `${header}${additionText}`;
  await fs.writeFile(filePath, `${body}\n`);
}

/**
 * Adds `vars` (development) and `prodVars` (production, defaulting to the
 * same values) to all three env files. This is what database.js uses to add
 * connection strings alongside whatever applyEnvFiles already wrote.
 */
export async function appendEnvVars(targetDir, vars, prodVars = vars) {
  await mergeEnvFile(path.join(targetDir, '.env'), vars);
  await mergeEnvFile(path.join(targetDir, '.env.local'), {});
  await mergeEnvFile(path.join(targetDir, '.env.production'), prodVars);
}

/**
 * Generates .env (safe defaults, committed), .env.local (personal secrets,
 * always gitignored), and .env.production (prod-shaped placeholders) for
 * every scaffold, regardless of project type — and makes sure .env.local
 * itself is actually gitignored, since that's the one that should never
 * end up in source control.
 */
export async function applyEnvFiles(options, warnings) {
  const spinner = createSpinner('Generating environment files...');
  try {
    const { targetDir, framework, runtime } = options;
    const header = framework === 'angular' ? ANGULAR_NOTE : runtime === 'java' ? JAVA_NOTE : '';

    await mergeEnvFile(path.join(targetDir, '.env'), baseVars(options), { header });
    await mergeEnvFile(path.join(targetDir, '.env.local'), {}, { header });
    await mergeEnvFile(path.join(targetDir, '.env.production'), productionVars(options), { header });

    const gitignorePath = path.join(targetDir, '.gitignore');
    const gitignore = (await fs.pathExists(gitignorePath)) ? await fs.readFile(gitignorePath, 'utf8') : '';
    if (!gitignore.includes('.env.local') && !gitignore.includes('.env*.local')) {
      const separator = gitignore && !gitignore.endsWith('\n') ? '\n' : '';
      await fs.writeFile(gitignorePath, `${gitignore}${separator}.env*.local\n`);
    }

    spinnerSucceed(spinner, 'Environment files generated (.env, .env.local, .env.production).');
  } catch (err) {
    spinnerFail(spinner, 'Environment file generation failed.');
    warnings.push(`Could not generate .env files: ${err.message}`);
  }
}
