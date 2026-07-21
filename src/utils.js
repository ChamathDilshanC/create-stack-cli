import fs from 'fs-extra';
import path from 'node:path';
import pc from 'picocolors';
import { cancel, isCancel, spinner as clackSpinner } from '@clack/prompts';

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

/**
 * Every clack prompt (select, text, confirm, autocompleteMultiselect...)
 * resolves to its own cancel symbol instead of throwing when the user hits
 * Ctrl+C — this is the one place that turns that symbol into the same
 * CancelledError every other cancellation path in this CLI already throws,
 * so call sites just do `guardCancel(await select({...}))` and move on.
 */
export function guardCancel(value) {
  if (isCancel(value)) {
    cancel('Scaffold cancelled.');
    throw new CancelledError('Scaffold cancelled.');
  }
  return value;
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

/**
 * Every spinner in this CLI is created through here instead of calling
 * clack's spinner() directly, so the whole run — from the first question to
 * the last file written — stays one continuous clack-rendered thread instead
 * of mixing in a different library's own spinner styling.
 */
export function createSpinner(text) {
  const spinner = clackSpinner();
  spinner.start(text);
  return spinner;
}

export function spinnerSucceed(spinner, text) {
  spinner.stop(text);
}

export function spinnerFail(spinner, text) {
  spinner.error(text);
}

/**
 * Extracts the most useful lines from a failed execa command, so errors stay
 * readable instead of dumping an entire npm log at the user.
 */
export function commandOutputTail(err, maxLines = 8) {
  const output = [err.stderr, err.stdout]
    .filter((stream) => typeof stream === 'string' && stream.trim())
    .join('\n');
  if (!output) return err.shortMessage ?? err.message ?? '';

  return output
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-maxLines)
    .join('\n');
}
