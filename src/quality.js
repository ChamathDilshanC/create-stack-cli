import path from 'node:path';
import fs from 'fs-extra';

import { installOrRecord } from './scaffold-utils.js';

/* ------------------------------------------------------------------ */
/* ESLint + Prettier                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generic flat ESLint config for frameworks without an official ESLint flag
 * of their own (React/Next.js/SvelteKit pass their own `--eslint` at scaffold
 * time instead — see scaffold.js's handlers, which skip calling this).
 */
async function writeEslintConfig(options, warnings, depsAlreadyPresent) {
  const { targetDir, language, framework } = options;
  const isTs = language === 'ts';
  const isVueFamily = framework === 'vue' || framework === 'nuxt';

  const deps = {
    eslint: '^9.0.0',
    '@eslint/js': '^9.0.0',
    globals: '^15.0.0',
  };
  const imports = ["import js from '@eslint/js';", "import globals from 'globals';"];
  const configParts = ['js.configs.recommended'];

  if (isTs) {
    imports.push("import tseslint from 'typescript-eslint';");
    configParts.push('...tseslint.configs.recommended');
    deps['typescript-eslint'] = '^8.0.0';
  }
  if (isVueFamily) {
    imports.push("import pluginVue from 'eslint-plugin-vue';");
    configParts.push("...pluginVue.configs['flat/recommended']");
    deps['eslint-plugin-vue'] = '^9.28.0';
  }

  const content = `${imports.join('\n')}

export default [
  { ignores: ['dist', 'dist/**', 'build/**', '.nuxt/**', '.output/**', '**/*.d.ts'] },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  ${configParts.join(',\n  ')},
];
`;

  await fs.writeFile(path.join(targetDir, 'eslint.config.js'), content);
  // Some scaffolders (create-hono's nodejs template) already list these
  // exact packages in package.json without any config file — re-requesting
  // a live install of packages npm considers already-satisfied can trigger
  // an ERESOLVE conflict, so only the (idempotent, already-a-no-op-if-present)
  // package.json merge runs, never a live install, in that case.
  if (depsAlreadyPresent) {
    await installOrRecord({ options: { ...options, install: false }, warnings, packages: Object.keys(deps), floors: deps, dev: true, label: 'ESLint' });
  } else {
    await installOrRecord({ options, warnings, packages: Object.keys(deps), floors: deps, dev: true, label: 'ESLint' });
  }
}

async function writePrettierConfig(options, warnings, depsAlreadyPresent) {
  await fs.writeJson(
    path.join(options.targetDir, '.prettierrc.json'),
    { semi: true, singleQuote: true, trailingComma: 'all', printWidth: 80 },
    { spaces: 2 }
  );
  await fs.writeFile(path.join(options.targetDir, '.prettierignore'), 'dist\nbuild\nnode_modules\ncoverage\n');
  const installOptions = depsAlreadyPresent ? { ...options, install: false } : options;
  await installOrRecord({ options: installOptions, warnings, packages: ['prettier'], floors: { prettier: '^3.0.0' }, dev: true, label: 'Prettier' });
}

/* ------------------------------------------------------------------ */
/* Biome — a single fast tool replacing both ESLint and Prettier        */
/* ------------------------------------------------------------------ */

const BIOME_CONFIG = `{
  "$schema": "https://biomejs.dev/schemas/2.5.4/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": false },
  "formatter": { "enabled": true, "indentStyle": "space" },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single" } }
}
`;

async function setupBiome(options, warnings) {
  await installOrRecord({
    options,
    warnings,
    packages: ['@biomejs/biome'],
    floors: { '@biomejs/biome': '^2.0.0' },
    dev: true,
    label: 'Biome',
  });
  await fs.writeFile(path.join(options.targetDir, 'biome.json'), BIOME_CONFIG);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * `eslintHandledInline`/`prettierHandledInline` let a handler that already
 * passed the framework's own official flag (create-vite --eslint, Next.js
 * --eslint, sv create --add eslint prettier) or that scaffolds a framework
 * which always ships its own config regardless (NestJS) skip redoing it here.
 * `depsAlreadyPresent` (create-hono: packages included, no config file) still
 * writes the config but never attempts to reinstall those exact packages.
 */
export async function applyQuality(
  options,
  warnings,
  { eslintHandledInline = false, prettierHandledInline = false, depsAlreadyPresent = false } = {}
) {
  if (options.quality === 'eslint-prettier') {
    if (!eslintHandledInline) await writeEslintConfig(options, warnings, depsAlreadyPresent);
    if (!prettierHandledInline) await writePrettierConfig(options, warnings, depsAlreadyPresent);
    return;
  }
  if (options.quality === 'biome') {
    return setupBiome(options, warnings);
  }
}
