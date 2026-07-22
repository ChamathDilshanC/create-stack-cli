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

/** Plain Rust binaries don't read .env files natively either — these still get written for consistency, same as Angular/Java above. */
const RUST_NOTE =
  '# Plain Rust binaries do not read .env files natively — add the `dotenvy`\n' +
  '# crate and call dotenvy::dotenv().ok() at the start of main() to load these.\n';

/** Bare React Native (unlike Expo, which reads EXPO_PUBLIC_-prefixed vars natively) has no built-in .env support — these still get written for consistency, same as Angular/Java/Rust above. */
const REACT_NATIVE_NOTE =
  '# React Native does not read .env files natively — install react-native-dotenv\n' +
  '# (a Babel plugin) or react-native-config to consume these.\n';

/** Flutter reads compile-time values via --dart-define, not .env files — these still get written for consistency, same as the notes above. */
const FLUTTER_NOTE =
  '# Flutter does not read .env files natively — add the flutter_dotenv package\n' +
  '# and call dotenv.load() in main(), or pass values via --dart-define instead.\n';

/** Plain Go binaries don't read .env files natively either — these still get written for consistency, same as the notes above. Laravel (PHP) is the one new backend that needs no such note — it reads .env natively already. */
const GO_NOTE =
  '# Plain Go binaries do not read .env files natively — add a package like\n' +
  '# github.com/joho/godotenv and call godotenv.Load() at the start of main()\n' +
  '# to load these, or export them into the environment yourself.\n';

/** Rails reads credentials/config differently from plain .env — these still get written for consistency, same as the notes above. */
const RUBY_NOTE =
  '# Rails does not read .env files natively without the dotenv-rails gem —\n' +
  '# add it to your Gemfile (group :development, :test) to load these, or\n' +
  '# export them into the environment yourself for production.\n';

/** ASP.NET Core reads appsettings.json + real environment variables, not .env files — these still get written for consistency, same as the notes above. */
const DOTNET_NOTE =
  '# ASP.NET Core does not read .env files natively — these map to real\n' +
  '# configuration keys (e.g. ASPNETCORE_ENVIRONMENT) if you export them into\n' +
  '# the environment yourself, or add a package like DotNetEnv.\n';

/** Deno needs an explicit flag (or a std module) to read .env files — these still get written for consistency, same as the notes above. */
const DENO_NOTE =
  '# Deno does not load .env files automatically — pass --env-file=.env to\n' +
  '# "deno run"/"deno task" (Deno 1.42+), or use the std @std/dotenv module.\n';

/** Ktor reads its own application.conf, not .env files — these still get written for consistency, same as the notes above. */
const KOTLIN_NOTE =
  '# Ktor reads its own application.conf, not .env files — export these into\n' +
  '# the environment yourself, or add a library like cdimascio/java-dotenv.\n';

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
  if (projectType === 'backend' && runtime === 'rust') {
    return { PORT: '3000', RUST_LOG: 'debug' };
  }
  if (projectType === 'backend' && runtime === 'go') {
    return { PORT: '8080', APP_ENV: 'development' };
  }
  if (projectType === 'backend' && runtime === 'php') {
    return { PORT: '8000', APP_ENV: 'development' };
  }
  if (projectType === 'backend' && runtime === 'ruby') {
    return { PORT: '3000', RAILS_ENV: 'development' };
  }
  if (projectType === 'backend' && runtime === 'dotnet') {
    return { PORT: '5000', ASPNETCORE_ENVIRONMENT: 'Development' };
  }
  if (projectType === 'backend' && runtime === 'deno') {
    return { PORT: '8000', DENO_ENV: 'development' };
  }
  if (projectType === 'backend' && runtime === 'kotlin') {
    return { PORT: '8080', KTOR_ENV: 'development' };
  }
  if (projectType === 'backend') {
    return { PORT: '3000', NODE_ENV: 'development' };
  }
  if (projectType === 'desktop' && framework === 'electron') {
    return { NODE_ENV: 'development' };
  }
  if (projectType === 'ai') {
    return { ENVIRONMENT: 'development' };
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
  if (projectType === 'backend' && runtime === 'rust') {
    return { PORT: '3000', RUST_LOG: 'warn' };
  }
  if (projectType === 'backend' && runtime === 'go') {
    return { PORT: '8080', APP_ENV: 'production' };
  }
  if (projectType === 'backend' && runtime === 'php') {
    return { PORT: '8000', APP_ENV: 'production' };
  }
  if (projectType === 'backend' && runtime === 'ruby') {
    return { PORT: '3000', RAILS_ENV: 'production' };
  }
  if (projectType === 'backend' && runtime === 'dotnet') {
    return { PORT: '5000', ASPNETCORE_ENVIRONMENT: 'Production' };
  }
  if (projectType === 'backend' && runtime === 'deno') {
    return { PORT: '8000', DENO_ENV: 'production' };
  }
  if (projectType === 'backend' && runtime === 'kotlin') {
    return { PORT: '8080', KTOR_ENV: 'production' };
  }
  if (projectType === 'backend') {
    return { PORT: '3000', NODE_ENV: 'production' };
  }
  if (projectType === 'desktop' && framework === 'electron') {
    return { NODE_ENV: 'production' };
  }
  if (projectType === 'ai') {
    return { ENVIRONMENT: 'production' };
  }

  const prefix = PUBLIC_PREFIX[framework] ?? '';
  return { [`${prefix}API_URL`]: 'https://api.example.com' };
}

/** Framework-specific notes take priority over the runtime-level ones below (Angular/React Native are both `runtime: 'node'`, so they'd otherwise fall through to no note at all). */
const ENV_NOTE_BY_FRAMEWORK = {
  angular: ANGULAR_NOTE,
  'react-native': REACT_NATIVE_NOTE,
};

/** Laravel (PHP) is the one new backend that needs no entry here — it reads .env natively already, unlike the rest. */
const ENV_NOTE_BY_RUNTIME = {
  java: JAVA_NOTE,
  rust: RUST_NOTE,
  dart: FLUTTER_NOTE,
  go: GO_NOTE,
  ruby: RUBY_NOTE,
  dotnet: DOTNET_NOTE,
  deno: DENO_NOTE,
  kotlin: KOTLIN_NOTE,
};

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
    const header = ENV_NOTE_BY_FRAMEWORK[framework] ?? ENV_NOTE_BY_RUNTIME[runtime] ?? '';

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
