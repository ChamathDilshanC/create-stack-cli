import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { execa } from 'execa';

import { applyDocker } from './docker.js';
import { checkToolchain } from './runtime-check.js';
import { formatCommand, scaffolderInvocation, tryRun } from './scaffold-utils.js';
import { commandOutputTail, createSpinner, logger, spinnerFail, spinnerSucceed } from './utils.js';

/**
 * `composer create-project laravel/laravel <dir>` normally also runs
 * Laravel's own post-create-project-cmd hooks (`php artisan key:generate`,
 * touch the sqlite file, `php artisan migrate`) — each of those goes
 * through a fresh PHP CLI bootstrap, which on some setups (Xdebug or
 * another IDE-debugger extension attached, antivirus scanning every PHP
 * process, etc.) can take minutes instead of the sub-second it normally
 * does. Bounding the whole command and self-healing afterward (see
 * ensureLaravelBootstrapped below) means a slow PHP setup costs time, not a
 * broken project — without this, an interrupted/slow hook silently leaves
 * APP_KEY empty and the sessions table missing, which is exactly what turns
 * into a 500 on the very first page load (Laravel's default "web"
 * middleware starts a database-backed session on every request, and
 * encrypts it with APP_KEY).
 */
const COMPOSER_CREATE_PROJECT_TIMEOUT_MS = 6 * 60 * 1000;

/** Laravel's own `.env` key format — `base64:` followed by a base64-encoded 32-byte value, exactly what `php artisan key:generate` itself would produce. Generated here so this never depends on a PHP process actually finishing. */
function generateLaravelAppKey() {
  return `base64:${crypto.randomBytes(32).toString('base64')}`;
}

/**
 * `expectFile` here is deliberately `vendor/autoload.php`, not `artisan` —
 * `artisan` is part of the project skeleton and exists almost immediately
 * (before Composer has even started resolving dependencies), so it can't
 * tell "packages fully installed, just the optional hooks were cut short"
 * apart from "still mid-install, don't pretend this succeeded".
 * `vendor/autoload.php` only exists once `composer install` itself has
 * actually finished.
 */
async function runComposerCreateProject(warnings, { cwd, dirArg, targetDir }) {
  const command = 'composer';
  const args = ['create-project', 'laravel/laravel', dirArg];
  const label = 'Scaffolding Laravel project with Composer (composer create-project laravel/laravel)...';

  logger.dim(`  › ${formatCommand(command, args)}`);
  const spinner = createSpinner(label);
  try {
    await execa(command, args, { cwd, stdin: 'ignore', timeout: COMPOSER_CREATE_PROJECT_TIMEOUT_MS });
    spinnerSucceed(spinner, 'Laravel project scaffolded.');
    return;
  } catch (err) {
    const vendorReady = await fs.pathExists(path.join(targetDir, 'vendor', 'autoload.php'));
    if (err.timedOut && vendorReady) {
      spinnerSucceed(spinner, 'Laravel project scaffolded (dependencies installed; slow post-install hooks were cut short).');
      warnings.push(
        `Composer's own post-install steps (key:generate/migrate) did not finish within ${Math.round(COMPOSER_CREATE_PROJECT_TIMEOUT_MS / 60000)} minutes — ` +
          'this usually means something in your PHP setup (Xdebug, an IDE debugger, antivirus scanning) is slowing down PHP CLI invocations. The essentials were finished for you below instead.'
      );
      return;
    }

    spinnerFail(spinner, 'Laravel project scaffolding failed.');
    const tail = commandOutputTail(err);
    throw new Error(
      `\`${formatCommand(command, args)}\` exited with an error.` +
        (tail ? `\n\n${tail}` : '') +
        '\n\nIf this looks like a network hiccup, check your connection and try again.'
    );
  }
}

/**
 * Composer's own hooks normally do all of this — this re-does each part
 * independently (and idempotently: re-running any of it against an already-
 * bootstrapped project is a harmless no-op) so the project is guaranteed
 * correct regardless of whether those hooks actually ran, timed out, or
 * were skipped entirely. `.env`/APP_KEY/the sqlite file need no PHP at all;
 * only the actual migration does.
 */
async function ensureLaravelBootstrapped(options, warnings) {
  const { targetDir } = options;

  const envPath = path.join(targetDir, '.env');
  if (!(await fs.pathExists(envPath))) {
    const examplePath = path.join(targetDir, '.env.example');
    if (await fs.pathExists(examplePath)) {
      await fs.copy(examplePath, envPath);
    }
  }

  if (await fs.pathExists(envPath)) {
    const envContent = await fs.readFile(envPath, 'utf8');
    if (/^APP_KEY=\s*$/m.test(envContent)) {
      await fs.writeFile(envPath, envContent.replace(/^APP_KEY=.*$/m, `APP_KEY=${generateLaravelAppKey()}`));
    }
  }

  // Laravel 11+ defaults to SQLite — the driver itself doesn't create the
  // database file, `touch`-ing an empty one is the whole setup step.
  await fs.ensureFile(path.join(targetDir, 'database', 'database.sqlite'));

  const phpFound = await checkToolchain('php', ['--version']);
  if (!phpFound) {
    warnings.push(
      'PHP itself was not found on PATH — run "php artisan migrate" yourself once it\'s installed (the sessions/users/etc. tables are required for even the default welcome page to load, since the "web" middleware starts a database-backed session on every request).'
    );
    return;
  }

  const migrated = await tryRun({
    label: 'Running database migrations (php artisan migrate)...',
    success: 'Database migrated (database/database.sqlite).',
    failure: 'php artisan migrate did not finish in time.',
    command: 'php',
    args: ['artisan', 'migrate', '--graceful', '--ansi', '--force'],
    cwd: targetDir,
    timeout: 60_000,
  });
  if (!migrated) {
    warnings.push(
      'Run "php artisan migrate" yourself once your PHP setup is confirmed working — without it, even the default welcome page will 500 (missing sessions table).'
    );
  }
}

const USER_REPOSITORY_INTERFACE_PHP = `<?php

namespace App\\Repositories;

use Illuminate\\Database\\Eloquent\\Collection;

interface UserRepositoryInterface
{
    public function all(): Collection;
}
`;

/** Wraps the real \`App\\Models\\User\` Laravel's own skeleton already ships (from its default auth-ready scaffold) — not a stand-in model, the actual one. */
const USER_REPOSITORY_PHP = `<?php

namespace App\\Repositories;

use App\\Models\\User;
use Illuminate\\Database\\Eloquent\\Collection;

class UserRepository implements UserRepositoryInterface
{
    public function all(): Collection
    {
        return User::all();
    }
}
`;

const USER_SERVICE_PHP = `<?php

namespace App\\Services;

use App\\Repositories\\UserRepositoryInterface;
use Illuminate\\Database\\Eloquent\\Collection;

class UserService
{
    public function __construct(private readonly UserRepositoryInterface $users)
    {
    }

    public function all(): Collection
    {
        return $this->users->all();
    }
}
`;

const USER_CONTROLLER_PHP = `<?php

namespace App\\Http\\Controllers;

use App\\Services\\UserService;
use Illuminate\\Http\\JsonResponse;

class UserController extends Controller
{
    public function __construct(private readonly UserService $users)
    {
    }

    public function index(): JsonResponse
    {
        return response()->json($this->users->all());
    }
}
`;

/**
 * Binds the interface to the concrete repository — Laravel's own idiom for
 * this (rather than a config file) is a service provider's register()
 * method. AppServiceProvider's register()/boot() bodies are a bare `//`
 * placeholder comment in every Laravel skeleton since Laravel 9 — this only
 * patches it if that exact placeholder is still there, and skips (with a
 * warning) rather than guessing if some future Laravel skeleton changes it,
 * the same defensive "verify before you patch another module's generated
 * file" instinct that kept this CLI from string-patching Express's
 * server.ts for Auth.js.
 */
async function bindUserRepository(targetDir, warnings) {
  const providerPath = path.join(targetDir, 'app', 'Providers', 'AppServiceProvider.php');
  if (!(await fs.pathExists(providerPath))) {
    warnings.push('Could not find app/Providers/AppServiceProvider.php to bind UserRepositoryInterface — bind it there yourself.');
    return;
  }

  const content = await fs.readFile(providerPath, 'utf8');
  const placeholder = 'public function register(): void\n    {\n        //\n    }';
  if (!content.includes(placeholder)) {
    warnings.push(
      'app/Providers/AppServiceProvider.php didn\'t look like the usual Laravel skeleton, so UserRepositoryInterface was not auto-bound — ' +
        'add "$this->app->bind(UserRepositoryInterface::class, UserRepository::class);" to its register() method yourself.'
    );
    return;
  }

  const withImports = content.includes('use App\\Repositories\\UserRepository;')
    ? content
    : content.replace(
        '<?php\n\nnamespace App\\Providers;\n',
        '<?php\n\nnamespace App\\Providers;\n\nuse App\\Repositories\\UserRepository;\nuse App\\Repositories\\UserRepositoryInterface;\n'
      );
  const withBinding = withImports.replace(
    placeholder,
    'public function register(): void\n    {\n        $this->app->bind(UserRepositoryInterface::class, UserRepository::class);\n    }'
  );
  await fs.writeFile(providerPath, withBinding);
}

/**
 * Laravel's own scaffold already gives a complete, idiomatic app/Models,
 * app/Http/Controllers, app/Http/Middleware, routes/, config/ tree (see the
 * "generic structure is skipped" note on handleLaravelBackend below) — what
 * it doesn't add on its own is a service/repository layer between
 * controllers and Eloquent, which is exactly the extra layering every other
 * backend in this CLI gets. `GET /users` is real and working end-to-end
 * (controller → service → repository → the real Eloquent User model), not
 * a stub — the same "always have one working vertical slice" bar Spring's
 * own Hello controller/service/dto chain sets in spring.js.
 */
async function applyLaravelLayeredStructure(options, warnings) {
  const { targetDir } = options;

  await fs.outputFile(path.join(targetDir, 'app', 'Repositories', 'UserRepositoryInterface.php'), USER_REPOSITORY_INTERFACE_PHP);
  await fs.outputFile(path.join(targetDir, 'app', 'Repositories', 'UserRepository.php'), USER_REPOSITORY_PHP);
  await fs.outputFile(path.join(targetDir, 'app', 'Services', 'UserService.php'), USER_SERVICE_PHP);
  await fs.outputFile(path.join(targetDir, 'app', 'Http', 'Controllers', 'UserController.php'), USER_CONTROLLER_PHP);

  await bindUserRepository(targetDir, warnings);

  const webRoutesPath = path.join(targetDir, 'routes', 'web.php');
  if (await fs.pathExists(webRoutesPath)) {
    let content = await fs.readFile(webRoutesPath, 'utf8');
    if (!content.includes('UserController')) {
      content = content.replace(
        "use Illuminate\\Support\\Facades\\Route;",
        "use App\\Http\\Controllers\\UserController;\nuse Illuminate\\Support\\Facades\\Route;"
      );
      content += "\nRoute::get('/users', [UserController::class, 'index']);\n";
      await fs.writeFile(webRoutesPath, content);
    }
  } else {
    warnings.push('Could not find routes/web.php to register the example /users route — add it yourself: Route::get(\'/users\', [UserController::class, \'index\']);');
  }

  logger.dim('  › Wrote app/Repositories + app/Services + app/Http/Controllers/UserController.php by hand, wrapping the real Eloquent User model.');
}

/**
 * Laravel's official install method is `composer create-project
 * laravel/laravel <dir>` — the same command the Laravel docs themselves
 * lead with. Unlike Express/Fastify/Go above, there is no hand-written
 * fallback for "no Composer" — Laravel's structure is too large to
 * approximate by hand — so a missing Composer hard-fails the whole scaffold
 * with a clear message, the same way a missing Flutter SDK already does for
 * `flutter create`.
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
  await runComposerCreateProject(warnings, { cwd, dirArg, targetDir });
  await ensureLaravelBootstrapped(options, warnings);
  await applyLaravelLayeredStructure(options, warnings);

  warnings.push(
    'Laravel already ships its own code style tool (Laravel Pint) — nothing further was layered on top for that. ' +
      'A Repository/Service layer (wrapping the real Eloquent User model, bound in AppServiceProvider) and an example GET /users route were added on top of Laravel\'s own structure.'
  );

  if (options.docker) {
    await applyDocker(options, warnings, {
      flavor: 'php',
      startCommand: 'php artisan serve --host=0.0.0.0 --port=8000',
      port: 8000,
    });
  }
}
