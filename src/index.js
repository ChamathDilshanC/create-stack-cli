import path from 'node:path';
import { createRequire } from 'node:module';
import boxen from 'boxen';
import { Command } from 'commander';
import pc from 'picocolors';
import prompts from 'prompts';

import { printBanner } from './banner.js';
import {
  DATABASE_OPTIONS,
  FRAMEWORKS,
  PACKAGE_MANAGERS,
  PROJECT_TYPES,
  QUALITY_OPTIONS,
  STYLING_OPTIONS,
  getProjectOptions,
} from './prompts.js';
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

const PROJECT_TYPE_VALUES = PROJECT_TYPES.map((t) => t.value);
const STYLING_VALUES = new Set(STYLING_OPTIONS.map((s) => s.value));
const DATABASE_VALUES = new Set(DATABASE_OPTIONS.map((d) => d.value));
const QUALITY_VALUES = new Set(QUALITY_OPTIONS.map((q) => q.value));

function parseArgs() {
  const program = new Command();

  program
    .name('create-stack')
    .description(
      'Ultimate multi-tiered project orchestrator — Frontend, Fullstack, Backend, Desktop, and Mobile, scaffolded with each stack\'s own official tooling.'
    )
    .version(pkg.version)
    .argument('[project-directory]', 'directory to create the project in')
    .option('--type <type>', `project type (${PROJECT_TYPE_VALUES.join(', ')})`)
    .option('-f, --framework <name>', 'framework within the chosen type')
    .option('-l, --language <lang>', 'ts or js')
    .option('-s, --styling <name>', `styling (${[...STYLING_VALUES].join(', ')})`)
    .option('-d, --database <name>', `database/ORM (${[...DATABASE_VALUES].join(', ')})`)
    .option('-q, --quality <name>', `code quality tooling (${[...QUALITY_VALUES].join(', ')})`)
    .option('--docker', 'add a Dockerfile + docker-compose.yml')
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
    type: opts.type,
    framework: opts.framework,
    language: opts.language,
    styling: opts.styling,
    database: opts.database,
    quality: opts.quality,
    docker: opts.docker,
    pm: opts.pm,
    overwrite: Boolean(opts.overwrite),
    yes: Boolean(opts.yes),
    // Commander gives --no-install a default of `true`; only trust it when
    // the flag was actually passed on the command line.
    install: program.getOptionValueSource('install') === 'cli' ? opts.install : undefined,
  };
}

function buildPreset(cli) {
  const preset = {};

  if (cli.projectDirectory) preset.projectName = cli.projectDirectory;

  if (cli.type) {
    if (!PROJECT_TYPE_VALUES.includes(cli.type)) {
      throw new Error(`Unknown --type "${cli.type}". Available: ${PROJECT_TYPE_VALUES.join(', ')}`);
    }
    preset.projectType = cli.type;
  }

  if (cli.framework) {
    if (!preset.projectType) {
      throw new Error('--framework requires --type to be set first.');
    }
    const frameworkDef = FRAMEWORKS[preset.projectType].find((f) => f.value === cli.framework);
    if (!frameworkDef) {
      throw new Error(
        `Unknown --framework "${cli.framework}" for type "${preset.projectType}". Available: ${FRAMEWORKS[preset.projectType].map((f) => f.value).join(', ')}`
      );
    }
    preset.framework = frameworkDef.value;
  }

  if (cli.language) {
    if (!['ts', 'js'].includes(cli.language)) {
      throw new Error(`Unknown --language "${cli.language}". Available: ts, js`);
    }
    preset.language = cli.language;
  }

  if (cli.styling) {
    if (!STYLING_VALUES.has(cli.styling)) {
      throw new Error(`Unknown --styling "${cli.styling}". Available: ${[...STYLING_VALUES].join(', ')}`);
    }
    preset.styling = cli.styling;
  }

  if (cli.database) {
    if (!DATABASE_VALUES.has(cli.database)) {
      throw new Error(`Unknown --database "${cli.database}". Available: ${[...DATABASE_VALUES].join(', ')}`);
    }
    preset.database = cli.database;
  }

  if (cli.quality) {
    if (!QUALITY_VALUES.has(cli.quality)) {
      throw new Error(`Unknown --quality "${cli.quality}". Available: ${[...QUALITY_VALUES].join(', ')}`);
    }
    preset.quality = cli.quality;
  }

  if (cli.docker !== undefined) preset.docker = Boolean(cli.docker);

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
  const missing = ['projectName', 'projectType', 'framework', 'pm'].filter((key) => preset[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `--yes was passed but the following are missing: ${missing.join(', ')}. Provide them via flags.`
    );
  }
  // language may be legitimately unset for TS-forced frameworks (Angular,
  // NestJS) — getProjectOptions resolves those on its own either way.
  if (preset.language === undefined) preset.language = 'ts';
  if (preset.styling === undefined) preset.styling = 'none';
  if (preset.database === undefined) preset.database = 'none';
  if (preset.quality === undefined) preset.quality = 'none';
  if (preset.docker === undefined) preset.docker = false;
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

/** The command that actually starts the dev server, per framework's own convention. */
function devCommand(options) {
  const { framework, projectType, pm } = options;
  const runPrefix = pm === 'npm' ? 'npm run' : pm;

  if (projectType === 'mobile') return 'npx expo start';
  if (framework === 'tauri') return `${runPrefix} tauri dev`;
  if (framework === 'electron') return pm === 'npm' ? 'npm start' : `${pm} start`;
  if (framework === 'angular') return `${runPrefix} start`;
  if (framework === 'nestjs') return `${runPrefix} start:dev`;
  return `${runPrefix} dev`;
}

function printSummary(options, { targetDir, cwd, installed, warnings }) {
  const relativeDir = path.relative(cwd, targetDir) || '.';

  const steps = [];
  if (relativeDir !== '.') {
    steps.push(`cd ${/\s/.test(relativeDir) ? `"${relativeDir}"` : relativeDir}`);
  }
  if (!installed) steps.push(`${options.pm} install`);
  steps.push(devCommand(options));

  const lines = [
    // Two spaces, not one: ✔ (U+2714) renders full-width in some terminal
    // fonts, which eats a single following space and glues the text on.
    `${pc.green('✔')}  ${pc.bold(`${options.packageName} is ready!`)}`,
    pc.dim(targetDir),
    pc.dim(`${options.projectType} · ${options.framework} · ${options.language === 'ts' ? 'TypeScript' : 'JavaScript'}`),
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

  // Tauri/Electron/create-hono make some network install activity of their
  // own regardless of --no-install (each warns about that individually when
  // relevant), but none of them reliably finish installing everything this
  // CLI subsequently adds to package.json — so this final pass always runs
  // when the user asked for one, the same as every other project type.
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
