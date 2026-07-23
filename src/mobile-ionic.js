import path from 'node:path';

import { normalizePackageJson, runScaffolder, scaffolderInvocation } from './scaffold-utils.js';
import { generateEnterpriseStructure } from './structure.js';

/**
 * `ionic start <name> blank --type=react --capacitor` is Ionic's own
 * official scaffolder — the React flavor specifically (Ionic also offers
 * Angular/Vue starters via a different --type, but one is enough to keep
 * this entry's scope the same size as every other single-flavor mobile
 * framework in this CLI; see prompts.js's FRAMEWORKS.mobile). `--capacitor`
 * wires in Capacitor (Ionic's native-runtime layer for iOS/Android/desktop
 * builds) rather than the deprecated Cordova integration.
 */
export async function handleIonicMobile(options, warnings) {
  const { targetDir, install } = options;

  const { cwd, dirArg } = await scaffolderInvocation(targetDir);
  const flags = ['start', dirArg, 'blank', '--type=react', '--capacitor', '--no-git'];
  if (!install) flags.push('--no-deps');

  await runScaffolder({
    label: 'Scaffolding Ionic (React) app with ionic start...',
    success: 'Ionic app scaffolded.',
    command: 'npx',
    args: ['@ionic/cli', ...flags],
    cwd,
    expectFile: path.join(targetDir, 'package.json'),
  });

  await normalizePackageJson(options);

  // Confirmed by running `ionic start` directly: its Capacitor integration
  // step always installs @capacitor/cli + a handful of core plugins
  // regardless of --no-deps — the same "always installs something
  // regardless of --no-install" story create-hono/Tauri/Electron Forge
  // already have elsewhere in this CLI.
  if (!install) {
    warnings.push("ionic start always installs Capacitor's own packages regardless of --no-install — the rest of package.json was not installed; run \"npm install\" yourself.");
  }

  await generateEnterpriseStructure(options, warnings, { baseDir: 'src' });

  // Ionic's own template already ships a complete ESLint config, Vitest
  // (package.json's "test.unit"), and Cypress ("test.e2e") — same
  // "don't duplicate what's already there" call Electron Forge/React
  // Native's own handlers already make for their templates.
  warnings.push("Ionic's own template already ships ESLint, Vitest, and Cypress (see package.json's lint/test.unit/test.e2e scripts); nothing further was needed.");
  warnings.push(
    'Styling was not auto-wired — Ionic has its own CSS-variable theming system (src/theme/variables.css), and some of its components render into Shadow DOM, which plain Tailwind utility classes cannot reach. Add it by hand if you still want it: https://ionicframework.com/docs/theming/basics.'
  );

  if (options.docker) {
    warnings.push('Docker support was skipped — mobile apps run on-device/in-simulator and are not typically containerized.');
  }
}
