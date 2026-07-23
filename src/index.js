import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'fs-extra';
import { box, confirm, intro, isCancel, outro, select } from '@clack/prompts';
import { Command } from 'commander';
import { execa } from 'execa';
import pc from 'picocolors';

import { printBanner } from './banner.js';
import {
  AUTH_OPTIONS,
  DATABASE_OPTIONS,
  DATABASE_OPTIONS_PYTHON,
  FRAMEWORKS,
  PACKAGE_MANAGERS,
  PROJECT_TYPES,
  QUALITY_OPTIONS,
  QUALITY_OPTIONS_PYTHON,
  STYLING_OPTIONS,
  STYLING_OPTIONS_MOBILE,
  TESTING_OPTIONS,
  getProjectOptions,
} from './prompts.js';
import { PRESETS, resolvePresetByName } from './presets.js';
import { runAutomations } from './automations.js';
import { checkForUpdate } from './update-checker.js';
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
const TESTING_VALUES = new Set(TESTING_OPTIONS.map((t) => t.value));
const AUTH_VALUES = new Set(AUTH_OPTIONS.map((a) => a.value));

/**
 * Post-scaffold only — not part of the project decision tree (getProjectOptions),
 * since it's an action taken on the finished project, not a choice about what
 * to build. `claude` is a terminal REPL, not a GUI editor, so maybeOpenEditor
 * below launches it differently (hands over the current terminal via `stdio:
 * 'inherit'`) instead of spawning it detached like the other three.
 */
const CODE_EDITORS = [
  { value: 'vscode', label: 'VS Code', command: 'code' },
  { value: 'cursor', label: 'Cursor', command: 'cursor' },
  { value: 'antigravity', label: 'Antigravity', command: 'antigravity' },
  { value: 'claude', label: 'Claude Code', command: 'claude' },
];
const EDITOR_VALUES = new Set([...CODE_EDITORS.map((e) => e.value), 'none']);

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
    .option('-a, --auth <name>', `authentication (${[...AUTH_VALUES].join(', ')}) — only Auth.js has real scaffolding behind it so far, and only for Next.js/Express`)
    .option('-t, --testing <name>', `testing setup (${[...TESTING_VALUES].join(', ')}) — only Vitest has real scaffolding behind it so far`)
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
    .option('--editor <name>', `open the finished project in a code editor when done (${[...EDITOR_VALUES].join(', ')}) — skipped by default under --yes`)
    .option('-y, --yes', 'skip prompts, failing if a required option is missing')
    .option('--preset <name>', `scaffold a known-good bundle of options (${Object.keys(PRESETS).join(', ')}) non-interactively — individual flags above still override it`)
    .option('--from-config <path>', 'replay a previously generated .create-stack.json non-interactively — individual flags above still override it')
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
    auth: opts.auth,
    testing: opts.testing,
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
    editor: opts.editor,
    overwrite: Boolean(opts.overwrite),
    preset: opts.preset,
    fromConfig: opts.fromConfig,
    // --preset/--from-config exist specifically to bypass the wizard, same as
    // -y — so either one implies it instead of requiring -y alongside them.
    yes: Boolean(opts.yes) || Boolean(opts.preset) || Boolean(opts.fromConfig),
    // Commander gives --no-install/--no-hot-reload a default of `true`; only
    // trust that default when the flag was actually passed on the command line.
    install: program.getOptionValueSource('install') === 'cli' ? opts.install : undefined,
    hotReload: program.getOptionValueSource('hotReload') === 'cli' ? opts.hotReload : undefined,
  };
}

/**
 * Lifts CLI flags onto the same field names `preset`/`getProjectOptions`
 * use — no validation here, just the flag -> field mapping. Kept separate
 * from validatePreset() below so that mapping happens once regardless of
 * where the flags end up layered (see buildPreset).
 */
function normalizeCliOverrides(cli) {
  const overrides = {};

  if (cli.projectDirectory) overrides.projectName = cli.projectDirectory;
  if (cli.type) overrides.projectType = cli.type;
  if (cli.framework) overrides.framework = cli.framework;
  if (cli.language) overrides.language = cli.language;
  if (cli.styling) overrides.styling = cli.styling;
  if (cli.database) overrides.database = cli.database;
  if (cli.auth) overrides.auth = cli.auth;
  if (cli.testing) overrides.testing = cli.testing;
  if (cli.quality) overrides.quality = cli.quality;
  if (cli.docker !== undefined) overrides.docker = Boolean(cli.docker);
  if (cli.pm) overrides.pm = cli.pm;
  if (cli.buildTool) overrides.buildTool = cli.buildTool;
  if (cli.packaging) overrides.packaging = cli.packaging;
  if (cli.javaVersion) overrides.javaVersion = cli.javaVersion;
  if (cli.dependencies) {
    overrides.springDependencies = cli.dependencies
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  if (cli.groupId) overrides.groupId = cli.groupId;
  if (cli.hotReload !== undefined) overrides.springHotReload = cli.hotReload;
  if (cli.extraPackages) {
    overrides.extraPackages = cli.extraPackages
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }
  if (cli.mlLibraries) {
    overrides.mlLibraries = cli.mlLibraries
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }
  if (cli.install !== undefined) overrides.install = cli.install;

  return overrides;
}

/**
 * Validates a fully-merged preset object — whatever combination of a named
 * --preset, a loaded --from-config file, and explicit flags produced it.
 * Runs on the *merged* result rather than each source individually, so a
 * value inherited from --preset/--from-config gets exactly the same
 * scrutiny as one passed directly on the command line (a hand-edited config
 * file is just as capable of a typo as a flag is).
 */
function validatePreset(preset) {
  if (preset.projectType && !PROJECT_TYPE_VALUES.includes(preset.projectType)) {
    throw new Error(`Unknown project type "${preset.projectType}". Available: ${PROJECT_TYPE_VALUES.join(', ')}`);
  }

  let frameworkDef;
  if (preset.framework) {
    if (!preset.projectType) {
      throw new Error('"framework" requires "type" to be set first (via --type, --preset, or --from-config).');
    }
    frameworkDef = FRAMEWORKS[preset.projectType].find((f) => f.value === preset.framework);
    if (!frameworkDef) {
      throw new Error(
        `Unknown framework "${preset.framework}" for type "${preset.projectType}". Available: ${FRAMEWORKS[preset.projectType].map((f) => f.value).join(', ')}`
      );
    }
  }
  const isPython = frameworkDef?.runtime === 'python';

  if (preset.language !== undefined) {
    // Frameworks that force their own language (Angular/NestJS -> ts, every
    // Python/Java/Rust/... framework, etc.) may legitimately carry that
    // value in a replayed config — only frameworks where ts/js is a real
    // choice restrict it to that pair.
    const validLanguage = frameworkDef?.forceLanguage ? [frameworkDef.forceLanguage] : ['ts', 'js'];
    if (!validLanguage.includes(preset.language)) {
      throw new Error(`Unknown language "${preset.language}". Available: ${validLanguage.join(', ')}`);
    }
  }

  if (preset.styling !== undefined) {
    // Mobile's styling choices (NativeWind/None) are a completely different
    // set from the web ones (Tailwind/UnoCSS/CSS Modules/None) — same
    // "narrow by what's already known" idea as database/quality below.
    const validStyling = preset.projectType === 'mobile' ? STYLING_VALUES_MOBILE : STYLING_VALUES;
    if (!validStyling.has(preset.styling)) {
      throw new Error(`Unknown styling "${preset.styling}". Available: ${[...validStyling].join(', ')}`);
    }
  }

  if (preset.database !== undefined) {
    // When the framework isn't known yet, accept either ecosystem's values
    // and let getProjectOptions/the framework's own forceDatabase sort it out.
    const validDatabase = frameworkDef ? (isPython ? DATABASE_VALUES_PYTHON : DATABASE_VALUES) : new Set([...DATABASE_VALUES, ...DATABASE_VALUES_PYTHON]);
    if (!validDatabase.has(preset.database)) {
      throw new Error(`Unknown database "${preset.database}". Available: ${[...validDatabase].join(', ')}`);
    }
  }

  if (preset.quality !== undefined) {
    const validQuality = frameworkDef ? (isPython ? QUALITY_VALUES_PYTHON : QUALITY_VALUES) : new Set([...QUALITY_VALUES, ...QUALITY_VALUES_PYTHON]);
    if (!validQuality.has(preset.quality)) {
      throw new Error(`Unknown quality "${preset.quality}". Available: ${[...validQuality].join(', ')}`);
    }
  }

  // Node-only questions (no Python/Java/Rust/... variant to narrow between,
  // unlike database/quality above) — invalid regardless of framework.
  if (preset.auth !== undefined && !AUTH_VALUES.has(preset.auth)) {
    throw new Error(`Unknown auth "${preset.auth}". Available: ${[...AUTH_VALUES].join(', ')}`);
  }

  if (preset.testing !== undefined && !TESTING_VALUES.has(preset.testing)) {
    throw new Error(`Unknown testing "${preset.testing}". Available: ${[...TESTING_VALUES].join(', ')}`);
  }

  if (preset.pm !== undefined && !PACKAGE_MANAGERS.includes(preset.pm)) {
    throw new Error(`Unknown package manager "${preset.pm}". Available: ${PACKAGE_MANAGERS.join(', ')}`);
  }

  if (preset.buildTool !== undefined && !['maven', 'gradle'].includes(preset.buildTool)) {
    throw new Error(`Unknown build tool "${preset.buildTool}". Available: maven, gradle`);
  }

  if (preset.packaging !== undefined && !['jar', 'war'].includes(preset.packaging)) {
    throw new Error(`Unknown packaging "${preset.packaging}". Available: jar, war`);
  }
}

/**
 * Merges, in increasing precedence, a named --preset, a loaded --from-config
 * file, and whatever flags were passed directly — so `--preset saas -d
 * drizzle` scaffolds the saas bundle with Drizzle instead of Prisma, and
 * `--from-config ./old/.create-stack.json my-new-app` replays a prior run
 * under a new directory name (the positional argument still wins over
 * whatever projectName the config file carries).
 */
function buildPreset(cli, base = {}) {
  const preset = { ...base, ...normalizeCliOverrides(cli) };
  validatePreset(preset);

  // Not a project-decision field (doesn't belong on `preset`/getProjectOptions) —
  // validated here anyway, alongside every other flag, so a typo fails fast
  // instead of surfacing only after the whole scaffold has already run.
  if (cli.editor !== undefined && !EDITOR_VALUES.has(cli.editor)) {
    throw new Error(`Unknown --editor "${cli.editor}". Available: ${[...EDITOR_VALUES].join(', ')}`);
  }

  return preset;
}

/** Fields that describe *this* run rather than the underlying decisions — dropped from a loaded config so replaying it targets a fresh directory instead of inheriting the previous run's resolved path. */
const CONFIG_NON_REPLAYABLE_KEYS = new Set(['targetDir']);

/** Loads a `.create-stack.json` written by a previous run (see writeReplayConfig) for `--from-config` to replay. */
function loadConfigFile(configPath) {
  const resolved = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--from-config file not found: ${resolved}`);
  }

  let data;
  try {
    data = fs.readJsonSync(resolved);
  } catch (err) {
    throw new Error(`--from-config file "${resolved}" is not valid JSON: ${err.message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`--from-config file "${resolved}" must contain a JSON object.`);
  }

  const config = {};
  for (const [key, value] of Object.entries(data)) {
    if (!CONFIG_NON_REPLAYABLE_KEYS.has(key)) config[key] = value;
  }
  return config;
}

/** Combines --preset and --from-config (in that order — a config file layers on top of, and can override, a named preset) into the base object buildPreset() then applies flags on top of. */
function resolveBaseOptions(cli) {
  let base = {};
  if (cli.preset) base = { ...base, ...resolvePresetByName(cli.preset) };
  if (cli.fromConfig) base = { ...base, ...loadConfigFile(cli.fromConfig) };
  return base;
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
  const isGo = frameworkDef?.runtime === 'go';
  const isPhp = frameworkDef?.runtime === 'php';
  const isRuby = frameworkDef?.runtime === 'ruby';
  const isDotnet = frameworkDef?.runtime === 'dotnet';
  const isDeno = frameworkDef?.runtime === 'deno';
  const isKotlin = frameworkDef?.runtime === 'kotlin';
  const isAi = frameworkDef?.value === 'python-ml';
  const skipsPmQuestion = isPython || isJava || isRust || isDart || isGo || isPhp || isRuby || isDotnet || isDeno || isKotlin;

  const required = ['projectName', 'projectType', 'framework', ...(skipsPmQuestion ? [] : ['pm'])];
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
  if (preset.auth === undefined) preset.auth = 'none';
  if (preset.testing === undefined) preset.testing = 'none';
  // Only consumed for projectType 'backend' (see prompts.js's
  // supportsHotReload) — harmless to default everywhere else, same as
  // auth/testing/quality above already do.
  if (preset.hotReload === undefined) preset.hotReload = true;
  // Same story — only consumed for frontend/fullstack (supportsUiLayer), and
  // uiKit further narrows by framework/styling on top of that (stepUiKit) —
  // defaulting to 'none' everywhere else is always harmless.
  if (preset.stateManagement === undefined) preset.stateManagement = 'none';
  if (preset.apiLayer === undefined) preset.apiLayer = 'none';
  if (preset.uiKit === undefined) preset.uiKit = 'none';
  if (preset.quality === undefined) preset.quality = 'none';
  if (preset.extraPackages === undefined) preset.extraPackages = [];
  if (preset.docker === undefined) preset.docker = false;
  if (preset.install === undefined) preset.install = true;
  // Neutralino ships no package.json — nothing for a live install to act on
  // (see prompts.js's stepInstall for the interactive-mode equivalent).
  if (preset.framework === 'neutralino') preset.install = false;
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
  if (isGo) {
    preset.pm = 'go';
    // Wails is the one Go framework with a genuine npm-installable
    // frontend/ (see prompts.js's stepInstall) — default it to true, the
    // same as every Node-family framework, rather than forcing it off.
    preset.install = preset.framework === 'wails' ? (preset.install ?? true) : false;
  }
  if (isPhp) {
    preset.pm = 'composer';
    preset.install = false;
  }
  if (isRuby) {
    preset.pm = 'bundler';
    preset.install = false;
  }
  if (isDotnet) {
    preset.pm = 'dotnet';
    preset.install = false;
  }
  if (isDeno) {
    preset.pm = 'deno';
    preset.install = false;
  }
  if (isKotlin) {
    preset.pm = 'gradle';
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

/** Runtimes whose dependencies are always resolved by the toolchain itself (a wrapper, a first build/run, or the scaffolder's own install) — mirrors prompts.js's NO_LIVE_INSTALL_STEP_RUNTIMES, just as a Set since printSummary only ever needs membership checks. */
const NO_LIVE_INSTALL_STEP_RUNTIMES = new Set(['java', 'rust', 'dart', 'go', 'php', 'ruby', 'dotnet', 'deno', 'kotlin']);

/** options.language -> the label printSummary prints; anything absent (i.e. 'js'/undefined) falls back to 'JavaScript' at the call site. */
const LANGUAGE_LABELS = {
  ts: 'TypeScript',
  python: 'Python',
  java: 'Java',
  rust: 'Rust',
  dart: 'Dart',
  go: 'Go',
  php: 'PHP',
  ruby: 'Ruby',
  csharp: 'C#',
  kotlin: 'Kotlin',
};

/** The command that actually starts the dev server, per framework's own convention. */
function devCommand(options) {
  const { framework, pm } = options;

  if (options.runtime === 'python') {
    // Django's runserver auto-reloads by default; --noreload is the only way
    // to turn that off, which is what a "No" answer to the hot-reload
    // question (see prompts.js's stepHotReload) means here.
    if (framework === 'django') return options.hotReload === false ? 'python manage.py runserver --noreload' : 'python manage.py runserver';
    // Flask's own reload behavior is baked into app.run(debug=...) at
    // scaffold time (see scaffold.js's flaskMain) — nothing to toggle here.
    if (framework === 'flask') return 'python app/main.py';
    // Plain uvicorn rather than `fastapi dev`: the latter's rich/emoji
    // output can crash outright on a legacy (non-UTF-8) Windows console —
    // uvicorn's is plain text and works everywhere fastapi[standard] does.
    if (framework === 'fastapi') return options.hotReload === false ? 'uvicorn app.main:app' : 'uvicorn app.main:app --reload';
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

  if (options.runtime === 'go') {
    // Wails shares runtime 'go' with the Gin/Fiber/Echo backends above (it's
    // a Go module too) but is a completely different kind of app — `wails
    // dev` builds the Go binary and starts the frontend's Vite dev server
    // together, hot-reloading both; `go run .`/`make dev` (correct for a
    // plain Go backend) wouldn't even build a Wails app correctly.
    if (framework === 'wails') return 'wails dev';
    // `make dev` runs air (see hot-reload.js's writeGoAirConfig, wired in by
    // backend-go.js) when hot-reload was requested; otherwise plain `go run
    // .` — same story as Rust's cargo run above, nothing separate to resolve.
    return options.hotReload ? 'make dev' : 'go run .';
  }

  if (options.runtime === 'php') {
    // Laravel's own dev server — already installed as part of scaffolding
    // (backend-php.js's composer create-project), so there's nothing to
    // resolve first.
    return 'php artisan serve';
  }

  if (options.runtime === 'ruby') {
    // Rails' own binstub — `rails new` already ran bundle install as part
    // of scaffolding (backend-ruby.js), so there's nothing to resolve first.
    return 'bin/rails server';
  }

  if (options.runtime === 'dotnet') {
    // Restores NuGet packages on its own before running, same as `cargo run`.
    return 'dotnet run';
  }

  if (options.runtime === 'deno') {
    // Fresh's own generated deno.json defines a "start" task (dev mode with
    // file watching); the hand-written Oak template (backend-deno.js) uses
    // "dev" instead, to leave "start" free for a future no-watch/prod task.
    return framework === 'deno-fresh' ? 'deno task start' : 'deno task dev';
  }

  if (options.runtime === 'kotlin') {
    // KMP's application plugin lives on the separate :app subproject (see
    // mobile-kmp.js — Gradle's own KMP plugin rejects `application` applied
    // directly to a kotlin("multiplatform") module), not the root project
    // Ktor's single-module layout assumes — needs the subproject-qualified
    // task name, unlike Ktor's plain `run` below.
    if (framework === 'kmp') return 'gradle :app:run';
    // Plain `gradle run` rather than `./gradlew run`: backend-kotlin.js only
    // generates a wrapper opportunistically (when a system Gradle was found
    // to bootstrap it from), and that success/failure isn't threaded through
    // to options here — `gradle run` is the one command that's correct
    // either way, given Gradle has to be present for this to work at all.
    return 'gradle run';
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
  // Neutralino's minimal template ships no package.json at all (see
  // desktop-neutralino.js) — there's no "<pm> dev" to fall through to below.
  if (framework === 'neutralino') return 'npx @neutralinojs/neu run';
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
  } else if (NO_LIVE_INSTALL_STEP_RUNTIMES.has(options.runtime) || options.framework === 'neutralino') {
    // Maven/Gradle's own wrapper (Cargo on `cargo run`, Flutter's own `pub get`
    // at scaffold time, Go/dotnet/Kotlin resolving lazily on first build, Deno
    // caching imports on first run, Laravel/Rails always installing as part
    // of their own scaffolder) resolves dependencies itself — nothing
    // separate to install here. Neutralino ships no package.json at all
    // (see desktop-neutralino.js), so "npm install" wouldn't even find
    // anything to act on.
  } else if (!installed) {
    steps.push(`${options.pm} install`);
  }
  steps.push(devCommand(options));

  const languageLabel = LANGUAGE_LABELS[options.language] ?? 'JavaScript';

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

/**
 * Runs after the summary box, once the project already exists on disk —
 * purely optional, never affects the scaffold's own success/failure. Skipped
 * entirely under --yes unless --editor was passed explicitly (scripts/CI
 * shouldn't have a GUI window pop up on their own), and a launch failure
 * (editor not installed, not on PATH) is a warning, not a thrown error —
 * the project is already fully scaffolded either way.
 *
 * GUI editors (VS Code/Cursor/Antigravity) are spawned detached and
 * `unref()`d so this process can exit on its own right after — that's what
 * actually "returns" the terminal, since a CLI has no clean, portable way to
 * close the terminal *window* itself. Claude Code is different: it's a
 * terminal REPL, not a GUI window, so it gets the current terminal handed
 * over via `stdio: 'inherit'` and this process waits for it to exit instead.
 */
async function maybeOpenEditor(targetDir, cli) {
  let choice = cli.editor;
  if (choice === undefined) {
    if (cli.yes) return;
    const answer = await select({
      message: 'Open the project in a code editor?',
      options: [...CODE_EDITORS.map((e) => ({ value: e.value, label: e.label })), { value: 'none', label: 'None' }],
      initialValue: 'none',
    });
    if (isCancel(answer)) return;
    choice = answer;
  }
  if (choice === 'none') return;

  const editor = CODE_EDITORS.find((e) => e.value === choice);

  if (editor.value === 'claude') {
    logger.dim(`Launching Claude Code in ${targetDir}...`);
    // reject: false resolves instead of throwing even when the command isn't
    // found at all — checking `.failed` is the only way to detect that case.
    const result = await execa(editor.command, [], { cwd: targetDir, stdio: 'inherit', reject: false });
    if (result.failed) {
      logger.warn(`Could not launch Claude Code (${result.shortMessage ?? result.message}) — run "claude" yourself inside ${targetDir}.`);
    }
    return;
  }

  // A missing command fails asynchronously (the returned promise rejects
  // later), not synchronously, so try/catch around the call itself wouldn't
  // catch it — racing it against a short timeout instead reports the common
  // "not installed" failure before this process exits, while a real editor
  // (which keeps running far longer than 500ms) always wins the race as a
  // success. Either way, .unref() — called on the same object, since execa's
  // return value doubles as both a promise and the child-process handle —
  // lets this process exit on its own without waiting for the detached editor.
  const subprocess = execa(editor.command, [targetDir], { detached: true, stdio: 'ignore' });
  const failure = await Promise.race([
    subprocess.then(
      () => null,
      (err) => err
    ),
    new Promise((resolve) => setTimeout(() => resolve(null), 500)),
  ]);
  subprocess.unref();

  if (failure) {
    logger.warn(`Could not launch ${editor.label} (${failure.shortMessage ?? failure.message}) — open ${targetDir} manually.`);
  } else {
    logger.success(`Opening ${targetDir} in ${editor.label}...`);
  }
}

/**
 * options fields left out of the saved config: `targetDir` is this run's
 * absolute path, meaningless to replay elsewhere, and `packageName` is
 * always recomputed from `projectName` by stepPackageName regardless of
 * what's already set (see prompts.js) — saving it would just be a dead
 * field a reader could mistake for something --from-config honors.
 */
const OPTIONS_NON_REPLAYABLE_KEYS = new Set(['targetDir', 'packageName']);

/**
 * Writes the resolved decisions behind this project — everything
 * `getProjectOptions` returned, plus whatever scaffold.js/index.js added to
 * it minus run-specific state like the absolute target path — to
 * `.create-stack.json` in the new project's root. `--from-config` reads this
 * same file back to reproduce the setup non-interactively later, e.g. for a
 * second app that should match the first, or to hand a known-good starting
 * point to a teammate.
 */
function writeReplayConfig(targetDir, options) {
  const config = {};
  for (const [key, value] of Object.entries(options)) {
    if (OPTIONS_NON_REPLAYABLE_KEYS.has(key) || value === undefined) continue;
    config[key] = value;
  }
  fs.writeJsonSync(path.join(targetDir, '.create-stack.json'), config, { spaces: 2 });
}

async function main() {
  // The very first thing this CLI does on every invocation, before parsing
  // args or printing the banner — bounded by its own short internal
  // timeout (see update-checker.js), so a slow/offline network never
  // meaningfully delays startup either way.
  await checkForUpdate();

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

  const base = resolveBaseOptions(cli);
  const preset = buildPreset(cli, base);
  assertNonInteractiveComplete(preset, cli);

  const options = await getProjectOptions(preset, { interactive: !cli.yes });

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
  // Wails and Neutralino are the exceptions: Wails' package.json lives
  // under frontend/, not targetDir itself (handleWailsDesktop already
  // installs there directly, and options.pm is 'go' for it — install.js has
  // no "go" install path); Neutralino has no package.json anywhere in the
  // project at all (see desktop-neutralino.js). Either way there's no
  // root-level package.json for a live install here to act on.
  const NO_ROOT_PACKAGE_JSON_FRAMEWORKS = new Set(['wails', 'neutralino']);
  let installed = false;
  if (options.install && !NO_ROOT_PACKAGE_JSON_FRAMEWORKS.has(options.framework)) {
    installed =
      options.runtime === 'python'
        ? await installPythonDependencies(targetDir, warnings)
        : await installDependencies(targetDir, options.pm);
  }

  writeReplayConfig(targetDir, options);
  await runAutomations(targetDir, options, warnings);

  printSummary(options, { targetDir, cwd, installed, warnings });
  await maybeOpenEditor(targetDir, cli);
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
