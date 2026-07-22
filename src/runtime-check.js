import { execa } from 'execa';

/**
 * Generalizes python-utils.js's findPythonCommand for every non-Node runtime
 * added since (Go/PHP/Ruby/.NET/Deno/Kotlin/Gradle) — each needs its own
 * toolchain already installed and on PATH before scaffolding can run at all
 * (unlike the Node ecosystem, where npx fetches a scaffolder on demand).
 * Cached per command so a missing/present result is only probed once per run.
 */
const cache = new Map();

/**
 * Probes `command --versionArgs`. Resolves `true`/`false` — never throws —
 * so callers can decide what to do (skip a live scaffold step, write
 * hand-written files anyway, abort with instructions) rather than this
 * helper picking that policy for them.
 */
export async function checkToolchain(command, versionArgs = ['--version']) {
  const key = `${command} ${versionArgs.join(' ')}`;
  if (cache.has(key)) return cache.get(key);

  const result = (async () => {
    try {
      await execa(command, versionArgs, { stdin: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  cache.set(key, result);
  return result;
}

/** A consistent "install this first" message shape for the final summary's warnings. */
export function missingToolchainWarning(label, installHint) {
  return `${label} was not found on PATH — install it first (${installHint}), then finish scaffolding by hand using the commands noted above.`;
}
