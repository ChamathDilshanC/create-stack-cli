import path from 'node:path';

import { installDependencies } from './install.js';
import { checkToolchain, missingToolchainWarning } from './runtime-check.js';
import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';

/**
 * `wails init` is Wails' own official scaffolder (Go module + a nested
 * frontend/ Vite project) — same "call the real tool" story every other
 * runScaffolder-based entry in this CLI follows. Always uses the
 * `vanilla-ts` template: unlike Tauri/Electron (whose language choice picks
 * between a JS/TS variant of one template), Wails' `options.language` is
 * forced to 'go' (the backend language — see prompts.js's FRAMEWORKS entry),
 * so there's no equivalent signal here to pick a React/Vue/Svelte frontend
 * flavor from; vanilla-ts keeps the generated project small and dependency-
 * free until the user wants to layer a real frontend framework in themselves.
 *
 * `-ci` looks like the obvious "make this non-interactive" flag but isn't —
 * it specifically means "I'm running inside GitHub Actions" and expects a
 * GITHUB_WORKSPACE env var to be set, exiting immediately if it's not
 * (confirmed against wails v2.13.0's own cmd/wails/init.go). Plain `wails
 * init` with no `-ci` is already fully non-interactive on its own.
 */
export async function handleWailsDesktop(options, warnings) {
  const { targetDir, packageName, install } = options;

  const wailsFound = await checkToolchain('wails', ['version']);
  if (!wailsFound) {
    warnings.push(missingToolchainWarning('The Wails CLI', 'go install github.com/wailsapp/wails/v2/cmd/wails@latest (requires Go)'));
    return;
  }

  const { cwd, dirArg } = await scaffolderInvocation(targetDir);
  await runScaffolder({
    label: 'Scaffolding Wails app with wails init...',
    success: 'Wails app scaffolded.',
    command: 'wails',
    args: ['init', '-n', packageName, '-t', 'vanilla-ts', '-d', dirArg],
    cwd,
    expectFile: path.join(targetDir, 'wails.json'),
  });

  // wails.json's own frontend:install/build/dev commands are hardcoded to
  // npm (wails init's own choice, not this CLI's) — `wails dev`/`wails
  // build` always shell out to npm regardless. options.pm plays no part
  // here (it's forced to 'go' for every Go-runtime framework, Wails
  // included, and isn't a real per-project choice the way it is for the
  // Node-family frameworks), so there's nothing to compare it against.
  warnings.push("wails.json's frontend:install/build/dev commands always use npm — edit them yourself if you'd rather a different package manager drove the frontend build.");

  if (install) {
    await installDependencies(path.join(targetDir, 'frontend'), 'npm');
  } else {
    warnings.push('Frontend dependencies were not installed — run "npm install" inside frontend/ before "wails dev".');
  }

  warnings.push(
    "Styling/quality tooling was not auto-wired — frontend/ is its own nested Vite project (not this CLI's usual project root); add Tailwind/ESLint there yourself if you want them."
  );
  if (options.docker) {
    warnings.push('Docker support was skipped — desktop apps run natively and are not typically containerized.');
  }
}
