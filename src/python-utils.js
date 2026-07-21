import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';

import { commandOutputTail, createSpinner, logger, spinnerFail, spinnerSucceed } from './utils.js';

/**
 * Windows only reliably has a bare `python` on PATH — its `python3` is
 * frequently just the Microsoft Store app-execution-alias stub, which
 * errors out unless Python itself came from the Store. Everywhere else,
 * `python3` is the safer bet (`python` may not exist, or may be Python 2
 * on old systems). Cached per-process since this only needs to run once.
 */
let cachedPythonCommand;
export async function findPythonCommand() {
  if (cachedPythonCommand) return cachedPythonCommand;

  const candidates = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  for (const candidate of candidates) {
    try {
      await execa(candidate, ['--version']);
      cachedPythonCommand = candidate;
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    'Could not find a working Python interpreter (tried: ' +
      candidates.join(', ') +
      '). Install Python 3 and make sure it is on your PATH: https://www.python.org/downloads/'
  );
}

/** The venv's own python/pip, which is what everything after creation should invoke — never the outer system interpreter. */
export function venvBinPath(targetDir, executable) {
  const bin = process.platform === 'win32' ? 'Scripts' : 'bin';
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return path.join(targetDir, '.venv', bin, `${executable}${suffix}`);
}

/** Creates a .venv inside targetDir using the system Python. Returns false (and warns) if Python isn't available or venv creation fails. */
export async function createVenv(targetDir, warnings) {
  const spinner = createSpinner('Creating Python virtual environment...', { indent: 2 });
  try {
    const pythonCmd = await findPythonCommand();
    await execa(pythonCmd, ['-m', 'venv', '.venv'], { cwd: targetDir, stdin: 'ignore' });
    spinnerSucceed(spinner, 'Virtual environment created (.venv).');
    return true;
  } catch (err) {
    spinnerFail(spinner, 'Virtual environment could not be created.');
    const tail = commandOutputTail(err);
    if (tail) logger.dim(tail);
    warnings.push(
      `Could not create .venv (${err.message}) — create one yourself (\`python -m venv .venv\`) and run \`pip install -r requirements.txt\`.`
    );
    return false;
  }
}

/**
 * Installs `packages` into the project's .venv when allowed on the network;
 * otherwise (or on failure) just appends them to requirements.txt so the
 * user's own `pip install -r requirements.txt` picks them up. Mirrors
 * scaffold-utils.js's installOrRecord, but for pip instead of npm-family.
 */
export async function pipInstallOrRecord({ options, warnings, packages, label, venvReady }) {
  const { targetDir, install } = options;

  if (install && venvReady) {
    const pip = venvBinPath(targetDir, 'pip');
    const spinner = createSpinner(`Installing ${label}...`, { indent: 2 });
    try {
      await execa(pip, ['install', ...packages], { cwd: targetDir, stdin: 'ignore' });
      spinnerSucceed(spinner, `${label} installed.`);
      await appendRequirements(targetDir, packages);
      return;
    } catch (err) {
      spinnerFail(spinner, `${label} could not be installed.`);
      const tail = commandOutputTail(err);
      if (tail) logger.dim(tail);
      warnings.push(`${label} were added to requirements.txt but not installed — run "pip install -r requirements.txt" inside the venv to finish setup.`);
    }
  }

  await appendRequirements(targetDir, packages);
}

/**
 * Final safety-net pass, mirroring install.js's installDependencies: every
 * pipInstallOrRecord call already installs into .venv as it goes, so this
 * mainly catches anything that fell back to requirements.txt-only during
 * scaffolding (a transient failure, an offline step) now that scaffolding
 * has finished. Returns true only if it actually ran successfully.
 */
export async function installPythonDependencies(targetDir, warnings) {
  const venvExists = await fs.pathExists(path.join(targetDir, '.venv'));
  if (!venvExists) {
    warnings.push('No .venv found — create one (`python -m venv .venv`) and run `pip install -r requirements.txt`.');
    return false;
  }

  const pip = venvBinPath(targetDir, 'pip');
  const spinner = createSpinner('Installing Python dependencies...');
  try {
    await execa(pip, ['install', '-r', 'requirements.txt'], { cwd: targetDir, stdin: 'ignore' });
    spinnerSucceed(spinner, 'Python dependencies installed.');
    return true;
  } catch (err) {
    spinnerFail(spinner, 'Failed to install Python dependencies.');
    const tail = commandOutputTail(err);
    if (tail) logger.dim(tail);
    warnings.push('Run `pip install -r requirements.txt` inside the venv once you\'re back online.');
    return false;
  }
}

/** Adds `packages` (e.g. ["django==5.1", "djangorestframework"]) to requirements.txt without duplicating an existing entry for the same package name. */
export async function appendRequirements(targetDir, packages) {
  const reqPath = path.join(targetDir, 'requirements.txt');
  const existing = (await fs.pathExists(reqPath)) ? await fs.readFile(reqPath, 'utf8') : '';
  const existingNames = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.split(/[=<>~! ]/)[0].trim())
      .filter(Boolean)
  );

  const additions = packages.filter((pkg) => !existingNames.has(pkg.split(/[=<>~!]/)[0].trim()));
  if (additions.length === 0) return;

  const body = existing
    ? `${existing}${existing.endsWith('\n') ? '' : '\n'}${additions.join('\n')}`
    : additions.join('\n');
  await fs.writeFile(reqPath, `${body}\n`);
}
