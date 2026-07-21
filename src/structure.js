import path from 'node:path';
import fs from 'fs-extra';

import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

/** Frontend / Mobile / Desktop layout — generated under `<baseDir>/`. */
export const FRONTEND_DIRECTORIES = [
  'assets',
  'components',
  'config',
  'features',
  'hooks',
  'layouts',
  'pages',
  'services',
  'store',
  'utils',
];

/** Flutter's own layout, generated under `lib/` — Dart-flavored naming (`screens`/`widgets`, not React's `pages`/`hooks`), since `flutter create` itself only ever produces a bare `lib/main.dart`. */
export const FLUTTER_DIRECTORIES = ['config', 'models', 'screens', 'services', 'utils', 'widgets'];

/** Backend layout — `models` becomes `schema` when Drizzle is the chosen ORM. */
const BACKEND_DIRECTORIES_BASE = ['config', 'controllers', 'middlewares', 'routes', 'services', 'utils'];

function backendDirectories(database) {
  return [...BACKEND_DIRECTORIES_BASE, modelsDirName(database)];
}

function modelsDirName(database) {
  return database === 'drizzle' ? 'schema' : 'models';
}

/** Relative path (from targetDir) of the models/schema folder — database.js writes its files there. */
export function modelsDirFor(options, baseDir = 'src') {
  return path.join(baseDir, modelsDirName(options.database));
}

/**
 * Creates the context-aware enterprise layout and drops a .gitkeep in every
 * directory — Git doesn't track empty directories, so without one these
 * would silently vanish for anyone who clones the project fresh.
 *
 * Non-fatal: `fs.mkdirSync(..., { recursive: true })` is already idempotent
 * (no throw if a directory exists), but a real failure — a file occupying
 * one of these path segments, a permissions error — is reported as a
 * warning rather than unwinding a scaffold that has otherwise succeeded.
 */
export async function generateEnterpriseStructure(
  options,
  warnings,
  { baseDir = 'src', exclude = [], directories: directoriesOverride } = {}
) {
  const spinner = createSpinner('Generating enterprise folder structure...');
  const rootDir = path.join(options.targetDir, baseDir);
  const allDirectories =
    directoriesOverride ?? (options.projectType === 'backend' ? backendDirectories(options.database) : FRONTEND_DIRECTORIES);
  const directories = allDirectories.filter((dir) => !exclude.includes(dir));

  try {
    for (const rel of directories) {
      const dirPath = path.join(rootDir, rel);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, '.gitkeep'), '');
    }
    spinnerSucceed(spinner, `Enterprise folder structure generated (${directories.length} directories).`);
  } catch (err) {
    spinnerFail(spinner, 'Enterprise folder structure could not be fully generated.');
    warnings.push(`Some folders may be missing — ${err.message}. You can create them manually if needed.`);
  }
}
