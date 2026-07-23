import path from 'node:path';
import fs from 'fs-extra';

import { installOrRecord, jsSrcRoot, mergeDevDependencies, registerNextProvider, tryRun, wrapViteReactRoot } from './scaffold-utils.js';
import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

const UI_KIT_LABELS = {
  shadcn: 'shadcn/ui',
  mui: 'Material UI',
  chakra: 'Chakra UI',
  antd: 'Ant Design',
  daisyui: 'DaisyUI',
};

/* ------------------------------------------------------------------ */
/* shadcn/ui — a real CLI init, not a plain package install            */
/* ------------------------------------------------------------------ */

/**
 * shadcn's own "Validating import alias" preflight refuses to run at all
 * without a "@/*" path alias already configured — Next.js has one out of
 * the box (create-next-app's own tsconfig default), but create-vite's
 * react-ts template does not, so this wires up the same tsconfig "paths" +
 * vite.config resolve.alias combo shadcn's own Vite installation guide
 * documents, before init ever runs. Only needed for React (Vite) here.
 */
async function ensureViteImportAlias(targetDir, warnings) {
  const spinner = createSpinner('Configuring import alias for shadcn/ui...');
  try {
    await mergeDevDependencies(targetDir, { '@types/node': '^22.0.0' });

    // Text-level splice, not JSON.parse/stringify: create-vite's tsconfig
    // files ship with genuine /* comments */ (a valid TS-JSONC extension,
    // invalid strict JSON) — round-tripping through JSON.parse on
    // tsconfig.app.json throws outright, and even where it wouldn't, it
    // would silently strip every comment on write. Both tsconfig.json (the
    // solution file editors/shadcn's own validator read) and
    // tsconfig.app.json (the one project references actually compile
    // through — the one that matters for `tsc -b` to really resolve "@/*")
    // need this, not just one.
    for (const file of ['tsconfig.json', 'tsconfig.app.json']) {
      const filePath = path.join(targetDir, file);
      if (!(await fs.pathExists(filePath))) continue;
      let source = await fs.readFile(filePath, 'utf8');
      if (source.includes('"@/*"')) continue;

      // No "baseUrl" — this tsconfig already sets moduleResolution:
      // "bundler", which resolves "paths" without one; adding it anyway
      // trips TS 6.0's TS5101 ("baseUrl is deprecated") and fails the build.
      const aliasBlock = '"paths": {\n      "@/*": ["./src/*"]\n    },\n    ';
      if (/"compilerOptions"\s*:\s*\{/.test(source)) {
        source = source.replace(/"compilerOptions"\s*:\s*\{\s*/, `"compilerOptions": {\n    ${aliasBlock}`);
      } else {
        // tsconfig.json's own top level has no compilerOptions at all by
        // default (create-vite's solution file is just files/references) —
        // add one rather than skipping this file entirely.
        source = source.replace(/\{/, `{\n  "compilerOptions": {\n    ${aliasBlock.trimEnd()}\n  },`);
      }
      await fs.writeFile(filePath, source);
    }

    const viteConfigPath = path.join(targetDir, 'vite.config.ts');
    if ((await fs.pathExists(viteConfigPath)) && !(await fs.readFile(viteConfigPath, 'utf8')).includes('resolve:')) {
      let source = await fs.readFile(viteConfigPath, 'utf8');
      source = `import path from 'node:path';\n${source}`;
      source = source.replace(/defineConfig\(\{/, `defineConfig({\n  resolve: {\n    alias: {\n      '@': path.resolve(__dirname, './src'),\n    },\n  },`);
      await fs.writeFile(viteConfigPath, source);
    }

    spinnerSucceed(spinner, 'Import alias configured (@/* -> ./src/*).');
  } catch (err) {
    spinnerFail(spinner, 'Import alias configuration failed.');
    warnings.push(`Could not configure the @/* import alias shadcn/ui needs: ${err.message}`);
  }
}

/**
 * `shadcn` (the CLI was renamed from `shadcn-ui` a while back — `shadcn-ui`
 * still resolves today, just to a deprecation notice that redirects here)
 * writes its own components.json + copies component source directly into
 * the project, rather than shipping a component library as an npm
 * dependency — so this really does run the official generator, the same
 * "call the real tool" story every other scaffolder in this CLI follows,
 * not a hand-rolled reimplementation. `-b base -p nova` spells out the same
 * combination `-d/--defaults` uses internally (confirmed via the CLI's own
 * --help text) rather than relying on `-d`, since `-d` also hardcodes
 * `--template=next` — wrong for the `vite` case below.
 */
async function setupShadcn(options, warnings) {
  const { targetDir, framework } = options;
  const componentsDir = path.join(jsSrcRoot(framework), 'components', 'ui');

  if (framework === 'react') {
    await ensureViteImportAlias(targetDir, warnings);
  }

  const initOk = await tryRun({
    label: 'Initializing shadcn/ui...',
    success: 'shadcn/ui initialized.',
    failure: 'shadcn/ui init failed — run `npx shadcn@latest init` yourself once you can.',
    command: 'npx',
    args: ['shadcn@latest', 'init', '-y', '-t', framework === 'next' ? 'next' : 'vite', '-b', 'base', '-p', 'nova'],
    cwd: targetDir,
  });
  if (!initOk) return;

  // A working example, not just an empty components.json — same "always
  // have one real vertical slice" bar Go/Rust's own generated GET /users
  // sets, proving the whole pipeline (config, Tailwind, path aliases)
  // actually works end to end.
  const addOk = await tryRun({
    label: 'Adding a demo Button component...',
    success: `Button component added (${componentsDir}).`,
    failure: 'Could not add a demo component — run `npx shadcn@latest add button` yourself.',
    command: 'npx',
    args: ['shadcn@latest', 'add', 'button', '-y'],
    cwd: targetDir,
  });
  if (!addOk) return;

  warnings.push(`shadcn/ui was initialized with a demo Button (${componentsDir}) — add more with \`npx shadcn@latest add <component>\`.`);
}

/* ------------------------------------------------------------------ */
/* Material UI                                                         */
/* ------------------------------------------------------------------ */

const muiThemeFile = (isTs) => `import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
  },
});
`;

const MUI_NEXT_PROVIDER = `'use client';

import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { theme } from '@/lib/theme';

export function MuiProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
`;

async function setupMui(options, warnings) {
  const { targetDir, framework, language } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';

  const packages = ['@mui/material', '@emotion/react', '@emotion/styled'];
  if (framework === 'next') packages.push('@mui/material-nextjs');
  await installOrRecord({
    options,
    warnings,
    packages,
    floors: { '@mui/material': '^7.0.0', '@emotion/react': '^11.13.0', '@emotion/styled': '^11.13.0', '@mui/material-nextjs': '^9.0.0' },
    dev: false,
    label: 'Material UI',
  });

  const libDir = path.join(jsSrcRoot(framework), 'lib');
  await fs.outputFile(path.join(targetDir, libDir, `theme.${ext}`), muiThemeFile(isTs));

  if (framework === 'next') {
    // "@/lib/theme" (used by MUI_NEXT_PROVIDER) resolves via Next's own
    // "@/*" -> "./*" tsconfig alias, matching libDir ('lib', since
    // jsSrcRoot('next') is '') either way.
    await fs.outputFile(path.join(targetDir, 'app', 'mui-provider.tsx'), MUI_NEXT_PROVIDER);
    await registerNextProvider(targetDir, isTs, {
      importLines: ["import { MuiProvider } from './mui-provider';"],
      open: '<MuiProvider>',
      close: '</MuiProvider>',
    });
    return;
  }

  const wired = await wrapViteReactRoot(targetDir, isTs, {
    importLine:
      `import { ThemeProvider } from '@mui/material/styles';\n` +
      `import CssBaseline from '@mui/material/CssBaseline';\n` +
      `import { theme } from './lib/theme.${ext}';`,
    open: '<ThemeProvider theme={theme}>\n      <CssBaseline />',
    close: '</ThemeProvider>',
  });
  if (!wired) {
    warnings.push(`Material UI's theme was generated (${libDir}/theme.${ext}), but src/main.${ext} could not be auto-wrapped in <ThemeProvider> — wrap <App /> in it yourself.`);
  }
}

/* ------------------------------------------------------------------ */
/* Chakra UI (v3 — value-based ChakraProvider, no separate theme pkg)  */
/* ------------------------------------------------------------------ */

const CHAKRA_NEXT_PROVIDER = `'use client';

import { ChakraProvider, defaultSystem } from '@chakra-ui/react';

export function ChakraUiProvider({ children }: { children: React.ReactNode }) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}
`;

async function setupChakra(options, warnings) {
  const { targetDir, framework, language } = options;
  const isTs = language === 'ts';
  const ext = isTs ? 'ts' : 'js';

  await installOrRecord({
    options,
    warnings,
    packages: ['@chakra-ui/react', '@emotion/react'],
    floors: { '@chakra-ui/react': '^3.8.0', '@emotion/react': '^11.13.0' },
    dev: false,
    label: 'Chakra UI',
  });

  if (framework === 'next') {
    await fs.outputFile(path.join(targetDir, 'app', 'chakra-provider.tsx'), CHAKRA_NEXT_PROVIDER);
    await registerNextProvider(targetDir, isTs, {
      importLines: ["import { ChakraUiProvider } from './chakra-provider';"],
      open: '<ChakraUiProvider>',
      close: '</ChakraUiProvider>',
    });
    return;
  }

  const wired = await wrapViteReactRoot(targetDir, isTs, {
    importLine: `import { ChakraProvider, defaultSystem } from '@chakra-ui/react';`,
    open: '<ChakraProvider value={defaultSystem}>',
    close: '</ChakraProvider>',
  });
  if (!wired) {
    warnings.push(`Chakra UI was installed, but src/main.${ext} could not be auto-wrapped in <ChakraProvider> — wrap <App /> in it yourself.`);
  }
}

/* ------------------------------------------------------------------ */
/* Ant Design — works without any provider for basic usage             */
/* ------------------------------------------------------------------ */

async function setupAntDesign(options, warnings) {
  await installOrRecord({ options, warnings, packages: ['antd'], floors: { antd: '^6.0.0' }, dev: false, label: 'Ant Design' });
  warnings.push('Ant Design needs no provider for basic usage — import components directly, e.g. `import { Button } from \'antd\';`. Wrap your app in <ConfigProvider theme={{...}}> yourself if you want custom theming.');
}

/* ------------------------------------------------------------------ */
/* DaisyUI — a Tailwind v4 CSS-first plugin, not a component library   */
/* ------------------------------------------------------------------ */

/** Where each framework's Tailwind entry stylesheet ends up — mirrors styling.js's own CSS_ENTRY, extended with the three fullstack frameworks (Next.js/SvelteKit/Astro) that wire Tailwind in through their own official scaffolder flags instead of styling.js, so aren't in that map at all. */
const DAISYUI_CSS_ENTRY = {
  react: 'src/index.css',
  vue: 'src/style.css',
  svelte: 'src/app.css',
  solid: 'src/index.css',
  angular: 'src/styles.css',
  // Next.js: no src/ (see scaffold-utils.js's jsSrcRoot) — create-next-app's
  // --tailwind flag writes straight to app/globals.css at the project root.
  next: 'app/globals.css',
  nuxt: 'app/assets/css/main.css',
  sveltekit: 'src/app.css',
  astro: 'src/styles/global.css',
};

/**
 * DaisyUI v5 targets Tailwind v4's CSS-first config — `@plugin "daisyui";`
 * in the same stylesheet that already has `@import "tailwindcss";` is the
 * entire setup, no tailwind.config.js entry needed. Only ever called when
 * styling === 'tailwind' (see prompts.js's stepUiKit), so that import is
 * already guaranteed to be there by the time this runs.
 */
async function setupDaisyUi(options, warnings) {
  const { targetDir, framework } = options;

  await installOrRecord({ options, warnings, packages: ['daisyui'], floors: { daisyui: '^5.0.0' }, dev: true, label: 'DaisyUI' });

  const cssRelPath = DAISYUI_CSS_ENTRY[framework];
  const cssPath = cssRelPath ? path.join(targetDir, cssRelPath) : null;
  if (!cssPath || !(await fs.pathExists(cssPath))) {
    warnings.push(`DaisyUI was installed, but the Tailwind stylesheet could not be found to register it — add \`@plugin "daisyui";\` to it yourself.`);
    return;
  }

  const source = await fs.readFile(cssPath, 'utf8');
  if (source.includes('@plugin "daisyui"')) return;
  await fs.writeFile(cssPath, `${source}${source.endsWith('\n') ? '' : '\n'}@plugin "daisyui";\n`);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const SETUP_BY_CHOICE = {
  shadcn: setupShadcn,
  mui: setupMui,
  chakra: setupChakra,
  antd: setupAntDesign,
  daisyui: setupDaisyUi,
};

/** Only called for choices prompts.js's stepUiKit could actually offer (see UI_KIT_REACT_FAMILY/hasTailwind gating there) — every setup function above assumes that gating already holds. */
export async function applyUiKit(options, warnings) {
  const setup = SETUP_BY_CHOICE[options.uiKit];
  if (!setup) return;

  const label = UI_KIT_LABELS[options.uiKit];
  // shadcn manages its own spinners per external CLI call (init, then add) —
  // wrapping the whole thing in a second, outer one would just be noise.
  if (options.uiKit === 'shadcn') {
    await setup(options, warnings);
    return;
  }

  const spinner = createSpinner(`Setting up ${label}...`);
  try {
    await setup(options, warnings);
    spinnerSucceed(spinner, `${label} configured.`);
  } catch (err) {
    spinnerFail(spinner, `${label} setup failed.`);
    warnings.push(`${label} could not be fully wired up: ${err.message}`);
  }
}
