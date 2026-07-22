import path from 'node:path';

import { applyDocker } from './docker.js';
import { checkToolchain } from './runtime-check.js';
import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';

/**
 * Rails' official install method is `rails new <dir>` — same as Angular's
 * `ng new`/Flutter's `flutter create`, this is a real local toolchain
 * (Ruby + the Rails gem) that must already be on PATH before scaffolding can
 * run at all, so a missing one hard-fails the whole scaffold with a clear
 * message rather than a soft warning (there's no hand-written fallback for
 * something this large, the same call already made for Laravel).
 *
 * The generic JS-shaped enterprise structure is skipped: `rails new` already
 * lays down its own idiomatic app/models, app/controllers, config/routes.rb
 * tree, and ActiveRecord + SQLite are wired in by default — the same
 * "official scaffolder already gives real structure" reasoning Spring
 * Boot/Laravel use.
 */
export async function handleRailsBackend(options, warnings) {
  const { targetDir, install } = options;

  const rubyFound = await checkToolchain('ruby', ['--version']);
  if (!rubyFound) {
    throw new Error(
      'Ruby was not found on PATH. Rails has no scaffolder other than "rails new" — install Ruby first ' +
        '(https://www.ruby-lang.org/en/downloads/), then the Rails gem ("gem install rails"), then re-run this scaffold.'
    );
  }
  const railsFound = await checkToolchain('rails', ['--version']);
  if (!railsFound) {
    throw new Error('The Rails gem was not found on PATH. Install it with "gem install rails", then re-run this scaffold.');
  }

  const { cwd, dirArg } = await scaffolderInvocation(targetDir);
  await runScaffolder({
    label: 'Scaffolding Rails app with rails new...',
    success: 'Rails app scaffolded.',
    command: 'rails',
    args: ['new', dirArg],
    cwd,
    expectFile: path.join(targetDir, 'Gemfile'),
  });

  // rails new has no equivalent of create-tauri-app/Electron Forge's "always
  // installs" flag to opt out of — it runs `bundle install` on its own by
  // default regardless of what this CLI's own install question resolved to
  // (forced off in prompts.js for this runtime, same as Java/Rust/Dart).
  if (!install) {
    warnings.push('"rails new" always runs "bundle install" as part of scaffolding — --no-install could not be honored here.');
  }

  warnings.push('Rails already ships ActiveRecord (with SQLite configured by default) and its own RuboCop-friendly conventions — nothing further was layered on top.');

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'ruby', startCommand: 'bin/rails server -b 0.0.0.0', port: 3000 });
  }
}
