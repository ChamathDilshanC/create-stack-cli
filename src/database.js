import path from 'node:path';
import fs from 'fs-extra';

import { installOrRecord, tryRun } from './scaffold-utils.js';

/* ------------------------------------------------------------------ */
/* Prisma — has a real official scaffolding command (`prisma init`)    */
/* ------------------------------------------------------------------ */

async function setupPrisma(options, warnings) {
  await installOrRecord({
    options,
    warnings,
    packages: ['prisma'],
    floors: { prisma: '^7.0.0' },
    dev: true,
    label: 'Prisma CLI',
  });
  await installOrRecord({
    options,
    warnings,
    packages: ['@prisma/client'],
    floors: { '@prisma/client': '^7.0.0' },
    dev: false,
    label: 'Prisma Client',
  });

  // npx resolves `prisma` on demand regardless of whether the install above
  // actually ran (--no-install / offline), same as every other npx-based
  // scaffolder in this CLI.
  const ok = await tryRun({
    label: 'Initializing Prisma...',
    success: 'Prisma initialized (prisma/schema.prisma).',
    failure: 'Prisma initialization could not run.',
    command: 'npx',
    args: ['prisma', 'init', '--datasource-provider', 'sqlite', '--with-model'],
    cwd: options.targetDir,
  });
  if (!ok) {
    warnings.push('Run "npx prisma init" manually inside the project to finish Prisma setup.');
  }
}

/* ------------------------------------------------------------------ */
/* Drizzle ORM — no official file-scaffolding command, so this is      */
/* written by hand: config + a starter schema + a db client.           */
/* ------------------------------------------------------------------ */

const drizzleConfig = (schemaRelPath) => `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './${schemaRelPath}/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./local.db',
  },
});
`;

const drizzleSchema = `import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
});
`;

const drizzleClient = `import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';

const sqlite = new Database((process.env.DATABASE_URL ?? 'file:./local.db').replace(/^file:/, ''));
export const db = drizzle(sqlite, { schema });
`;

async function setupDrizzle(options, warnings, modelsDir) {
  const { targetDir, language } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';

  await installOrRecord({
    options,
    warnings,
    packages: ['drizzle-orm', 'better-sqlite3'],
    floors: { 'drizzle-orm': '^0.45.0', 'better-sqlite3': '^12.0.0' },
    dev: false,
    label: 'Drizzle ORM',
  });
  const devDeps = { 'drizzle-kit': '^0.31.0' };
  if (isTs) devDeps['@types/better-sqlite3'] = '^7.6.0';
  await installOrRecord({
    options,
    warnings,
    packages: Object.keys(devDeps),
    floors: devDeps,
    dev: true,
    label: 'Drizzle Kit',
  });

  // path.join produces backslashes on Windows — fine for real filesystem
  // calls, but this one is embedded as a literal string inside generated
  // source, which always expects forward slashes regardless of host OS.
  await fs.writeFile(path.join(targetDir, 'drizzle.config.ts'), drizzleConfig(modelsDir.split(path.sep).join('/')));
  await fs.outputFile(path.join(targetDir, modelsDir, `schema.${ext}`), drizzleSchema);
  await fs.outputFile(path.join(targetDir, modelsDir, `index.${ext}`), drizzleClient);
  await fs.outputFile(
    path.join(targetDir, '.env'),
    `${(await fs.pathExists(path.join(targetDir, '.env'))) ? await fs.readFile(path.join(targetDir, '.env'), 'utf8') : ''}DATABASE_URL="file:./local.db"\n`
  );
}

/* ------------------------------------------------------------------ */
/* Mongoose — no scaffolding CLI at all; connection + a starter model.  */
/* ------------------------------------------------------------------ */

const mongooseConnection = (isTs) => `import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/app';

export async function connectDB()${isTs ? ': Promise<typeof mongoose>' : ''} {
  return mongoose.connect(MONGODB_URI);
}
`;

const mongooseUserModel = (isTs) => `import mongoose, { Schema${isTs ? ', type InferSchemaType' : ''} } from 'mongoose';

const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

${isTs ? 'export type User = InferSchemaType<typeof userSchema>;\n\n' : ''}export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
`;

async function setupMongoose(options, warnings, modelsDir) {
  const { targetDir, language } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';

  await installOrRecord({
    options,
    warnings,
    packages: ['mongoose'],
    floors: { mongoose: '^9.0.0' },
    dev: false,
    label: 'Mongoose',
  });

  await fs.outputFile(path.join(targetDir, modelsDir, `connection.${ext}`), mongooseConnection(isTs));
  await fs.outputFile(path.join(targetDir, modelsDir, `User.${ext}`), mongooseUserModel(isTs));
  await fs.outputFile(
    path.join(targetDir, '.env'),
    `${(await fs.pathExists(path.join(targetDir, '.env'))) ? await fs.readFile(path.join(targetDir, '.env'), 'utf8') : ''}MONGODB_URI="mongodb://localhost:27017/${options.packageName}"\n`
  );
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * `modelsDir` (relative to targetDir, e.g. "src/schema" or "src/models") is
 * decided by the caller — it already knows the framework's own directory
 * conventions (NestJS/Express/Fastify use src/, Next.js may or may not).
 * Prisma ignores it: its own convention is always a root-level prisma/.
 */
export async function applyDatabase(options, warnings, { modelsDir }) {
  if (options.database === 'prisma') return setupPrisma(options, warnings);
  if (options.database === 'drizzle') return setupDrizzle(options, warnings, modelsDir);
  if (options.database === 'mongoose') return setupMongoose(options, warnings, modelsDir);
}
