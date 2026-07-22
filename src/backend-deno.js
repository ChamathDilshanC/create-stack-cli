import path from 'node:path';
import fs from 'fs-extra';

import { applyDocker } from './docker.js';
import { checkToolchain, missingToolchainWarning } from './runtime-check.js';
import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';
import { logger } from './utils.js';

/**
 * Fresh's official install method, unchanged since Fresh 1.x:
 * `deno run -A -r https://fresh.deno.dev <dir>`. `--force` skips the
 * "directory not empty?" confirmation prompt the same way `runScaffolder`'s
 * `stdin: 'ignore'` already fails fast on any *other* unexpected prompt — the
 * generated deno.json ships its own `start`/`build`/`preview` tasks (Fresh
 * writes these itself), which is what devCommand() in index.js relies on.
 * Fresh is Backend here (not Frontend/Fullstack), so this deliberately
 * doesn't pass --tailwind/--vscode — this CLI's own styling question never
 * applies to the Backend project type in the first place.
 *
 * A missing Deno hard-fails the scaffold (same treatment as Laravel/Rails/
 * .NET above) — there's no hand-written fallback for a whole framework.
 */
export async function handleDenoFreshBackend(options, warnings) {
  const { targetDir } = options;

  const denoFound = await checkToolchain('deno', ['--version']);
  if (!denoFound) {
    throw new Error(
      'Deno was not found on PATH. Fresh has no scaffolder other than "deno run -A -r https://fresh.deno.dev" — ' +
        'install Deno first (https://docs.deno.com/runtime/getting_started/installation/), then re-run this scaffold.'
    );
  }

  const { cwd, dirArg } = await scaffolderInvocation(targetDir);
  await runScaffolder({
    label: 'Scaffolding Fresh project (deno run -A -r https://fresh.deno.dev)...',
    success: 'Fresh project scaffolded.',
    command: 'deno',
    args: ['run', '-A', '-r', 'https://fresh.deno.dev', dirArg, '--force'],
    cwd,
    expectFile: path.join(targetDir, 'deno.json'),
  });

  warnings.push('Deno resolves and caches JSR/npm imports on first run — no separate install step was needed.');

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'deno', startCommand: 'deno task start', port: 8000 });
  }
}

const OAK_DENO_JSON = `{
  "imports": {
    "@oak/oak": "jsr:@oak/oak@^17.1.4"
  },
  "tasks": {
    "dev": "deno run --allow-net --allow-env --watch main.ts",
    "start": "deno run --allow-net --allow-env main.ts"
  }
}
`;

/** Plain data shape — no framework-specific trait to differ on (same idea as scaffold.js's Rust/Go models). */
const OAK_MODELS_TS = `export interface User {
  id: number;
  name: string;
  email: string;
}
`;

/**
 * In-memory on purpose: this step doesn't force a database choice — swap
 * this for a real database-backed implementation once you've picked one;
 * nothing in controllers.ts needs to change to do that.
 */
const OAK_SERVICES_TS = `import type { User } from "./models.ts";

const users = new Map<number, User>([
  [1, { id: 1, name: "Ada Lovelace", email: "ada@example.com" }],
]);

export class UserService {
  listUsers(): User[] {
    return Array.from(users.values());
  }
}
`;

const OAK_CONTROLLERS_TS = `import type { Context } from "@oak/oak";
import { UserService } from "./services.ts";

const userService = new UserService();

export function root(ctx: Context) {
  ctx.response.body = { message: "Hello from Oak!" };
}

export function listUsers(ctx: Context) {
  ctx.response.body = userService.listUsers();
}
`;

/** A small example of where cross-cutting concerns (auth, rate limiting, request IDs, ...) belong — as their own middleware, registered once in main.ts, instead of copy-pasted into every controller. */
const OAK_MIDDLEWARE_TS = `import type { Context } from "@oak/oak";

export async function logging(ctx: Context, next: () => Promise<unknown>) {
  const start = Date.now();
  await next();
  const elapsedMs = Date.now() - start;
  console.log(\`\${ctx.request.method} \${ctx.request.url.pathname} (\${elapsedMs}ms)\`);
}
`;

const OAK_ROUTES_TS = `import { Router } from "@oak/oak";
import { listUsers, root } from "./controllers.ts";

export const router = new Router();
router.get("/", root);
router.get("/users", listUsers);
`;

const OAK_MAIN_TS = `import { Application } from "@oak/oak";
import { logging } from "./src/middleware.ts";
import { router } from "./src/routes.ts";

const app = new Application();
app.use(logging);
app.use(router.routes());
app.use(router.allowedMethods());

const port = Number(Deno.env.get("PORT") ?? 8000);
console.log(\`Server running at http://localhost:\${port}\`);
await app.listen({ port });
`;

/**
 * Oak has no official project-scaffolding CLI (it's a middleware framework,
 * like Express) — this writes deno.json + main.ts by hand instead, the same
 * exception already made for Express/Fastify/Go above. deno.json's own
 * "imports" map (via JSR) is Deno's equivalent of package.json dependencies —
 * Deno resolves and caches them on first `deno run`/`deno task`, so there's
 * no separate install step (options.install is forced off in prompts.js for
 * this runtime, same as Rust/Flutter). A missing Deno here is a soft
 * warning, not a hard failure — the files are still useful once it's
 * installed, unlike Laravel/Rails above.
 *
 * main.ts stays thin (wiring only) — routes/controllers/services/models/
 * middleware are split the same layered way Go's handler gets in
 * backend-go.js, adapted to Deno/TS. `GET /users` is real and working
 * end-to-end (controller → service), not a stub.
 */
export async function handleDenoOakBackend(options, warnings) {
  const { targetDir } = options;
  await fs.ensureDir(targetDir);

  await fs.outputFile(path.join(targetDir, 'deno.json'), OAK_DENO_JSON);
  await fs.outputFile(path.join(targetDir, 'main.ts'), OAK_MAIN_TS);
  await fs.outputFile(path.join(targetDir, 'src', 'routes.ts'), OAK_ROUTES_TS);
  await fs.outputFile(path.join(targetDir, 'src', 'controllers.ts'), OAK_CONTROLLERS_TS);
  await fs.outputFile(path.join(targetDir, 'src', 'services.ts'), OAK_SERVICES_TS);
  await fs.outputFile(path.join(targetDir, 'src', 'models.ts'), OAK_MODELS_TS);
  await fs.outputFile(path.join(targetDir, 'src', 'middleware.ts'), OAK_MIDDLEWARE_TS);
  await fs.writeFile(path.join(targetDir, '.gitignore'), '.env\n');

  logger.dim('  › Wrote deno.json + main.ts + src/{routes,controllers,services,models,middleware}.ts by hand (Oak has no official project scaffolder).');

  const denoFound = await checkToolchain('deno', ['--version']);
  if (!denoFound) {
    warnings.push(missingToolchainWarning('Deno', 'https://docs.deno.com/runtime/getting_started/installation/'));
  } else {
    warnings.push('Deno resolves and caches JSR/npm imports on first run — run "deno task dev" to fetch Oak and start the server.');
  }

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'deno', startCommand: 'deno run --allow-net --allow-env main.ts', port: 8000 });
  }
}
