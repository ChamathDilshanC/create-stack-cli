import path from 'node:path';
import fs from 'fs-extra';
import ora from 'ora';

/**
 * Feature-sliced, enterprise-style layout generated under a React/Vue
 * project's src/. Listed as full relative paths (not a nested tree) so every
 * level — including intermediate ones like `features` itself — gets created
 * and gitkept explicitly, exactly as asked for.
 */
export const ENTERPRISE_DIRECTORIES = [
  'assets',
  'components',
  'config',
  'features',
  'features/auth',
  'features/auth/api',
  'features/auth/components',
  'features/auth/hooks',
  'features/dashboard',
  'hooks',
  'layouts',
  'pages',
  'routes',
  'services',
  'store',
  'utils',
];

/**
 * Creates the enterprise src/ layout and drops a .gitkeep in every directory
 * — Git doesn't track empty directories, so without one, `features/auth/hooks`
 * and friends would silently vanish for anyone who clones the project fresh.
 *
 * Non-fatal: `fs.mkdirSync(..., { recursive: true })` is already idempotent
 * (no throw if a directory exists — create-vite's own templates already ship
 * src/assets and, for Vue, src/components), but a real failure here — a file
 * occupying one of these path segments, a permissions error — is reported as
 * a warning rather than unwinding a scaffold that has otherwise succeeded.
 */
export async function generateEnterpriseStructure(options, warnings) {
  const spinner = ora({ text: 'Generating enterprise folder structure...', indent: 2 }).start();
  const srcDir = path.join(options.targetDir, 'src');

  try {
    for (const rel of ENTERPRISE_DIRECTORIES) {
      const dirPath = path.join(srcDir, rel);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, '.gitkeep'), '');
    }
    spinner.succeed(
      `Enterprise folder structure generated (${ENTERPRISE_DIRECTORIES.length} directories).`
    );
  } catch (err) {
    spinner.fail('Enterprise folder structure could not be fully generated.');
    warnings.push(
      `Some src/ feature folders may be missing — ${err.message}. You can create them manually if needed.`
    );
  }
}
