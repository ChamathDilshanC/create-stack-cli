import path from 'node:path';
import { createRequire } from 'node:module';
import boxen from 'boxen';
import { Command } from 'commander';
import pc from 'picocolors';
import prompts from 'prompts';

import { printBanner } from './banner.js';
import {
  DATABASE_OPTIONS,
  DATABASE_OPTIONS_PYTHON,
  FRAMEWORKS,
  PACKAGE_MANAGERS,
  PROJECT_TYPES,
  QUALITY_OPTIONS,
  QUALITY_OPTIONS_PYTHON,
  STYLING_OPTIONS,
  getProjectOptions,
} from './prompts.js';
import { scaffoldProject } from './scaffold.js';
import { installDependencies } from './install.js';
import { installPythonDependencies } from './python-utils.js';
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
const DATABASE_VALUES_PYTHON = new Set(DATABASE_OPTIONS_PYTHON.map((d) => d.value));
const QUALITY_VALUES = new Set(QUALITY_OPTIONS.map((q) => q.value));
const QUALITY_VALUES_PYTHON = new Set(QUALITY_OPTIONS_PYTHON.map((q) => q.value));

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
    .option('--build-tool <tool>', 'Spring Boot only: maven or gradle')
    .option('--packaging <type>', 'Spring Boot only: jar or war')
    .option('--java-version <version>', 'Spring Boot only: Java version (e.g. 21, 17)')
    .option('--dependencies <list>', 'Spring Boot only: comma-separated dependency ids, searched live from start.spring.io (e.g. web,data-jpa,postgresql)')
    .option('--group-id <id>', 'Spring Boot only: Java group ID (default: com.example)')
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
    buildTool: opts.buildTool,
    packaging: opts.packaging,
    javaVersion: opts.javaVersion,
    dependencies: opts.dependencies,
    groupId: opts.groupId,
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

  let frameworkDef;
  if (cli.framework) {
    if (!preset.projectType) {
      throw new Error('--framework requires --type to be set first.');
    }
    frameworkDef = FRAMEWORKS[preset.projectType].find((f) => f.value === cli.framework);
    if (!frameworkDef) {
      throw new Error(
        `Unknown --framework "${cli.framework}" for type "${preset.projectType}". Available: ${FRAMEWORKS[preset.projectType].map((f) => f.value).join(', ')}`
      );
    }
    preset.framework = frameworkDef.value;
  }
  const isPython = frameworkDef?.runtime === 'python';

  if (cli.language) {
    // Python frameworks force this themselves; only ts/js are ever user-choosable.
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
    // When the framework isn't known yet (interactive framework pick, flag-
    // driven database choice), accept either ecosystem's values and let
    // getProjectOptions/the framework's own forceDatabase sort it out.
    const validDatabase = frameworkDef ? (isPython ? DATABASE_VALUES_PYTHON : DATABASE_VALUES) : new Set([...DATABASE_VALUES, ...DATABASE_VALUES_PYTHON]);
    if (!validDatabase.has(cli.database)) {
      throw new Error(`Unknown --database "${cli.database}". Available: ${[...validDatabase].join(', ')}`);
    }
    preset.database = cli.database;
  }

  if (cli.quality) {
    const validQuality = frameworkDef ? (isPython ? QUALITY_VALUES_PYTHON : QUALITY_VALUES) : new Set([...QUALITY_VALUES, ...QUALITY_VALUES_PYTHON]);
    if (!validQuality.has(cli.quality)) {
      throw new Error(`Unknown --quality "${cli.quality}". Available: ${[...validQuality].join(', ')}`);
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

  if (cli.buildTool) {
    if (!['maven', 'gradle'].includes(cli.buildTool)) {
      throw new Error(`Unknown --build-tool "${cli.buildTool}". Available: maven, gradle`);
    }
    preset.buildTool = cli.buildTool;
  }

  if (cli.packaging) {
    if (!['jar', 'war'].includes(cli.packaging)) {
      throw new Error(`Unknown --packaging "${cli.packaging}". Available: jar, war`);
    }
    preset.packaging = cli.packaging;
  }

  if (cli.javaVersion) preset.javaVersion = cli.javaVersion;
  if (cli.dependencies) {
    preset.springDependencies = cli.dependencies
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  if (cli.groupId) preset.groupId = cli.groupId;

  if (cli.install !== undefined) preset.install = cli.install;

  return preset;
}

function assertNonInteractiveComplete(preset, cli) {
  if (!cli.yes) return;
  // Python frameworks force pm to 'pip' themselves (no npm-family package
  // manager applies), so --yes shouldn't demand -p for them the way it does
  // for everything else. Java is the same story, using whichever build tool
  // was chosen (or defaulted below) instead.
  const frameworkDef = FRAMEWORKS[preset.projectType]?.find((f) => f.value === preset.framework);
  const isPython = frameworkDef?.runtime === 'python';
  const isJava = frameworkDef?.runtime === 'java';

  const required = ['projectName', 'projectType', 'framework', ...(isPython || isJava ? [] : ['pm'])];
  const missing = required.filter((key) => preset[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `--yes was passed but the following are missing: ${missing.join(', ')}. Provide them via flags.`
    );
  }
  // language may be legitimately unset for TS-forced frameworks (Angular,
  // NestJS) — getProjectOptions resolves those on its own either way.
  if (preset.language === undefined) preset.language = 'ts';
  if (preset.styling === undefined) preset.styling = 'none';
  if (preset.database === undefined && !frameworkDef?.forceDatabase) preset.database = 'none';
  if (preset.quality === undefined) preset.quality = 'none';
  if (preset.docker === undefined) preset.docker = false;
  if (preset.install === undefined) preset.install = true;
  if (isPython) preset.pm = 'pip';
  if (isJava) {
    if (preset.buildTool === undefined) preset.buildTool = 'maven';
    if (preset.packaging === undefined) preset.packaging = 'jar';
    if (preset.javaVersion === undefined) preset.javaVersion = '21';
    if (preset.springDependencies === undefined) preset.springDependencies = ['web'];
    preset.pm = preset.buildTool;
    preset.install = false;
  }
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

/** How to activate the venv, per OS — Windows and POSIX shells use different activation scripts. */
const VENV_ACTIVATE = process.platform === 'win32' ? '.venv\\Scripts\\activate' : 'source .venv/bin/activate';

/** The command that actually starts the dev server, per framework's own convention. */
function devCommand(options) {
  const { framework, projectType, pm } = options;

  if (options.runtime === 'python') {
    if (framework === 'django') return 'python manage.py runserver';
    if (framework === 'flask') return 'python app/main.py';
    // Plain uvicorn rather than `fastapi dev`: the latter's rich/emoji
    // output can crash outright on a legacy (non-UTF-8) Windows console —
    // uvicorn's is plain text and works everywhere fastapi[standard] does.
    if (framework === 'fastapi') return 'uvicorn app.main:app --reload';
  }

  if (options.runtime === 'java') {
    // Spring Initializr ships both mvnw/gradlew (POSIX) and mvnw.cmd/gradlew.bat
    // (Windows) in every generated project — pick whichever this OS can run.
    const isWindows = process.platform === 'win32';
    if (options.buildTool === 'gradle') return isWindows ? 'gradlew.bat bootRun' : './gradlew bootRun';
    return isWindows ? 'mvnw.cmd spring-boot:run' : './mvnw spring-boot:run';
  }

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
  if (options.runtime === 'python') {
    steps.push(VENV_ACTIVATE);
    if (!installed) steps.push('pip install -r requirements.txt');
  } else if (options.runtime === 'java') {
    // Maven/Gradle's own wrapper resolves dependencies itself on first run — nothing separate to install.
  } else if (!installed) {
    steps.push(`${options.pm} install`);
  }
  steps.push(devCommand(options));

  const languageLabel =
    options.language === 'ts'
      ? 'TypeScript'
      : options.language === 'python'
        ? 'Python'
        : options.language === 'java'
          ? 'Java'
          : 'JavaScript';

  const lines = [
    // Two spaces, not one: ✔ (U+2714) renders full-width in some terminal
    // fonts, which eats a single following space and glues the text on.
    `${pc.green('✔')}  ${pc.bold(`${options.packageName} is ready!`)}`,
    pc.dim(targetDir),
    pc.dim(`${options.projectType} · ${options.framework} · ${languageLabel}`),
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
    installed =
      options.runtime === 'python'
        ? await installPythonDependencies(targetDir, warnings)
        : await installDependencies(targetDir, options.pm);
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
