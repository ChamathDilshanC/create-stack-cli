import path from 'node:path';
import { createRequire } from 'node:module';
import { box, confirm, intro, outro } from '@clack/prompts';
import { Command } from 'commander';
import pc from 'picocolors';

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
  STYLING_OPTIONS_MOBILE,
  getProjectOptions,
} from './prompts.js';
import { scaffoldProject } from './scaffold.js';
import { installDependencies } from './install.js';
import { installPythonDependencies } from './python-utils.js';
import {
  CancelledError,
  emptyDir,
  formatTargetDir,
  guardCancel,
  isDirEmpty,
  logger,
} from './utils.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const PROJECT_TYPE_VALUES = PROJECT_TYPES.map((t) => t.value);
const STYLING_VALUES = new Set(STYLING_OPTIONS.map((s) => s.value));
const STYLING_VALUES_MOBILE = new Set(STYLING_OPTIONS_MOBILE.map((s) => s.value));
const DATABASE_VALUES = new Set(DATABASE_OPTIONS.map((d) => d.value));
const DATABASE_VALUES_PYTHON = new Set(DATABASE_OPTIONS_PYTHON.map((d) => d.value));
const QUALITY_VALUES = new Set(QUALITY_OPTIONS.map((q) => q.value));
const QUALITY_VALUES_PYTHON = new Set(QUALITY_OPTIONS_PYTHON.map((q) => q.value));

function parseArgs() {
  const program = new Command();

  program
    .name('create-stack')
    .description(
      'Ultimate multi-tiered project orchestrator — Frontend, Fullstack, Backend, Desktop, Mobile, and AI/ML, scaffolded with each stack\'s own official tooling.'
    )
    .version(pkg.version)
    .argument('[project-directory]', 'directory to create the project in')
    .option('--type <type>', `project type (${PROJECT_TYPE_VALUES.join(', ')})`)
    .option('-f, --framework <name>', 'framework within the chosen type')
    .option('-l, --language <lang>', 'ts or js')
    .option('-s, --styling <name>', `styling (${[...STYLING_VALUES].join(', ')}) — mobile: ${[...STYLING_VALUES_MOBILE].join(', ')}`)
    .option('-d, --database <name>', `database/ORM (${[...DATABASE_VALUES].join(', ')})`)
    .option('-q, --quality <name>', `code quality tooling (${[...QUALITY_VALUES].join(', ')})`)
    .option('--docker', 'add a Dockerfile + docker-compose.yml')
    .option('-p, --pm <manager>', `package manager (${PACKAGE_MANAGERS.join(', ')})`)
    .option('--build-tool <tool>', 'Spring Boot only: maven or gradle')
    .option('--packaging <type>', 'Spring Boot only: jar or war')
    .option('--java-version <version>', 'Spring Boot only: Java version (e.g. 21, 17)')
    .option('--dependencies <list>', 'Spring Boot only: comma-separated dependency ids, searched live from start.spring.io (e.g. web,data-jpa,postgresql)')
    .option('--group-id <id>', 'Spring Boot only: Java group ID (default: com.example)')
    .option('--no-hot-reload', 'Spring Boot only: skip DevTools / auto-restart-on-change wiring')
    .option('--extra-packages <list>', 'comma-separated extra packages to add — npm for Node projects, PyPI for Python (Spring Boot: use --dependencies instead)')
    .option('--ml-libraries <list>', 'AI/ML (Python) only: comma-separated PyPI library bundles, e.g. numpy,pandas,scikit-learn')
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
    extraPackages: opts.extraPackages,
    mlLibraries: opts.mlLibraries,
    overwrite: Boolean(opts.overwrite),
    yes: Boolean(opts.yes),
    // Commander gives --no-install/--no-hot-reload a default of `true`; only
    // trust that default when the flag was actually passed on the command line.
    install: program.getOptionValueSource('install') === 'cli' ? opts.install : undefined,
    hotReload: program.getOptionValueSource('hotReload') === 'cli' ? opts.hotReload : undefined,
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
    // Mobile's styling choices (NativeWind/None) are a completely different
    // set from the web ones (Tailwind/UnoCSS/CSS Modules/None) — same
    // "narrow by what's already known" idea as --database/--quality below.
    const validStyling = preset.projectType === 'mobile' ? STYLING_VALUES_MOBILE : STYLING_VALUES;
    if (!validStyling.has(cli.styling)) {
      throw new Error(`Unknown --styling "${cli.styling}". Available: ${[...validStyling].join(', ')}`);
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
  if (cli.hotReload !== undefined) preset.springHotReload = cli.hotReload;
  if (cli.extraPackages) {
    preset.extraPackages = cli.extraPackages
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }
  if (cli.mlLibraries) {
    preset.mlLibraries = cli.mlLibraries
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }

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
  const isRust = frameworkDef?.runtime === 'rust';
  const isDart = frameworkDef?.runtime === 'dart';
  const isAi = frameworkDef?.value === 'python-ml';

  const required = ['projectName', 'projectType', 'framework', ...(isPython || isJava || isRust || isDart ? [] : ['pm'])];
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
  if (preset.extraPackages === undefined) preset.extraPackages = [];
  if (preset.docker === undefined) preset.docker = false;
  if (preset.install === undefined) preset.install = true;
  if (isPython) preset.pm = 'pip';
  if (isJava) {
    if (preset.buildTool === undefined) preset.buildTool = 'maven';
    if (preset.packaging === undefined) preset.packaging = 'jar';
    if (preset.javaVersion === undefined) preset.javaVersion = '21';
    if (preset.springDependencies === undefined) preset.springDependencies = ['web'];
    if (preset.springHotReload === undefined) preset.springHotReload = true;
    preset.pm = preset.buildTool;
    preset.install = false;
  }
  if (isRust) {
    preset.pm = 'cargo';
    preset.install = false;
  }
  if (isDart) {
    preset.pm = 'flutter';
    preset.install = false;
  }
  if (isAi && preset.mlLibraries === undefined) preset.mlLibraries = [];
}

async function confirmOverwrite(targetDir, cli) {
  if (isDirEmpty(targetDir)) return;

  if (!cli.overwrite) {
    if (cli.yes) {
      throw new Error(
        `Target directory "${targetDir}" is not empty. Re-run with --overwrite to proceed.`
      );
    }
    const overwrite = guardCancel(
      await confirm({
        message: `Target directory "${path.basename(targetDir)}" is not empty. Remove existing files and continue?`,
        initialValue: false,
      })
    );
    if (!overwrite) throw new CancelledError('Scaffold cancelled.');
  }

  emptyDir(targetDir);
}

/** How to activate the venv, per OS — Windows and POSIX shells use different activation scripts. */
const VENV_ACTIVATE = process.platform === 'win32' ? '.venv\\Scripts\\activate' : 'source .venv/bin/activate';

/** The command that actually starts the dev server, per framework's own convention. */
function devCommand(options) {
  const { framework, pm } = options;

  if (options.runtime === 'python') {
    if (framework === 'django') return 'python manage.py runserver';
    if (framework === 'flask') return 'python app/main.py';
    // Plain uvicorn rather than `fastapi dev`: the latter's rich/emoji
    // output can crash outright on a legacy (non-UTF-8) Windows console —
    // uvicorn's is plain text and works everywhere fastapi[standard] does.
    if (framework === 'fastapi') return 'uvicorn app.main:app --reload';
    // AI/ML has no dev server — it's a plain script, not a web app.
    if (framework === 'python-ml') return 'python main.py';
  }

  if (options.runtime === 'rust') {
    // `cargo run` fetches + builds dependencies on first invocation too, so
    // this doubles as both the "install" step (forced off in prompts.js) and
    // the dev command — there's no separate build step to run first.
    return 'cargo run';
  }

  if (options.runtime === 'dart') {
    // Same story as Rust above: `flutter run` (or `flutter create`'s own
    // `pub get`, already done at scaffold time) covers dependency resolution
    // — there's no separate install step forced off in prompts.js.
    return 'flutter run';
  }

  if (options.runtime === 'java') {
    // Spring Initializr ships both mvnw/gradlew (POSIX) and mvnw.cmd/gradlew.bat
    // (Windows) in every generated project — pick whichever this OS can run.
    // The `.\` prefix is required on Windows too, not just POSIX's `./`: it's
    // harmless in cmd.exe (which searches the current directory anyway) but
    // mandatory in PowerShell, which refuses to run a same-directory script
    // by bare name ("not recognized...") without an explicit path — and
    // PowerShell, not cmd.exe, is what most Windows users actually have open.
    const isWindows = process.platform === 'win32';
    const dot = isWindows ? '.\\' : './';
    if (options.buildTool === 'gradle') {
      const gradlew = `${dot}${isWindows ? 'gradlew.bat' : 'gradlew'}`;
      // --continuous is Gradle's own file-watcher: paired with DevTools (on
      // the classpath whenever hot reload was requested), it re-triggers the
      // build the moment a source file changes and DevTools restarts the app
      // the moment that finishes — the actual nodemon-equivalent loop. Maven
      // has no built-in watch mode, so plain `spring-boot:run` is the best
      // that build tool can offer (see the warning pushed in scaffold.js).
      return options.springHotReload ? `${gradlew} bootRun --continuous` : `${gradlew} bootRun`;
    }
    return `${dot}${isWindows ? 'mvnw.cmd' : 'mvnw'} spring-boot:run`;
  }

  const runPrefix = pm === 'npm' ? 'npm run' : pm;
  if (framework === 'expo') return 'npx expo start';
  // Bare React Native has no single "just run it" command — Metro (the
  // bundler) starts here, but android/ios still need their own native
  // toolchain (Android Studio/Xcode) via `npm run android`/`npm run ios`
  // in a second terminal, same as scaffold.js's own warning notes.
  if (framework === 'react-native') return `${runPrefix} start`;
  if (framework === 'tauri') return `${runPrefix} tauri dev`;
  if (framework === 'electron') return pm === 'npm' ? 'npm start' : `${pm} start`;
  if (framework === 'angular') return `${runPrefix} start`;
  if (framework === 'nestjs') return `${runPrefix} start:dev`;
  return `${runPrefix} dev`;
}

/** Closes the clack thread `main()` opened with `intro()` — a titled note with what to do next, then a short sign-off. */
function printSummary(options, { targetDir, cwd, installed, warnings }) {
  const relativeDir = path.relative(cwd, targetDir) || '.';

  const steps = [];
  if (relativeDir !== '.') {
    steps.push(`cd ${/\s/.test(relativeDir) ? `"${relativeDir}"` : relativeDir}`);
  }
  if (options.runtime === 'python') {
    steps.push(VENV_ACTIVATE);
    if (!installed) steps.push('pip install -r requirements.txt');
  } else if (options.runtime === 'java' || options.runtime === 'rust' || options.runtime === 'dart') {
    // Maven/Gradle's own wrapper (Cargo on `cargo run`, Flutter's own `pub get` at scaffold time) resolves dependencies itself — nothing separate to install.
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
          : options.language === 'rust'
            ? 'Rust'
            : options.language === 'dart'
              ? 'Dart'
              : 'JavaScript';

  const lines = [
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

  // box() over note(): note() always auto-sizes to its longest line, which
  // leaves the closing summary noticeably narrower than the banner above it.
  // An explicit width stretches it to match instead.
  box(lines.join('\n'), `${options.packageName} is ready!`, { width: process.stdout.columns ?? 80 });
  outro(warnings.length > 0 ? pc.yellow('Done — a few things above need your attention.') : pc.green('Done. Happy building!'));
}

async function main() {
  const cli = parseArgs();
  if (!cli.yes) {
    printBanner(pkg);
    // Opens the clack thread every question, spinner, and the closing box()/
    // outro() below all render into — one continuous connected flow from the
    // first question to the last file written, instead of separate,
    // differently-styled UI libraries stitched together. Padded to (nearly)
    // the terminal's full width so the badge reads as a deliberate banner
    // rather than a stray fragment next to a wide, empty line.
    const introWidth = Math.max(20, (process.stdout.columns ?? 80) - 4);
    intro(pc.bgCyan(pc.black(' create-stack '.padEnd(introWidth))));
  }

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
