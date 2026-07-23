import https from 'node:https';
import { createRequire } from 'node:module';
import pc from 'picocolors';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

/** Long enough for a normal registry round-trip, short enough that a slow/blocked network never meaningfully delays startup. */
const REGISTRY_TIMEOUT_MS = 1500;

/**
 * A plain `GET`, deliberately not built on the global `fetch` — fetch's
 * underlying connection pool keeps a keep-alive socket (and its libuv
 * handle) open past the response for reuse, and this call runs so early
 * that a command exiting immediately after (`--version`, `--help`, or any
 * error thrown before scaffolding starts — all of which call
 * `process.exit()`) can race that handle's teardown and crash the process
 * on Windows. `agent: false` opts this single request out of pooling
 * entirely, so the socket is fully closed before this function's promise
 * ever resolves — nothing left open for a later `process.exit()` to race.
 */
function fetchLatestVersion(packageName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      { agent: false, timeout: timeoutMs, headers: { accept: 'application/json' } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume(); // drain so the socket can still close cleanly
          reject(new Error(`registry responded with ${res.statusCode}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('registry request timed out')));
    req.on('error', reject);
  });
}

/** True when `latest` is a newer major.minor.patch than `current` — this package's own releases never use prerelease tags, so a plain numeric compare is all that's needed. */
function isNewer(latest, current) {
  const parse = (v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [lMajor, lMinor, lPatch] = parse(latest);
  const [cMajor, cMinor, cPatch] = parse(current);
  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

/**
 * Best-effort npm registry check, meant to run once at the very start of the
 * CLI (see index.js's main()) — before the banner/prompts, so the warning
 * (if any) is the first thing a user sees. Bounded by a short timeout and
 * never throws: offline, a registry hiccup, or a corporate proxy blocking
 * the request must never delay or break scaffolding, so any failure here is
 * swallowed silently instead of surfacing to the user.
 */
export async function checkForUpdate() {
  try {
    const data = await fetchLatestVersion(pkg.name, REGISTRY_TIMEOUT_MS);
    const latest = data.version;
    if (typeof latest !== 'string' || !isNewer(latest, pkg.version)) return;

    console.log();
    console.log(pc.yellow(`  ! Update available: ${pc.dim(pkg.version)} ${pc.dim('→')} ${pc.green(latest)}`));
    console.log(pc.dim(`  Run npx ${pkg.name}@latest next time to get the newest version.`));
    console.log();
  } catch {
    // offline, timed out, or a malformed response — nothing to warn about
  }
}
