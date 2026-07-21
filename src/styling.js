import path from 'node:path';
import fs from 'fs-extra';

import {
  ANGULAR_POSTCSS_CONFIG,
  TAILWIND_CSS_ENTRY,
  TAILWIND_STARTERS,
  VITE_CONFIG_WITH_TAILWIND,
} from './starters.js';
import { installOrRecord } from './scaffold-utils.js';
import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

/**
 * Global CSS entry that receives the framework's stylesheet import, for
 * every framework this module wires styling into directly (i.e. everything
 * except Next.js/Astro/SvelteKit, whose own official scaffolder flags
 * already handle Tailwind inline — see scaffold.js's handleFullstack).
 */
const CSS_ENTRY = {
  react: 'src/index.css',
  vue: 'src/style.css',
  svelte: 'src/app.css',
  solid: 'src/index.css',
  angular: 'src/styles.css',
  // create-tauri-app's vanilla(-ts) template also names its stylesheet
  // styles.css, linked directly from index.html.
  tauri: 'src/styles.css',
  // Nuxt 4's default srcDir is app/ — `~/assets/...` in nuxt.config's css
  // array resolves relative to it, not the project root.
  nuxt: 'app/assets/css/main.css',
};

/** Main entry file UnoCSS's `virtual:uno.css` import gets prepended to. */
const MAIN_ENTRY = {
  react: { ts: 'src/main.tsx', js: 'src/main.jsx' },
  vue: { ts: 'src/main.ts', js: 'src/main.js' },
  svelte: { ts: 'src/main.ts', js: 'src/main.ts' },
  solid: { ts: 'src/index.tsx', js: 'src/index.jsx' },
};

const TAILWIND_PACKAGES = {
  vite: ['tailwindcss', '@tailwindcss/vite'],
  angular: ['tailwindcss', '@tailwindcss/postcss', 'postcss'],
  nuxt: ['tailwindcss', '@tailwindcss/vite'],
};

const TAILWIND_FLOORS = {
  tailwindcss: '^4.0.0',
  '@tailwindcss/vite': '^4.0.0',
  '@tailwindcss/postcss': '^4.0.0',
  postcss: '^8.4.0',
};

const UNOCSS_PACKAGES = ['unocss'];

/* ------------------------------------------------------------------ */
/* Plain Vite config (react/vue/svelte/solid/tauri)                    */
/* ------------------------------------------------------------------ */

/**
 * Injects a Vite plugin into the generated vite.config, or writes a fresh
 * one when the template ships without (vanilla-shaped scaffolds). Shared by
 * Tailwind and UnoCSS — only the import/plugin-call text differs.
 */
async function injectVitePlugin(targetDir, language, { importLine, pluginCall, freshTemplate }) {
  const configNames = ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'];
  let configName = null;
  for (const name of configNames) {
    if (await fs.pathExists(path.join(targetDir, name))) {
      configName = name;
      break;
    }
  }

  if (!configName) {
    const freshName = language === 'ts' ? 'vite.config.ts' : 'vite.config.js';
    await fs.writeFile(path.join(targetDir, freshName), freshTemplate);
    return true;
  }

  const configPath = path.join(targetDir, configName);
  let source = await fs.readFile(configPath, 'utf8');
  const moduleSpecifier = importLine.match(/from '([^']+)'/)[1];
  if (source.includes(moduleSpecifier)) return true;

  source = `${importLine}\n${source}`;
  if (/plugins\s*:\s*\[/.test(source)) {
    source = source.replace(/plugins\s*:\s*\[/, `plugins: [${pluginCall}, `);
  } else if (/defineConfig\(\{/.test(source)) {
    source = source.replace(/defineConfig\(\{/, `defineConfig({\n  plugins: [${pluginCall}],`);
  } else if (/=>\s*\(\{/.test(source)) {
    // create-tauri-app's template wraps its config in an async factory
    // returning an object — `defineConfig(async () => ({ ... }))` — rather
    // than a plain object literal argument.
    source = source.replace(/=>\s*\(\{/, `=> ({\n  plugins: [${pluginCall}],`);
  } else {
    return false;
  }

  await fs.writeFile(configPath, source);
  return true;
}

/* ------------------------------------------------------------------ */
/* Nuxt / Astro config — both nest Vite plugins one level under `vite:` */
/* (defineNuxtConfig / astro/config's defineConfig), unlike plain Vite. */
/* ------------------------------------------------------------------ */

/**
 * Injects a Vite plugin into a config that wraps it in `{ vite: { plugins:
 * [...] } }` rather than a top-level `plugins: [...]` — Nuxt's
 * defineNuxtConfig and Astro's defineConfig both work this way, since
 * neither IS Vite itself, just built on it.
 */
async function injectNestedVitePlugin(targetDir, configNames, defineFnName, { importLine, pluginCall }) {
  let configName = null;
  for (const name of configNames) {
    if (await fs.pathExists(path.join(targetDir, name))) {
      configName = name;
      break;
    }
  }
  if (!configName) return false;

  const configPath = path.join(targetDir, configName);
  let source = await fs.readFile(configPath, 'utf8');
  const moduleSpecifier = importLine.match(/from '([^']+)'/)[1];
  if (source.includes(moduleSpecifier)) return true;

  source = `${importLine}\n${source}`;
  const defineCallRe = new RegExp(`${defineFnName}\\(\\{`);

  if (/vite\s*:\s*\{[^}]*plugins\s*:\s*\[/.test(source)) {
    source = source.replace(/(vite\s*:\s*\{[^}]*plugins\s*:\s*\[)/, `$1${pluginCall}, `);
  } else if (/vite\s*:\s*\{/.test(source)) {
    source = source.replace(/vite\s*:\s*\{/, `vite: {\n    plugins: [${pluginCall}],`);
  } else if (defineCallRe.test(source)) {
    source = source.replace(defineCallRe, `${defineFnName}({\n  vite: {\n    plugins: [${pluginCall}],\n  },`);
    // An empty `defineConfig({});` leaves its own closing brace glued right
    // onto ours (`},});`) — give it its own line for readable output.
    source = source.replace(/\},\}\);/, '},\n});');
  } else {
    return false;
  }

  await fs.writeFile(configPath, source);
  return true;
}

const injectNuxtVitePlugin = (targetDir, pluginArgs) =>
  injectNestedVitePlugin(targetDir, ['nuxt.config.ts', 'nuxt.config.js'], 'defineNuxtConfig', pluginArgs);

const injectAstroVitePlugin = (targetDir, pluginArgs) =>
  injectNestedVitePlugin(targetDir, ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'], 'defineConfig', pluginArgs);

/** Registers the global CSS file in nuxt.config's `css: [...]` array. */
async function registerNuxtCss(targetDir, cssImportPath) {
  const configNames = ['nuxt.config.ts', 'nuxt.config.js'];
  let configPath = null;
  for (const name of configNames) {
    if (await fs.pathExists(path.join(targetDir, name))) {
      configPath = path.join(targetDir, name);
      break;
    }
  }
  if (!configPath) return false;

  let source = await fs.readFile(configPath, 'utf8');
  if (source.includes(cssImportPath)) return true;

  if (/css\s*:\s*\[/.test(source)) {
    source = source.replace(/css\s*:\s*\[/, `css: ['${cssImportPath}', `);
  } else if (/defineNuxtConfig\(\{/.test(source)) {
    source = source.replace(/defineNuxtConfig\(\{/, `defineNuxtConfig({\n  css: ['${cssImportPath}'],`);
  } else {
    return false;
  }

  await fs.writeFile(configPath, source);
  return true;
}

/* ------------------------------------------------------------------ */
/* Starter component swap (proves the styling actually works)          */
/* ------------------------------------------------------------------ */

async function writeStarterComponent(options, warnings, styleName) {
  const starter = TAILWIND_STARTERS[options.framework];
  if (!starter) return;

  const candidates = starter.candidates(options.language);
  let target = null;
  for (const rel of candidates) {
    if (await fs.pathExists(path.join(options.targetDir, rel))) {
      target = rel;
      break;
    }
  }

  if (!target) {
    warnings.push(
      `Could not locate the starter component (looked for ${candidates.join(', ')}); ` +
        `${styleName} is configured, but the demo component was skipped.`
    );
    return;
  }

  await fs.writeFile(path.join(options.targetDir, target), starter.content(options.language, styleName));

  await Promise.all(
    starter.obsolete.map(async (rel) => {
      const abs = path.join(options.targetDir, rel);
      if (await fs.pathExists(abs)) await fs.remove(abs);
    })
  );
}

/* ------------------------------------------------------------------ */
/* Tailwind CSS v4                                                     */
/* ------------------------------------------------------------------ */

/**
 * Wires Tailwind v4 into every scaffold shape this CLI can safely automate.
 * Next.js/SvelteKit are deliberately never routed here — their own official
 * scaffolder flags (--tailwind / sv create's --add tailwindcss) already wire
 * Tailwind in as part of project creation. Astro's own `--add tailwind`
 * would do the same, but it requires a live install (fails outright under
 * --no-install), so Astro is handled here instead, the same way Nuxt is.
 */
export async function setupTailwind(options, warnings) {
  const { framework, targetDir, language } = options;

  if (framework === 'electron') {
    warnings.push(
      'Tailwind CSS was not auto-wired for Electron — Forge template config layouts vary too much to safely automate. ' +
        'See https://tailwindcss.com/docs/installation/using-vite to add it manually.'
    );
    return;
  }

  const isAngular = framework === 'angular';
  const isNuxt = framework === 'nuxt';
  const isAstro = framework === 'astro';
  const packages = TAILWIND_PACKAGES[isAngular ? 'angular' : 'vite'];

  await installOrRecord({
    options,
    warnings,
    packages,
    floors: Object.fromEntries(packages.map((name) => [name, TAILWIND_FLOORS[name]])),
    label: 'Tailwind CSS',
  });

  const spinner = createSpinner('Configuring Tailwind CSS...', { indent: 2 });
  try {
    if (isAngular) {
      await fs.writeFile(path.join(targetDir, '.postcssrc.json'), ANGULAR_POSTCSS_CONFIG);
    } else if (isNuxt) {
      const wired = await injectNuxtVitePlugin(targetDir, {
        importLine: "import tailwindcss from '@tailwindcss/vite'",
        pluginCall: 'tailwindcss()',
      });
      if (!wired) {
        warnings.push('nuxt.config could not be updated automatically — add the @tailwindcss/vite plugin manually.');
      }
      await registerNuxtCss(targetDir, '~/assets/css/main.css');
    } else if (isAstro) {
      const wired = await injectAstroVitePlugin(targetDir, {
        importLine: "import tailwindcss from '@tailwindcss/vite'",
        pluginCall: 'tailwindcss()',
      });
      if (!wired) {
        warnings.push('astro.config could not be updated automatically — add the @tailwindcss/vite plugin manually.');
      }
      await fs.outputFile(path.join(targetDir, 'src/styles/global.css'), TAILWIND_CSS_ENTRY);
      const layoutPath = path.join(targetDir, 'src/layouts/Layout.astro');
      if (await fs.pathExists(layoutPath)) {
        const layoutSource = await fs.readFile(layoutPath, 'utf8');
        if (!layoutSource.includes('styles/global.css')) {
          const importLine = "import '../styles/global.css';";
          // Astro's "basics" template ships a Layout.astro with no
          // frontmatter fence at all — `---\n` only exists to replace when
          // one is already there, so a plain string check decides which.
          const updated = layoutSource.startsWith('---\n')
            ? layoutSource.replace(/^---\n/, `---\n${importLine}\n`)
            : `---\n${importLine}\n---\n\n${layoutSource}`;
          await fs.writeFile(layoutPath, updated);
        }
      } else {
        warnings.push('Could not find src/layouts/Layout.astro to import the Tailwind stylesheet — add `import "../styles/global.css"` to your layout manually.');
      }
    } else {
      const wired = await injectVitePlugin(targetDir, language, {
        importLine: "import tailwindcss from '@tailwindcss/vite'",
        pluginCall: 'tailwindcss()',
        freshTemplate: VITE_CONFIG_WITH_TAILWIND,
      });
      if (!wired) {
        warnings.push(
          'vite.config could not be updated automatically — add the @tailwindcss/vite plugin manually: https://tailwindcss.com/docs/installation/using-vite'
        );
      }
    }

    // Only safe to fully replace the stylesheet when a matching starter
    // component is also being rewritten — otherwise the existing markup
    // (Tauri's default page, say) still depends on the classes it defines,
    // and deleting them would leave that page looking broken/unstyled.
    const cssPath = path.join(targetDir, CSS_ENTRY[framework] ?? 'src/index.css');
    if (TAILWIND_STARTERS[framework]) {
      await fs.outputFile(cssPath, TAILWIND_CSS_ENTRY);
    } else if (await fs.pathExists(cssPath)) {
      const existing = await fs.readFile(cssPath, 'utf8');
      await fs.writeFile(cssPath, `${TAILWIND_CSS_ENTRY}\n${existing}`);
    } else {
      await fs.outputFile(cssPath, TAILWIND_CSS_ENTRY);
    }
    await writeStarterComponent(options, warnings, 'Tailwind CSS');

    spinnerSucceed(spinner, 'Tailwind CSS configured (v4, official setup).');
  } catch (err) {
    spinnerFail(spinner, 'Tailwind CSS configuration failed.');
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* UnoCSS                                                               */
/* ------------------------------------------------------------------ */

const UNO_CONFIG = `import { defineConfig, presetUno } from 'unocss'

export default defineConfig({
  presets: [presetUno()],
})
`;

const UNO_VITE_CONFIG_FRESH = `import { defineConfig } from 'vite'
import UnoCSS from 'unocss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [UnoCSS()],
})
`;

export async function setupUnoCss(options, warnings) {
  const { framework, targetDir, language } = options;

  if (framework === 'angular') {
    warnings.push(
      'UnoCSS was not auto-wired for Angular — its build pipeline needs a dedicated PostCSS integration this CLI does not yet automate. See https://unocss.dev/integrations/postcss.'
    );
    return;
  }
  if (framework === 'electron') {
    warnings.push('UnoCSS was not auto-wired for Electron. See https://unocss.dev/integrations/vite.');
    return;
  }

  await installOrRecord({
    options,
    warnings,
    packages: UNOCSS_PACKAGES,
    // UnoCSS crossed into stable major versions a while back (66.x as of
    // this writing) — a 0.x-style floor like ^0.64.0 caps npm's caret range
    // to just 0.64.x, which predates the Vite 8 peer support newer
    // releases actually have.
    floors: { unocss: '^66.0.0' },
    label: 'UnoCSS',
  });

  const spinner = createSpinner('Configuring UnoCSS...', { indent: 2 });
  try {
    const configExt = language === 'ts' ? 'ts' : 'js';
    await fs.writeFile(path.join(targetDir, `uno.config.${configExt}`), UNO_CONFIG);

    const pluginArgs = { importLine: "import UnoCSS from 'unocss/vite'", pluginCall: 'UnoCSS()' };
    if (framework === 'nuxt') {
      const wired = await injectNuxtVitePlugin(targetDir, pluginArgs);
      if (!wired) warnings.push('nuxt.config could not be updated automatically — add the unocss/vite plugin manually.');
    } else {
      const wired = await injectVitePlugin(targetDir, language, { ...pluginArgs, freshTemplate: UNO_VITE_CONFIG_FRESH });
      if (!wired) warnings.push('vite.config could not be updated automatically — add the unocss/vite plugin manually.');
    }

    const mainEntryRel = MAIN_ENTRY[framework]?.[language];
    if (mainEntryRel) {
      const mainEntryPath = path.join(targetDir, mainEntryRel);
      if (await fs.pathExists(mainEntryPath)) {
        const source = await fs.readFile(mainEntryPath, 'utf8');
        if (!source.includes('virtual:uno.css')) {
          await fs.writeFile(mainEntryPath, `import 'virtual:uno.css'\n${source}`);
        }
      }
    }

    // presetUno's utilities are Tailwind-compatible, so the same starter
    // component proves UnoCSS is live instead of leaving the scaffolder's
    // default page — which uses none of the classes we just installed.
    await writeStarterComponent(options, warnings, 'UnoCSS');

    spinnerSucceed(spinner, 'UnoCSS configured.');
  } catch (err) {
    spinnerFail(spinner, 'UnoCSS configuration failed.');
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Applies the chosen styling solution. `none` and `css-modules` need no
 * action — Vite (and everything built on it here) supports `*.module.css`
 * out of the box, so "CSS Modules" just means "don't install anything else."
 */
export async function applyStyling(options, warnings) {
  if (options.styling === 'tailwind') return setupTailwind(options, warnings);
  if (options.styling === 'unocss') return setupUnoCss(options, warnings);
}
