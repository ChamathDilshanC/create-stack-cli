import { execa } from 'execa';
import pc from 'picocolors';

import { commandOutputTail, createSpinner, logger, spinnerFail, spinnerSucceed } from './utils.js';

const SUPPORTED = new Set(['npm', 'yarn', 'pnpm', 'bun']);

/**
 * Runs `<pm> install` inside targetDir behind a spinner.
 *
 * A failed install (offline, registry hiccup, proxy...) is not fatal: the
 * project on disk is already complete, so we report what happened, tell the
 * user how to finish, and let the CLI end with a proper summary instead of a
 * stack trace. Returns true when dependencies were actually installed.
 */
export async function installDependencies(targetDir, pm) {
  if (!SUPPORTED.has(pm)) {
    throw new Error(`Unsupported package manager: ${pm}`);
  }

  const spinner = createSpinner(`Installing dependencies with ${pm}...`);
  try {
    await execa(pm, ['install'], { cwd: targetDir, stdin: 'ignore' });
    spinnerSucceed(spinner, 'Dependencies installed.');
    return true;
  } catch (err) {
    spinnerFail(spinner, `Failed to install dependencies with ${pm}.`);
    const tail = commandOutputTail(err);
    if (tail) logger.dim(tail);
    logger.warn(
      `Your project was still created — run ${pc.bold(`${pm} install`)} inside it once you're back online.`
    );
    return false;
  }
}
