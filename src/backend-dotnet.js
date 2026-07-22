import path from 'node:path';

import { applyDocker } from './docker.js';
import { checkToolchain } from './runtime-check.js';
import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';

/** .NET project/namespace names: letters, digits, underscore; must start with a letter or underscore — C#'s own identifier rules, not npm's. */
function toDotnetProjectName(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-zA-Z_]/.test(base) ? base || 'App' : `App_${base}`;
}

/**
 * `dotnet new webapi` is the .NET SDK's own official template — same
 * category as `ng new`/`flutter create`/`rails new`: a real local toolchain
 * that must already be on PATH, so a missing one hard-fails the scaffold
 * with a clear message instead of a soft warning. Left at the SDK's own
 * current default (minimal APIs, built-in OpenAPI on recent SDKs) rather
 * than forcing --use-controllers, the same "use the official tool's own
 * defaults" philosophy the Vite/Next.js/Nuxt handlers already follow.
 *
 * `--no-restore` keeps this in line with prompts.js's stepInstall (forced
 * off for this runtime) — NuGet packages restore lazily on the first
 * `dotnet build`/`dotnet run`, the same "no separate install step" story as
 * Rust/Cargo and Flutter/pub.
 *
 * The generic JS-shaped enterprise structure is skipped — a fresh
 * `dotnet new webapi` project is intentionally minimal (Program.cs,
 * appsettings.json), and ASP.NET Core's own Controllers/Models conventions
 * are PascalCase and namespace-bound, not a good fit for the generic
 * lowercase folder set the same way Spring Boot's Java-shaped layout skip
 * already reasons about.
 */
export async function handleDotnetBackend(options, warnings) {
  const { targetDir, packageName } = options;

  const dotnetFound = await checkToolchain('dotnet', ['--version']);
  if (!dotnetFound) {
    throw new Error(
      'The .NET SDK was not found on PATH. ASP.NET Core has no scaffolder other than "dotnet new webapi" — ' +
        'install the .NET SDK first (https://dotnet.microsoft.com/download), then re-run this scaffold.'
    );
  }

  const projectName = toDotnetProjectName(packageName);
  const { cwd, dirArg } = await scaffolderInvocation(targetDir);

  await runScaffolder({
    label: 'Scaffolding ASP.NET Core project with dotnet new webapi...',
    success: 'ASP.NET Core project scaffolded.',
    command: 'dotnet',
    args: ['new', 'webapi', '-n', projectName, '-o', dirArg, '--no-restore'],
    cwd,
    expectFile: path.join(targetDir, `${projectName}.csproj`),
  });

  warnings.push('NuGet packages restore automatically on the first "dotnet run"/"dotnet build" — no separate install step was needed.');

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'dotnet', projectName, port: 5000 });
  }
}
