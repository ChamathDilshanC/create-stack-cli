import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_ROOT = path.resolve(__dirname, '../templates');

/** Files that must be renamed on copy because npm mishandles them inside a package. */
const RENAME_MAP = {
  gitignore: '.gitignore',
  _gitignore: '.gitignore',
  '_package.json': 'package.json',
};

/** CSS entry point that Tailwind's directives get injected into, per framework. */
const CSS_ENTRY = {
  react: 'src/index.css',
  vue: 'src/style.css',
  vanilla: 'src/style.css',
  angular: 'src/styles.css',
};

export function templateDirFor(variant) {
  return path.join(TEMPLATES_ROOT, variant);
}

export function templateExists(variant) {
  return fs.existsSync(templateDirFor(variant));
}

/** Template-only directories that exist to support scaffolding but should never ship in the generated project. */
const TEMPLATE_ONLY_ENTRIES = new Set(['tailwind-overrides']);

/** Copies every file from the template into the target dir, renaming special-cased files. */
export async function copyTemplateFiles(templateDir, targetDir) {
  await fs.ensureDir(targetDir);
  const entries = await fs.readdir(templateDir);

  await Promise.all(
    entries
      .filter((entry) => !TEMPLATE_ONLY_ENTRIES.has(entry))
      .map(async (entry) => {
        const src = path.join(templateDir, entry);
        const destName = RENAME_MAP[entry] ?? entry;
        const dest = path.join(targetDir, destName);
        await fs.copy(src, dest);
      })
  );
}

/** Sets the generated package.json's name and merges in any extras' devDependencies. */
export async function writePackageJson(targetDir, options) {
  const pkgPath = path.join(targetDir, 'package.json');
  const pkg = await fs.readJson(pkgPath);

  pkg.name = options.packageName;

  const extraDeps = buildExtraDevDependencies(options);
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), ...extraDeps };

  await fs.writeJson(pkgPath, pkg, { spaces: 2 });
}

function buildExtraDevDependencies(options) {
  const deps = {};
  const isTs = options.language === 'ts';

  if (options.extras.includes('tailwind') && options.framework !== 'angular') {
    Object.assign(deps, {
      tailwindcss: '^3.4.13',
      postcss: '^8.4.47',
      autoprefixer: '^10.4.20',
    });
  }
  if (options.extras.includes('tailwind') && options.framework === 'angular') {
    Object.assign(deps, { tailwindcss: '^3.4.13' });
  }

  if (options.extras.includes('eslint')) {
    Object.assign(deps, {
      eslint: '^9.12.0',
      '@eslint/js': '^9.12.0',
      globals: '^15.11.0',
    });
    if (isTs) {
      Object.assign(deps, { 'typescript-eslint': '^8.8.1' });
    }
    if (options.framework === 'react') {
      Object.assign(deps, {
        'eslint-plugin-react-hooks': '^5.0.0',
        'eslint-plugin-react-refresh': '^0.4.12',
      });
    }
    if (options.framework === 'vue') {
      Object.assign(deps, { 'eslint-plugin-vue': '^9.28.0' });
    }
  }

  if (options.extras.includes('prettier')) {
    Object.assign(deps, { prettier: '^3.3.3' });
    if (options.extras.includes('eslint')) {
      Object.assign(deps, { 'eslint-config-prettier': '^9.1.0' });
    }
  }

  return deps;
}

/** Applies the selected extras (Tailwind / ESLint / Prettier) on top of the copied template. */
export async function applyExtras(templateDir, targetDir, options) {
  if (options.extras.includes('tailwind')) {
    await addTailwind(templateDir, targetDir, options);
  }
  if (options.extras.includes('eslint')) {
    await addEslint(targetDir, options);
  }
  if (options.extras.includes('prettier')) {
    await addPrettier(targetDir, options);
  }
}

async function addTailwind(templateDir, targetDir, options) {
  const isAngular = options.framework === 'angular';

  await fs.writeFile(
    path.join(targetDir, 'tailwind.config.js'),
    `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,vue,html}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
`
  );

  // Angular's CLI auto-detects a root tailwind.config.js and wires up PostCSS itself.
  if (!isAngular) {
    await fs.writeFile(
      path.join(targetDir, 'postcss.config.js'),
      `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`
    );
  }

  const cssRelPath = CSS_ENTRY[options.framework];
  const cssPath = path.join(targetDir, cssRelPath);
  const directives = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n';

  await fs.ensureDir(path.dirname(cssPath));
  if (await fs.pathExists(cssPath)) {
    const existing = await fs.readFile(cssPath, 'utf-8');
    await fs.writeFile(cssPath, `${directives}\n${existing}`);
  } else {
    await fs.writeFile(cssPath, directives);
  }

  // Swap the starter component for a version actually styled with Tailwind
  // utility classes, so the scaffold doesn't ship with an unused config.
  const overridesDir = path.join(templateDir, 'tailwind-overrides');
  if (await fs.pathExists(overridesDir)) {
    await fs.copy(overridesDir, targetDir, { overwrite: true });
  }
}

async function addEslint(targetDir, options) {
  const isTs = options.language === 'ts';
  const lines = [
    "import js from '@eslint/js';",
    "import globals from 'globals';",
  ];
  const configParts = ["js.configs.recommended"];

  if (isTs) {
    lines.push("import tseslint from 'typescript-eslint';");
    configParts.push('...tseslint.configs.recommended');
  }
  if (options.framework === 'react') {
    lines.push("import reactHooks from 'eslint-plugin-react-hooks';");
    lines.push("import reactRefresh from 'eslint-plugin-react-refresh';");
  }
  if (options.framework === 'vue') {
    lines.push("import pluginVue from 'eslint-plugin-vue';");
    configParts.push('...pluginVue.configs["flat/recommended"]');
  }

  const reactBlock =
    options.framework === 'react'
      ? `,\n  {\n    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },\n    rules: {\n      ...reactHooks.configs.recommended.rules,\n      'react-refresh/only-export-components': 'warn',\n    },\n  }`
      : '';

  const content = `${lines.join('\n')}

export default [
  { ignores: ['dist', 'dist/**', '**/*.d.ts'] },
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  ${configParts.join(',\n  ')}${reactBlock},
];
`;

  await fs.writeFile(path.join(targetDir, 'eslint.config.js'), content);
}

async function addPrettier(targetDir) {
  await fs.writeJson(
    path.join(targetDir, '.prettierrc.json'),
    {
      semi: true,
      singleQuote: true,
      trailingComma: 'all',
      printWidth: 80,
    },
    { spaces: 2 }
  );
  await fs.writeFile(
    path.join(targetDir, '.prettierignore'),
    'dist\nnode_modules\ncoverage\n'
  );
}

export async function scaffoldProject(options) {
  const templateDir = templateDirFor(options.variant);
  if (!fs.existsSync(templateDir)) {
    throw new Error(`No template found for "${options.variant}".`);
  }

  await copyTemplateFiles(templateDir, options.targetDir);
  await writePackageJson(options.targetDir, options);
  await applyExtras(templateDir, options.targetDir, options);
}
