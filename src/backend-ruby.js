import path from 'node:path';
import fs from 'fs-extra';

import { applyDocker } from './docker.js';
import { checkToolchain } from './runtime-check.js';
import { logger } from './utils.js';
import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';

const GREETING_SERVICE_RB = `# Rails' own generators don't scaffold a services/ layer by default — this
# is where business logic that doesn't belong on a controller or a model
# goes, a common convention in real-world Rails apps (a "service object").
# DB-independent on purpose: this step doesn't generate an ActiveRecord
# model (that needs "rails generate model" + "rails db:migrate", each its
# own slow-external-process risk, the same kind just made safer for
# Laravel's migrate step) — swap this for a real model-backed service once
# you've generated one.
class GreetingService
  def initialize(name = "world")
    @name = name
  end

  def call
    "Hello, #{@name}!"
  end
end
`;

const GREETINGS_CONTROLLER_RB = `class GreetingsController < ApplicationController
  def index
    render json: { message: GreetingService.new(params[:name] || "world").call }
  end
end
`;

/**
 * `config/routes.rb`'s overall shape (a Rails.application.routes.draw do
 * ... end block) has been stable for a long time, but the exact commented-
 * out scaffolding inside it does shift between Rails versions — so this
 * only inserts before the block's closing `end` (a version-agnostic
 * anchor) rather than assuming the full file's contents, and skips (with a
 * warning) if that anchor isn't found, the same defensive instinct as
 * Laravel's AppServiceProvider patch in backend-php.js.
 */
async function registerGreetingsRoute(targetDir, warnings) {
  const routesPath = path.join(targetDir, 'config', 'routes.rb');
  if (!(await fs.pathExists(routesPath))) {
    warnings.push('Could not find config/routes.rb to register the example /greetings route — add it yourself: get "greetings", to: "greetings#index".');
    return;
  }

  const content = await fs.readFile(routesPath, 'utf8');
  if (content.includes('greetings#index')) return;

  const updated = content.replace(/\nend\s*$/, '\n  get "greetings", to: "greetings#index"\nend\n');
  if (updated === content) {
    warnings.push(
      'config/routes.rb didn\'t look like the usual Rails skeleton, so the example route was not auto-added — ' +
        'add \'get "greetings", to: "greetings#index"\' inside the routes.draw block yourself.'
    );
    return;
  }
  await fs.writeFile(routesPath, updated);
}

/**
 * `rails new` has no default User model or services layer (unlike
 * Laravel, which ships a real User model out of the box) — generating one
 * for real means running `rails generate model` + `rails db:migrate`,
 * another slow-external-process risk of exactly the kind just fixed for
 * Laravel's migrate step, so this stays DB-independent for now: a
 * GreetingService + a controller/route that actually uses it, the same
 * "no data-access layer available yet, so the example stays one level up"
 * call spring.js's generateSpringStructure already makes when JPA isn't on
 * the classpath.
 */
async function applyRailsLayeredStructure(options, warnings) {
  const { targetDir } = options;

  await fs.outputFile(path.join(targetDir, 'app', 'services', 'greeting_service.rb'), GREETING_SERVICE_RB);
  await fs.outputFile(path.join(targetDir, 'app', 'controllers', 'greetings_controller.rb'), GREETINGS_CONTROLLER_RB);
  await registerGreetingsRoute(targetDir, warnings);

  logger.dim('  › Wrote app/services/greeting_service.rb + app/controllers/greetings_controller.rb by hand.');
}

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

  await applyRailsLayeredStructure(options, warnings);

  warnings.push(
    'Rails already ships ActiveRecord (with SQLite configured by default) and its own RuboCop-friendly conventions — nothing further was layered on top for those. ' +
      'A services/ layer (app/services/greeting_service.rb) and an example GET /greetings route were added on top of Rails\' own structure.'
  );

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'ruby', startCommand: 'bin/rails server -b 0.0.0.0', port: 3000 });
  }
}
