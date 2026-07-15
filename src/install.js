import { execa } from 'execa';
import ora from 'ora';

const INSTALL_ARGS = {
  npm: ['install'],
  yarn: ['install'],
  pnpm: ['install'],
  bun: ['install'],
};

/** Runs `<pm> install` inside targetDir, showing a spinner for the duration. */
export async function installDependencies(targetDir, pm) {
  const args = INSTALL_ARGS[pm];
  if (!args) {
    throw new Error(`Unsupported package manager: ${pm}`);
  }

  const spinner = ora(`Installing dependencies with ${pm}...`).start();
  try {
    await execa(pm, args, { cwd: targetDir });
    spinner.succeed('Dependencies installed.');
  } catch (err) {
    spinner.fail(`Failed to install dependencies with ${pm}.`);
    throw err;
  }
}
