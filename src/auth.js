import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';

import { appendEnvVars } from './env.js';
import { installOrRecord } from './scaffold-utils.js';

/** Human labels for the warning path — kept local rather than importing prompts.js's AUTH_OPTIONS, since this module only ever needs these three. */
const NOT_YET_WIRED_LABELS = {
  clerk: 'Clerk',
  lucia: 'Lucia',
  passport: 'Passport',
};

function generateAuthSecret() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Shared between Next.js and Express below — a Credentials provider with a
 * deliberate placeholder `authorize()`. JWT sessions (not a database
 * adapter) keep Auth.js decoupled from whatever the separate Database
 * question answered — wiring a real adapter is its own follow-up, not this
 * step's scope. Returning `null` is intentional: it means nobody can
 * actually log in until this is replaced with a real lookup, rather than
 * silently authenticating everyone.
 */
const CREDENTIALS_PROVIDER_SNIPPET = `    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // Replace this with a real lookup against your own database/ORM —
        // returning null here means nobody can actually log in yet.
        return null;
      },
    }),`;

const NEXT_AUTH_CONFIG = `import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
${CREDENTIALS_PROVIDER_SNIPPET}
  ],
  session: { strategy: 'jwt' },
});
`;

const NEXT_AUTH_ROUTE = `import { handlers } from '@/auth';

export const { GET, POST } = handlers;
`;

/**
 * Auth.js v5 (the App-Router-native `auth.ts` + `handlers` shape every
 * current guide uses, and the only shape that fits this CLI's Next.js
 * output — runNextCreate always scaffolds with --app) is still beta-only on
 * npm: the `latest` dist-tag is next-auth@4 (a different, Pages-Router-era
 * API). Installing plain "next-auth" would silently resolve v4 and produce
 * a v4 package against v5-shaped generated code, so this explicitly installs
 * the `@beta` dist-tag and pins the offline-fallback floor to a concrete
 * prerelease version rather than a bare "^5.0.0" (which v4 would also
 * satisfy under npm's normal, non-prerelease range rules).
 */
async function setupNextAuth(options, warnings) {
  const { targetDir, language } = options;
  const ext = language === 'ts' ? 'ts' : 'js';

  await installOrRecord({
    options,
    warnings,
    packages: ['next-auth@beta'],
    floors: { 'next-auth': '5.0.0-beta.31' },
    dev: false,
    label: 'Auth.js (next-auth)',
  });

  await fs.outputFile(path.join(targetDir, `auth.${ext}`), NEXT_AUTH_CONFIG);
  await fs.outputFile(path.join(targetDir, 'app', 'api', 'auth', '[...nextauth]', `route.${ext}`), NEXT_AUTH_ROUTE);

  await appendEnvVars(
    targetDir,
    { AUTH_SECRET: generateAuthSecret() },
    { AUTH_SECRET: 'REPLACE_WITH_PRODUCTION_AUTH_SECRET' }
  );

  warnings.push(
    'Auth.js was wired with a Credentials provider and JWT sessions — auth.ts\'s authorize() is a placeholder that never logs anyone in; replace it with a real lookup against your database.'
  );
}

const EXPRESS_AUTH_ROUTER = `import { ExpressAuth } from '@auth/express';
import Credentials from '@auth/express/providers/credentials';

export const authRouter = ExpressAuth({
  providers: [
${CREDENTIALS_PROVIDER_SNIPPET}
  ],
  session: { strategy: 'jwt' },
});
`;

/**
 * @auth/express is Auth.js's own official Express integration (ExpressAuth +
 * @auth/express/providers/<name>, mirroring next-auth/providers/<name>'s
 * shape) — unlike Next.js above, this is on npm's regular `latest` tag, no
 * beta pinning needed. Written as its own src/auth.<ext> file rather than
 * string-patching scaffold.js's hand-written server.<ext> template: editing
 * another module's generated file by string replacement is exactly the kind
 * of fragile coupling that breaks silently if that template's text ever
 * changes, so this pushes a two-line manual-mount instruction instead — the
 * same "tell them the exact command" fallback this CLI already uses for
 * Prisma's manual init path.
 */
async function setupExpressAuth(options, warnings) {
  const { targetDir, language } = options;
  const ext = language === 'ts' ? 'ts' : 'js';

  await installOrRecord({
    options,
    warnings,
    packages: ['@auth/express'],
    floors: { '@auth/express': '^0.12.0' },
    dev: false,
    label: 'Auth.js (@auth/express)',
  });

  await fs.outputFile(path.join(targetDir, 'src', `auth.${ext}`), EXPRESS_AUTH_ROUTER);

  await appendEnvVars(
    targetDir,
    { AUTH_SECRET: generateAuthSecret() },
    { AUTH_SECRET: 'REPLACE_WITH_PRODUCTION_AUTH_SECRET' }
  );

  warnings.push(
    `Auth.js was wired into src/auth.${ext} (a Credentials provider, JWT sessions, a placeholder authorize()) but not auto-mounted — add ` +
      `"import { authRouter } from './auth.js';" near the top of src/server.${ext} and "app.use('/auth/*', authRouter);" right after ` +
      '"const app = express();" to wire it in.'
  );
}

/**
 * Only Next.js and Express have real Auth.js scaffolding behind them —
 * every other backend/fullstack framework still accepts the choice (so the
 * question itself reflects where this CLI is headed) but gets a "not yet
 * wired" warning instead of a real setup, the same "full menu, one real
 * implementation" story testing.js already tells for Jest/Playwright/
 * Cypress.
 */
export async function applyAuth(options, warnings) {
  if (!options.auth || options.auth === 'none') return;

  if (options.auth !== 'authjs') {
    const label = NOT_YET_WIRED_LABELS[options.auth] ?? options.auth;
    warnings.push(`${label} was selected for authentication but isn't wired up in this CLI yet — install it yourself, or re-run and pick Auth.js/None.`);
    return;
  }

  if (options.framework === 'next') return setupNextAuth(options, warnings);
  if (options.framework === 'express') return setupExpressAuth(options, warnings);

  warnings.push(
    `Auth.js was selected but isn't wired up yet for ${options.framework} in this CLI — Next.js and Express are the only frameworks with real Auth.js scaffolding so far.`
  );
}
