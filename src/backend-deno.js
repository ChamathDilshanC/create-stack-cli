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

const OAK_MAIN_TS = `import { Application, Router } from "@oak/oak";

const router = new Router();
router.get("/", (ctx) => {
  ctx.response.body = { message: "Hello from Oak!" };
});

const app = new Application();
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
 */
export async function handleDenoOakBackend(options, warnings) {
  const { targetDir } = options;
  await fs.ensureDir(targetDir);

  await fs.outputFile(path.join(targetDir, 'deno.json'), OAK_DENO_JSON);
  await fs.outputFile(path.join(targetDir, 'main.ts'), OAK_MAIN_TS);
  await fs.writeFile(path.join(targetDir, '.gitignore'), '.env\n');

  logger.dim('  › Wrote deno.json + main.ts by hand (Oak has no official project scaffolder).');

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
