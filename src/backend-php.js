import path from 'node:path';

import { applyDocker } from './docker.js';
import { checkToolchain } from './runtime-check.js';
import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';

/**
 * Laravel's official install method is `composer create-project
 * laravel/laravel <dir>` — the same command the Laravel docs themselves
 * lead with, and (via its own post-create-project-cmd hook) it already runs
 * `composer install` and `php artisan key:generate` and writes a real,
 * working `.env` on its own. Unlike Express/Fastify/Go above, there is no
 * hand-written fallback for "no Composer" — Laravel's structure is too large
 * to approximate by hand — so a missing Composer hard-fails the whole
 * scaffold with a clear message, the same way a missing Flutter SDK already
 * does for `flutter create`.
 *
 * The generic JS-shaped enterprise structure is skipped entirely: Laravel's
 * own scaffold already lays down a complete, idiomatic app/Models,
 * app/Http/Controllers, app/Http/Middleware, routes/, config/ tree — adding
 * a second, JS-flavored folder set on top would only collide with it, the
 * same reasoning Spring Boot's Java-shaped structure skip already uses.
 */
export async function handleLaravelBackend(options, warnings) {
  const { targetDir } = options;

  const composerFound = await checkToolchain('composer', ['--version']);
  if (!composerFound) {
    throw new Error(
      'Composer was not found on PATH. Laravel has no scaffolder other than "composer create-project laravel/laravel" — ' +
        'install Composer first (https://getcomposer.org/download/), then re-run this scaffold.'
    );
  }

  const { cwd, dirArg } = await scaffolderInvocation(targetDir);
  await runScaffolder({
    label: 'Scaffolding Laravel project with Composer (composer create-project laravel/laravel)...',
    success: 'Laravel project scaffolded.',
    command: 'composer',
    args: ['create-project', 'laravel/laravel', dirArg],
    cwd,
    expectFile: path.join(targetDir, 'artisan'),
  });

  warnings.push(
    'Laravel already ships its own code style tool (Laravel Pint) and ORM (Eloquent, with SQLite configured by default) — nothing further was layered on top.'
  );

  if (options.docker) {
    await applyDocker(options, warnings, {
      flavor: 'php',
      startCommand: 'php artisan serve --host=0.0.0.0 --port=8000',
      port: 8000,
    });
  }
}
