import path from 'node:path';
import { createRequire } from 'node:module';
import boxen from 'boxen';
import { Command } from 'commander';
import pc from 'picocolors';
import prompts from 'prompts';

import { printBanner } from './banner.js';
import { FRAMEWORKS, EXTRAS, PACKAGE_MANAGERS, getProjectOptions } from './prompts.js';
import { scaffoldProject } from './scaffold.js';
import { installDependencies } from './install.js';
import {
  CancelledError,
  emptyDir,
  formatTargetDir,
  isDirEmpty,
  logger,
} from './utils.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const ALL_VARIANTS = FRAMEWORKS.flatMap((f) => f.variants);
const EXTRA_VALUES = new Set(EXTRAS.map((e) => e.value));

function parseArgs() {
  const program = new Command();

  program
    .name('create-stack')
    .description('Universal, interactive project scaffolder for React, Vue, Angular, and Vanilla apps.')
    .version(pkg.version)
    .argument('[project-directory]', 'directory to create the project in')
    .option(
      '-t, --template <name>',
      `template to use (${ALL_VARIANTS.map((v) => v.name).join(', ')})`
    )
    .option('-e, --extras <list>', `comma-separated extras (${[...EXTRA_VALUES].join(', ')})`)
    .option('-p, --pm <manager>', `package manager (${PACKAGE_MANAGERS.join(', ')})`)
    .option('--no-install', 'skip automatic dependency installation')
    .option('-y, --yes', 'skip prompts, failing if a required option is missing')
    .option('--overwrite', 'overwrite the target directory if it already exists')
    .allowExcessArguments(false)
    .parse(process.argv);

  const opts = program.opts();
  const [projectDirectory] = program.args;

  return {
    projectDirectory,
    template: opts.template,
    extras: opts.extras,
    pm: opts.pm,
    overwrite: Boolean(opts.overwrite),
    yes: Boolean(opts.yes),
    // Commander gives --no-install a default of `true`; only trust it when
    // the flag was actually passed on the command line.
    install:
      program.getOptionValueSource('install') === 'cli' ? opts.install : undefined,
  };
}

function buildPreset(cli) {
  const preset = {};

  if (cli.projectDirectory) preset.projectName = cli.projectDirectory;

  if (cli.template) {
    const variantDef = ALL_VARIANTS.find((v) => v.name === cli.template);
    if (!variantDef) {
      throw new Error(
        `Unknown template "${cli.template}". Available: ${ALL_VARIANTS.map((v) => v.name).join(', ')}`
      );
    }
    preset.framework = variantDef.framework;
    preset.variant = variantDef.name;
  }

  if (cli.extras !== undefined) {
    preset.extras = cli.extras
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((e) => {
        if (!EXTRA_VALUES.has(e)) {
          logger.warn(`Ignoring unknown extra "${e}".`);
          return false;
        }
        return true;
      });
  }

  if (cli.pm) {
    if (!PACKAGE_MANAGERS.includes(cli.pm)) {
      throw new Error(`Unknown package manager "${cli.pm}". Available: ${PACKAGE_MANAGERS.join(', ')}`);
    }
    preset.pm = cli.pm;
  }

  if (cli.install !== undefined) preset.install = cli.install;

  return preset;
}

function assertNonInteractiveComplete(preset, cli) {
  if (!cli.yes) return;
  const missing = ['projectName', 'framework', 'variant', 'pm'].filter(
    (key) => preset[key] === undefined
  );
  if (missing.length > 0) {
    throw new Error(
      `--yes was passed but the following are missing: ${missing.join(', ')}. Provide them via flags.`
    );
  }
  if (preset.extras === undefined) preset.extras = [];
  if (preset.install === undefined) preset.install = true;
}

async function confirmOverwrite(targetDir, cli) {
  if (isDirEmpty(targetDir)) return;

  if (!cli.overwrite) {
    if (cli.yes) {
      throw new Error(
        `Target directory "${targetDir}" is not empty. Re-run with --overwrite to proceed.`
      );
    }
    const { overwrite } = await prompts(
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Target directory "${path.basename(targetDir)}" is not empty. Remove existing files and continue?`,
        initial: false,
      },
      {
        onCancel: () => {
          throw new CancelledError('Scaffold cancelled.');
        },
      }
    );
    if (!overwrite) throw new CancelledError('Scaffold cancelled.');
  }

  emptyDir(targetDir);
}

function printSummary(options, { targetDir, cwd, installed, warnings }) {
  const relativeDir = path.relative(cwd, targetDir) || '.';

  const steps = [];
  if (relativeDir !== '.') {
    steps.push(`cd ${/\s/.test(relativeDir) ? `"${relativeDir}"` : relativeDir}`);
  }
  if (!installed) steps.push(`${options.pm} install`);
  // The Angular CLI wires `start` (ng serve); the Vite templates wire `dev`.
  const devScript = options.framework === 'angular' ? 'start' : 'dev';
  steps.push(options.pm === 'npm' ? `npm run ${devScript}` : `${options.pm} ${devScript}`);

  const lines = [
    `${pc.green('✔')} ${pc.bold(`${options.packageName} is ready!`)}`,
    pc.dim(targetDir),
    '',
    pc.bold('Next steps'),
    ...steps.map((step, i) => `  ${pc.dim(`${i + 1}.`)} ${pc.cyan(step)}`),
  ];

  if (warnings.length > 0) {
    lines.push('', pc.bold(pc.yellow('Heads up')));
    for (const warning of warnings) {
      lines.push(`  ${pc.yellow('!')} ${warning}`);
    }
  }

  console.log(
    boxen(lines.join('\n'), {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: warnings.length > 0 ? 'yellow' : 'green',
    })
  );
}

async function main() {
  const cli = parseArgs();
  if (!cli.yes) printBanner(pkg);

  const preset = buildPreset(cli);
  assertNonInteractiveComplete(preset, cli);

  const options = await getProjectOptions(preset);

  const cwd = process.cwd();
  const targetDir = path.resolve(cwd, formatTargetDir(options.projectName));

  await confirmOverwrite(targetDir, cli);

  options.targetDir = targetDir;

  console.log();
  const { warnings } = await scaffoldProject(options);

  let installed = false;
  if (options.install) {
    installed = await installDependencies(targetDir, options.pm);
  }

  printSummary(options, { targetDir, cwd, installed, warnings });
}

export async function run() {
  try {
    await main();
  } catch (err) {
    if (err instanceof CancelledError) {
      logger.warn(`\n${err.message}`);
      process.exit(0);
    }
    logger.error(`\n${pc.bold('Error:')} ${err.message ?? err}`);
    process.exit(1);
  }
}
