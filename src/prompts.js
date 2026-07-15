import path from 'node:path';
import prompts from 'prompts';
import pc from 'picocolors';
import {
  CancelledError,
  detectPackageManager,
  formatTargetDir,
  isValidPackageName,
  toValidPackageName,
} from './utils.js';

/**
 * Frameworks and the language variants each one supports.
 * Angular is TypeScript-only, matching how the Angular CLI itself works.
 */
export const FRAMEWORKS = [
  {
    name: 'react',
    display: 'React',
    color: pc.cyan,
    variants: [
      { name: 'react-ts', display: 'TypeScript', framework: 'react', language: 'ts' },
      { name: 'react-js', display: 'JavaScript', framework: 'react', language: 'js' },
    ],
  },
  {
    name: 'vue',
    display: 'Vue',
    color: pc.green,
    variants: [
      { name: 'vue-ts', display: 'TypeScript', framework: 'vue', language: 'ts' },
      { name: 'vue-js', display: 'JavaScript', framework: 'vue', language: 'js' },
    ],
  },
  {
    name: 'angular',
    display: 'Angular',
    color: pc.red,
    variants: [
      { name: 'angular-ts', display: 'TypeScript', framework: 'angular', language: 'ts' },
    ],
  },
  {
    name: 'vanilla',
    display: 'Vanilla',
    color: pc.yellow,
    variants: [
      { name: 'vanilla-ts', display: 'TypeScript', framework: 'vanilla', language: 'ts' },
      { name: 'vanilla-js', display: 'JavaScript', framework: 'vanilla', language: 'js' },
    ],
  },
];

export const EXTRAS = [
  { title: 'Tailwind CSS', value: 'tailwind' },
  { title: 'ESLint', value: 'eslint' },
  { title: 'Prettier', value: 'prettier' },
];

export const PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'];

function onCancel() {
  throw new CancelledError('Scaffold cancelled.');
}

/**
 * Runs the interactive prompt flow. Any value already supplied via CLI flags
 * (in `preset`) is used as-is and its corresponding question is skipped.
 */
export async function getProjectOptions(preset = {}) {
  const result = { ...preset };

  // 1. Project name / target directory.
  if (!result.projectName) {
    const { projectName } = await prompts(
      {
        type: 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: 'my-app',
        onState: (state) => {
          state.value = formatTargetDir(state.value) || 'my-app';
        },
      },
      { onCancel }
    );
    result.projectName = projectName;
  }

  const targetDir = formatTargetDir(result.projectName);
  const packageName = path.basename(path.resolve(targetDir));

  if (!isValidPackageName(packageName)) {
    const { overwritePackageName } = await prompts(
      {
        type: 'text',
        name: 'overwritePackageName',
        message: 'Package name:',
        initial: toValidPackageName(packageName),
        validate: (name) => isValidPackageName(name) || 'Invalid package.json name.',
      },
      { onCancel }
    );
    result.packageName = overwritePackageName;
  } else {
    result.packageName = packageName;
  }

  // 2. Framework.
  if (!result.framework) {
    const { framework } = await prompts(
      {
        type: 'select',
        name: 'framework',
        message: 'Select a framework:',
        choices: FRAMEWORKS.map((f) => ({
          title: f.color(f.display),
          value: f.name,
        })),
      },
      { onCancel }
    );
    result.framework = framework;
  }

  const frameworkDef = FRAMEWORKS.find((f) => f.name === result.framework);
  if (!frameworkDef) {
    throw new Error(`Unknown framework: ${result.framework}`);
  }

  // 3. Variant (language) — skipped when the framework only has one option.
  if (!result.variant) {
    if (frameworkDef.variants.length === 1) {
      result.variant = frameworkDef.variants[0].name;
    } else {
      const { variant } = await prompts(
        {
          type: 'select',
          name: 'variant',
          message: 'Select a variant:',
          choices: frameworkDef.variants.map((v) => ({
            title: v.display,
            value: v.name,
          })),
        },
        { onCancel }
      );
      result.variant = variant;
    }
  }

  const variantDef = frameworkDef.variants.find((v) => v.name === result.variant);
  if (!variantDef) {
    throw new Error(`Unknown variant: ${result.variant}`);
  }
  result.language = variantDef.language;

  // 4. Extras.
  if (!result.extras) {
    const { extras } = await prompts(
      {
        type: 'multiselect',
        name: 'extras',
        message: 'Select extra tools:',
        hint: '- Space to select, Enter to confirm',
        instructions: false,
        choices: EXTRAS,
      },
      { onCancel }
    );
    result.extras = extras ?? [];
  }

  // 5. Package manager.
  if (!result.pm) {
    const { pm } = await prompts(
      {
        type: 'select',
        name: 'pm',
        message: 'Install dependencies with:',
        choices: PACKAGE_MANAGERS.map((name) => ({ title: name, value: name })),
        initial: PACKAGE_MANAGERS.indexOf(detectPackageManager()),
      },
      { onCancel }
    );
    result.pm = pm;
  }

  // 6. Auto-install confirmation.
  if (result.install === undefined) {
    const { install } = await prompts(
      {
        type: 'confirm',
        name: 'install',
        message: 'Install dependencies now?',
        initial: true,
      },
      { onCancel }
    );
    result.install = install;
  }

  return result;
}
