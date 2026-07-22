import path from 'node:path';
import fs from 'fs-extra';

import { applyDocker } from './docker.js';
import { checkToolchain } from './runtime-check.js';
import { logger } from './utils.js';
import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';

/** .NET project/namespace names: letters, digits, underscore; must start with a letter or underscore — C#'s own identifier rules, not npm's. */
function toDotnetProjectName(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-zA-Z_]/.test(base) ? base || 'App' : `App_${base}`;
}

const userModelCs = (ns) => `namespace ${ns}.Models;

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}
`;

const userRepositoryInterfaceCs = (ns) => `using ${ns}.Models;

namespace ${ns}.Repositories;

public interface IUserRepository
{
    IEnumerable<User> GetAll();
}
`;

/** In-memory on purpose: this step doesn't force a database choice — swap this for a real database-backed implementation once you've picked one; nothing above this layer needs to change to do that. */
const userRepositoryCs = (ns) => `using System.Collections.Concurrent;
using ${ns}.Models;

namespace ${ns}.Repositories;

public class UserRepository : IUserRepository
{
    private readonly ConcurrentDictionary<int, User> _users = new();

    public UserRepository()
    {
        _users[1] = new User { Id = 1, Name = "Ada Lovelace", Email = "ada@example.com" };
    }

    public IEnumerable<User> GetAll() => _users.Values;
}
`;

const greetingServiceInterfaceCs = (ns) => `namespace ${ns}.Services;

public interface IGreetingService
{
    string Greet(string name);
}
`;

const greetingServiceCs = (ns) => `namespace ${ns}.Services;

public class GreetingService : IGreetingService
{
    public string Greet(string name) => $"Hello, {name}!";
}
`;

/** A small example of where cross-cutting concerns (auth, rate limiting, request IDs, ...) belong — as their own middleware, registered once in Program.cs, instead of copy-pasted into every controller action. */
const requestLoggingMiddlewareCs = (ns) => `namespace ${ns}.Middleware;

public class RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var start = DateTime.UtcNow;
        await next(context);
        var elapsedMs = (DateTime.UtcNow - start).TotalMilliseconds;
        logger.LogInformation("{Method} {Path} ({ElapsedMs}ms)", context.Request.Method, context.Request.Path, elapsedMs);
    }
}
`;

/** Real, working end-to-end (controller → repository/service via DI), not a stub — the same "always have one working vertical slice" bar Spring's own Hello controller/service/dto chain sets in spring.js. */
const usersControllerCs = (ns) => `using Microsoft.AspNetCore.Mvc;
using ${ns}.Repositories;
using ${ns}.Services;

namespace ${ns}.Controllers;

[ApiController]
[Route("[controller]")]
public class UsersController(IUserRepository users, IGreetingService greeting) : ControllerBase
{
    [HttpGet]
    public IActionResult Get() => Ok(users.GetAll());

    [HttpGet("greeting")]
    public IActionResult Greeting([FromQuery] string name = "world") => Ok(new { message = greeting.Greet(name) });
}
`;

/**
 * `dotnet new webapi`'s Program.cs shape (confirmed against the installed
 * SDK directly, not assumed) has exactly two anchor lines this needs:
 * `builder.Services.AddControllers();` (where DI registrations for the new
 * repository/service belong) and `var app = builder.Build();` (right after
 * which the new middleware needs to be registered, before `app.Run()`).
 * Both are stable, official-template lines — not the kind of guesswork
 * string-patch avoided for Express's server.ts — but this still verifies
 * each anchor is actually present before touching the file, and warns
 * instead of guessing if a future SDK template changes its shape.
 */
async function wireProgramCs(targetDir, ns, warnings) {
  const programPath = path.join(targetDir, 'Program.cs');
  let content = await fs.readFile(programPath, 'utf8');

  const usings =
    `using ${ns}.Middleware;\n` +
    `using ${ns}.Repositories;\n` +
    `using ${ns}.Services;\n`;
  content = usings + content;

  const servicesAnchor = 'builder.Services.AddControllers();';
  if (content.includes(servicesAnchor)) {
    content = content.replace(
      servicesAnchor,
      `${servicesAnchor}\nbuilder.Services.AddSingleton<IUserRepository, UserRepository>();\nbuilder.Services.AddScoped<IGreetingService, GreetingService>();`
    );
  } else {
    warnings.push('Program.cs didn\'t look like the usual webapi template — register IUserRepository/IGreetingService with the DI container yourself.');
  }

  const buildAnchor = 'var app = builder.Build();';
  if (content.includes(buildAnchor)) {
    content = content.replace(buildAnchor, `${buildAnchor}\n\napp.UseMiddleware<RequestLoggingMiddleware>();`);
  } else {
    warnings.push('Program.cs didn\'t look like the usual webapi template — register RequestLoggingMiddleware with app.UseMiddleware<>() yourself.');
  }

  await fs.writeFile(programPath, content);
}

/**
 * Adds Models/Repositories/Services/Middleware on top of `dotnet new
 * webapi --use-controllers`'s own Controllers/ output — the same layering
 * every other backend in this CLI gets, spring.js's generateSpringStructure
 * (controller/service/repository/model) being the reference. `GET /users`
 * and `GET /users/greeting` are real and working end-to-end, wired through
 * the DI container in Program.cs, not stubs.
 */
async function applyDotnetLayeredStructure(options, warnings, ns) {
  const { targetDir } = options;

  await fs.outputFile(path.join(targetDir, 'Models', 'User.cs'), userModelCs(ns));
  await fs.outputFile(path.join(targetDir, 'Repositories', 'IUserRepository.cs'), userRepositoryInterfaceCs(ns));
  await fs.outputFile(path.join(targetDir, 'Repositories', 'UserRepository.cs'), userRepositoryCs(ns));
  await fs.outputFile(path.join(targetDir, 'Services', 'IGreetingService.cs'), greetingServiceInterfaceCs(ns));
  await fs.outputFile(path.join(targetDir, 'Services', 'GreetingService.cs'), greetingServiceCs(ns));
  await fs.outputFile(path.join(targetDir, 'Middleware', 'RequestLoggingMiddleware.cs'), requestLoggingMiddlewareCs(ns));
  await fs.outputFile(path.join(targetDir, 'Controllers', 'UsersController.cs'), usersControllerCs(ns));

  await wireProgramCs(targetDir, ns, warnings);

  logger.dim('  › Wrote Models/Repositories/Services/Middleware/Controllers/UsersController.cs by hand, wired through Program.cs\'s DI container.');
}

/**
 * `dotnet new webapi` is the .NET SDK's own official template — same
 * category as `ng new`/`flutter create`/`rails new`: a real local toolchain
 * that must already be on PATH, so a missing one hard-fails the scaffold
 * with a clear message instead of a soft warning.
 *
 * `--use-controllers` (rather than the SDK's newer minimal-API default) is
 * the one deliberate deviation from "use the official tool's own defaults"
 * elsewhere in this CLI — minimal APIs have nowhere for a Controllers/
 * layer to attach to, and Controllers + DI is the shape most real-world
 * ASP.NET Core APIs (and this CLI's own added Models/Services/Repositories
 * layers below) actually use.
 *
 * `--no-restore` keeps this in line with prompts.js's stepInstall (forced
 * off for this runtime) — NuGet packages restore lazily on the first
 * `dotnet build`/`dotnet run`, the same "no separate install step" story as
 * Rust/Cargo and Flutter/pub.
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
    args: ['new', 'webapi', '-n', projectName, '-o', dirArg, '--use-controllers', '--no-restore'],
    cwd,
    expectFile: path.join(targetDir, `${projectName}.csproj`),
  });

  await applyDotnetLayeredStructure(options, warnings, projectName);

  warnings.push('NuGet packages restore automatically on the first "dotnet run"/"dotnet build" — no separate install step was needed.');

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'dotnet', projectName, port: 5000 });
  }
}
