import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';

import { checkToolchain } from './runtime-check.js';
import { commandOutputTail, createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

/* ------------------------------------------------------------------ */
/* GitHub Actions CI workflow                                          */
/* ------------------------------------------------------------------ */

/**
 * `<pm> run <script>` (or `<pm> <script>`) — except bun, whose own CLI
 * treats `build` and `test` as native subcommands (its bundler and test
 * runner), not script shortcuts. `bun build`/`bun test` would run those
 * instead of the package.json script, so those two always need the
 * explicit `run` to reach the script; everything else uses the shorter,
 * unambiguous form.
 */
function pmRunScript(pm, script) {
  if (pm === 'npm') return `npm run ${script}`;
  if (pm === 'bun' && (script === 'build' || script === 'test')) return `bun run ${script}`;
  return `${pm} ${script}`;
}

/**
 * A step that only runs `command` when package.json actually defines
 * `script` — keeps the workflow green regardless of which quality/testing
 * tool (if any) was picked, without this generator having to know exactly
 * which scaffolder wired up which script name.
 */
function guardedScriptStep(label, script, command) {
  return `      - name: ${label}
        run: |
          if node -e "process.exit(require('./package.json').scripts?.['${script}'] ? 0 : 1)"; then
            ${command}
          else
            echo 'No "${script}" script defined — skipping.'
          fi
`;
}

/** Node ecosystem — covers every frontend/fullstack framework plus the hand-written and framework-CLI backend/desktop/mobile ones (Express, NestJS, Electron, Expo, ...). */
function nodeWorkflowSteps({ pm, framework }) {
  // Neutralino ships no package.json at all (see desktop-neutralino.js) —
  // `${pm} install` would fail outright with nothing to install from, and
  // there's no lint/test/build script to guard for either. `neu build`
  // (via npx, the same way it was scaffolded) is the one command that
  // actually validates the app — no separate Node setup/cache needed
  // for it either, since npx fetches it fresh regardless.
  if (framework === 'neutralino') {
    return '      - run: npx @neutralinojs/neu build\n';
  }

  const setup =
    pm === 'bun'
      ? `      - uses: oven-sh/setup-bun@v2\n`
      : `${pm === 'pnpm' ? '      - uses: pnpm/action-setup@v4\n' : ''}      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: ${pm}
`;

  return (
    setup +
    `      - run: ${pm} install\n` +
    guardedScriptStep('Lint', 'lint', pmRunScript(pm, 'lint')) +
    guardedScriptStep('Test', 'test', pmRunScript(pm, 'test')) +
    guardedScriptStep('Build', 'build', pmRunScript(pm, 'build'))
  );
}

/** Only Ruff/Black+Flake8 are real lint tools this CLI wires up for Python — no test runner is, so (unlike Node above) there's nothing safe to guess at for a test step. */
function pythonWorkflowSteps({ quality }) {
  const lintCommand = quality === 'ruff' ? 'ruff check .' : quality === 'black-flake8' ? 'black --check . && flake8 .' : null;

  return (
    `      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt
` + (lintCommand ? `      - name: Lint\n        run: ${lintCommand}\n` : '')
  );
}

function javaWorkflowSteps({ buildTool, javaVersion }) {
  const wrapper = buildTool === 'gradle' ? './gradlew' : './mvnw';
  const buildCommand = buildTool === 'gradle' ? `${wrapper} build --no-daemon` : `${wrapper} -B verify`;

  return `      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '${javaVersion || '21'}'
      - run: chmod +x ${wrapper}
      - run: ${buildCommand}
`;
}

function rustWorkflowSteps() {
  return `      - uses: dtolnay/rust-toolchain@stable
      - run: cargo build --verbose
      - run: cargo test --verbose
`;
}

function goWorkflowSteps({ framework }) {
  const setupGo = `      - uses: actions/setup-go@v5
        with:
          go-version: '1.23'
`;

  // Wails' main.go //go:embeds frontend/dist — a bare `go build` fails
  // outright with that directory missing, unlike a plain Gin/Fiber/Echo
  // backend (confirmed by actually building a scaffolded Wails app: the
  // frontend has to be built before `go build` ever runs). Skips
  // installing the Wails CLI itself — it isn't needed just to build the
  // Go binary, only frontend/'s own npm build is.
  if (framework === 'wails') {
    return (
      setupGo +
      `      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npm run build
        working-directory: frontend
      - run: go build ./...
      - run: go vet ./...
`
    );
  }

  return `${setupGo}      - run: go build ./...
      - run: go vet ./...
`;
}

function dartWorkflowSteps() {
  return `      - uses: subosito/flutter-action@v2
        with:
          channel: stable
      - run: flutter pub get
      - run: flutter analyze
      - run: flutter test
`;
}

function phpWorkflowSteps() {
  return `      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
      - run: composer install --no-interaction --prefer-dist
`;
}

function rubyWorkflowSteps() {
  return `      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
`;
}

function dotnetWorkflowSteps() {
  return `      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '9.0.x'
      - run: dotnet build
`;
}

function denoWorkflowSteps() {
  return `      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: deno check **/*.ts
`;
}

function kotlinWorkflowSteps() {
  return `      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
      - run: gradle build --no-daemon
`;
}

/** One builder per non-Node runtime — `nodeWorkflowSteps` (the historical default, same story as docker.js's DOCKERFILE_BUILDERS) is the fallback for every runtime not listed here. */
const RUNTIME_WORKFLOW_BUILDERS = {
  python: pythonWorkflowSteps,
  java: javaWorkflowSteps,
  rust: rustWorkflowSteps,
  dart: dartWorkflowSteps,
  go: goWorkflowSteps,
  php: phpWorkflowSteps,
  ruby: rubyWorkflowSteps,
  dotnet: dotnetWorkflowSteps,
  deno: denoWorkflowSteps,
  kotlin: kotlinWorkflowSteps,
};

function buildWorkflowYaml(options) {
  const steps = (RUNTIME_WORKFLOW_BUILDERS[options.runtime] ?? nodeWorkflowSteps)(options);

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${steps}`;
}

/** Writes a basic lint + test + build GitHub Actions workflow, shaped by the chosen runtime/package manager/quality tool. Never fatal — the project already scaffolded successfully either way. */
export async function writeGithubActionsWorkflow(targetDir, options, warnings) {
  const spinner = createSpinner('Generating GitHub Actions workflow...');
  try {
    const workflowDir = path.join(targetDir, '.github', 'workflows');
    await fs.ensureDir(workflowDir);
    await fs.writeFile(path.join(workflowDir, 'ci.yml'), buildWorkflowYaml(options));
    spinnerSucceed(spinner, 'GitHub Actions workflow generated (.github/workflows/ci.yml).');
  } catch (err) {
    spinnerFail(spinner, 'GitHub Actions workflow generation failed.');
    warnings.push(`CI workflow could not be written: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Deployment config (Vercel / Netlify)                                */
/* ------------------------------------------------------------------ */

/** Frameworks Netlify's own "Frameworks API" already auto-detects (correct publish directory and build settings, including the official adapter for Next.js) when `publish` is left out of netlify.toml entirely — only a plain Vite SPA needs it spelled out below. ai-nextjs (see ai-nextjs.js) is a real Next.js app under the hood, so it gets the same treatment as 'next' here despite living under projectType 'ai', not 'frontend'/'fullstack'. */
const NETLIFY_AUTO_DETECTED_FRAMEWORKS = new Set(['next', 'nuxt', 'sveltekit', 'astro', 'ai-nextjs']);

/** Vite's own default build output — every plain frontend framework here (bare Vite templates) uses it unmodified. */
const VITE_OUTPUT_DIR = 'dist';

function buildDeploymentConfigs(options) {
  const buildCommand = pmRunScript(options.pm, 'build');

  // `framework`/`outputDirectory` are deliberately left out for Vercel to
  // auto-detect from package.json — its detection already covers every
  // framework this CLI scaffolds, and a wrong guess here is worse than no
  // guess at all.
  const vercelJson = `${JSON.stringify({ installCommand: `${options.pm} install`, buildCommand }, null, 2)}\n`;

  let netlifyToml = `[build]\n  command = "${buildCommand}"\n`;
  if (!NETLIFY_AUTO_DETECTED_FRAMEWORKS.has(options.framework)) {
    // Angular's CLI builder (>=17) nests the browser bundle under an extra
    // /browser directory; every other plain frontend framework here (bare
    // Vite templates) publishes straight out of dist/.
    const publish = options.framework === 'angular' ? `${VITE_OUTPUT_DIR}/${options.packageName}/browser` : VITE_OUTPUT_DIR;
    netlifyToml += `  publish = "${publish}"\n`;
  }

  return { vercelJson, netlifyToml };
}

/**
 * Writes a starter vercel.json + netlify.toml — for frontend/fullstack
 * projects, plus ai-nextjs specifically (a real deployable Next.js app,
 * just filed under projectType 'ai' — see ai-nextjs.js), since every other
 * backend/desktop/mobile project has nothing for either platform to serve.
 * Never fatal, same as the CI workflow above.
 */
export async function writeDeploymentConfig(targetDir, options, warnings) {
  const deployable = options.projectType === 'frontend' || options.projectType === 'fullstack' || options.framework === 'ai-nextjs';
  if (!deployable) return;

  const spinner = createSpinner('Generating deployment config...');
  try {
    const { vercelJson, netlifyToml } = buildDeploymentConfigs(options);
    await fs.writeFile(path.join(targetDir, 'vercel.json'), vercelJson);
    await fs.writeFile(path.join(targetDir, 'netlify.toml'), netlifyToml);
    spinnerSucceed(spinner, 'Deployment config generated (vercel.json, netlify.toml).');
  } catch (err) {
    spinnerFail(spinner, 'Deployment config generation failed.');
    warnings.push(`Deployment config could not be written: ${err.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Git init + initial commit                                           */
/* ------------------------------------------------------------------ */

/**
 * Initializes git (skipped if the target directory already has a `.git` —
 * e.g. confirmOverwrite()/emptyDir() in index.js deliberately preserve one
 * across --overwrite) and commits every scaffolded file, including the CI
 * workflow/deployment config above and .create-stack.json written just
 * before this runs. Silently does nothing when git isn't on PATH at all —
 * README already lists Git as "recommended," not required.
 */
export async function runGitAutomation(targetDir, warnings) {
  const gitAvailable = await checkToolchain('git');
  if (!gitAvailable) return;

  const hadRepo = await fs.pathExists(path.join(targetDir, '.git'));
  const spinner = createSpinner('Setting up git...');
  try {
    if (!hadRepo) {
      await execa('git', ['init'], { cwd: targetDir });
    }
    await execa('git', ['add', '-A'], { cwd: targetDir });

    const status = await execa('git', ['status', '--porcelain'], { cwd: targetDir });
    if (!status.stdout.trim()) {
      spinnerSucceed(spinner, hadRepo ? 'Nothing new to commit.' : 'Git repository initialized.');
      return;
    }

    const message = hadRepo ? 'chore: scaffold project with create-stack' : 'Initial commit';
    await execa('git', ['commit', '-m', message], { cwd: targetDir });
    spinnerSucceed(spinner, hadRepo ? 'Scaffolded files committed.' : 'Git repository initialized with an initial commit.');
  } catch (err) {
    spinnerFail(spinner, 'Git setup failed.');
    const tail = commandOutputTail(err);
    warnings.push(`git init/commit failed${tail ? ` (${tail.split('\n').pop()})` : ''} — finish it yourself inside the project.`);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Runs right after .create-stack.json is written (see index.js's main()) —
 * none of these three steps are essential to the project working, so a
 * failure in one is a warning, never a thrown error. Order matters: the CI
 * workflow and deployment config are written before the git commit so they
 * end up captured in it, and git runs last since it's the step that
 * actually snapshots everything else on disk.
 */
export async function runAutomations(targetDir, options, warnings) {
  await writeGithubActionsWorkflow(targetDir, options, warnings);
  await writeDeploymentConfig(targetDir, options, warnings);
  await runGitAutomation(targetDir, warnings);
}
