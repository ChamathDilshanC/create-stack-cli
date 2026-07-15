import fs from 'fs-extra';
import path from 'node:path';
import pc from 'picocolors';

/**
 * Thrown when the user cancels an interactive prompt (e.g. Ctrl+C).
 * Caught in one place (src/index.js) so every call site can just throw it.
 */
export class CancelledError extends Error {
  constructor(message = 'Operation cancelled.') {
    super(message);
    this.name = 'CancelledError';
  }
}

export const logger = {
  info: (msg) => console.log(pc.cyan(msg)),
  success: (msg) => console.log(pc.green(msg)),
  warn: (msg) => console.log(pc.yellow(msg)),
  error: (msg) => console.log(pc.red(msg)),
  title: (msg) => console.log(pc.bold(pc.magenta(msg))),
  dim: (msg) => console.log(pc.dim(msg)),
};

/** Strips trailing slashes so path.basename() behaves consistently. */
export function formatTargetDir(targetDir) {
  return targetDir?.trim().replace(/\/+$/g, '');
}

/** npm package-name rules: lowercase, no leading dot/underscore, safe URL chars only. */
export function isValidPackageName(projectName) {
  return /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(
    projectName
  );
}

/** Best-effort conversion of an arbitrary folder name into a valid package name. */
export function toValidPackageName(projectName) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z0-9-~]+/g, '-');
}

/** True if the directory doesn't exist, or exists but is empty. */
export function isDirEmpty(dir) {
  if (!fs.existsSync(dir)) return true;
  const files = fs.readdirSync(dir);
  return files.length === 0 || (files.length === 1 && files[0] === '.git');
}

/** Removes everything in a directory except a top-level .git folder. */
export function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    if (file === '.git') continue;
    fs.removeSync(path.join(dir, file));
  }
}

/**
 * Reads the package manager (and version) that invoked this CLI, e.g. via
 * `npm create stack@latest` or `pnpm create stack`. Falls back to npm.
 */
export function pkgInfoFromUserAgent(userAgent = process.env.npm_config_user_agent) {
  if (!userAgent) return undefined;
  const pkgSpec = userAgent.split(' ')[0];
  const pkgSpecArr = pkgSpec.split('/');
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  };
}

export function detectPackageManager() {
  return pkgInfoFromUserAgent()?.name ?? 'npm';
}
