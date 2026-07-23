import { FRAMEWORKS } from './prompts.js';

/**
 * Named bundles of known-good options, selected via `--preset <name>`. Each
 * entry uses the same field names `getProjectOptions`/`scaffoldProject`
 * already expect (see prompts.js's STEPS) — a preset is just a starting
 * point for that same object, no separate shape to keep in sync.
 *
 * Fields left off a preset aren't "unset" so much as "not this preset's
 * call" — e.g. mobile-app omits database/auth/testing because
 * supportsDatabase/supportsAuth/supportsTesting force them to 'none' for
 * project type 'mobile' regardless of what's supplied (see prompts.js).
 * Only meaningful choices are listed here; everything else still goes
 * through the normal forcing rules in prompts.js/index.js.
 */
export const PRESETS = {
  saas: {
    projectType: 'fullstack',
    framework: 'next',
    language: 'ts',
    styling: 'tailwind',
    database: 'prisma',
    auth: 'authjs',
    testing: 'vitest',
    quality: 'eslint-prettier',
    docker: true,
    pm: 'npm',
    extraPackages: [],
    install: true,
  },
  blog: {
    projectType: 'fullstack',
    framework: 'astro',
    language: 'ts',
    styling: 'tailwind',
    database: 'none',
    auth: 'none',
    testing: 'vitest',
    quality: 'eslint-prettier',
    docker: false,
    pm: 'npm',
    extraPackages: [],
    install: true,
  },
  api: {
    projectType: 'backend',
    framework: 'express',
    language: 'ts',
    database: 'prisma',
    auth: 'none',
    testing: 'vitest',
    quality: 'eslint-prettier',
    docker: true,
    pm: 'npm',
    extraPackages: [],
    install: true,
  },
  'mobile-app': {
    projectType: 'mobile',
    framework: 'expo',
    language: 'ts',
    styling: 'nativewind',
    quality: 'eslint-prettier',
    docker: false,
    pm: 'npm',
    extraPackages: [],
    install: true,
  },
};

/** Looks up a preset by name, throwing (with the available list) if it doesn't exist — mirrors buildPreset's "unknown --type/--framework" errors in index.js so a typo fails the same way. */
export function resolvePresetByName(name) {
  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`Unknown --preset "${name}". Available: ${Object.keys(PRESETS).join(', ')}`);
  }
  // Copy (including the nested array) so callers merging into/mutating the
  // result never touch the registry itself.
  return { ...preset, extraPackages: [...(preset.extraPackages ?? [])] };
}

/**
 * Fills in every field a preset didn't set with the same harmless default
 * getProjectOptions' non-interactive (--yes) path already used to fall back
 * to — each STEPS entry in prompts.js skips its own prompt once
 * `result.<field>` is defined, so this is what lets a preset (named via
 * --preset, or picked from the "Use a preset" wizard shortcut) resolve with
 * zero further questions either way. Shared by index.js's
 * assertNonInteractiveComplete and prompts.js's stepProjectType so both
 * routes into a preset land on identical results.
 */
export function applyPresetDefaults(preset) {
  const frameworkDef = FRAMEWORKS[preset.projectType]?.find((f) => f.value === preset.framework);
  const isPython = frameworkDef?.runtime === 'python';
  const isJava = frameworkDef?.runtime === 'java';
  const isRust = frameworkDef?.runtime === 'rust';
  const isDart = frameworkDef?.runtime === 'dart';
  const isGo = frameworkDef?.runtime === 'go';
  const isPhp = frameworkDef?.runtime === 'php';
  const isRuby = frameworkDef?.runtime === 'ruby';
  const isDotnet = frameworkDef?.runtime === 'dotnet';
  const isDeno = frameworkDef?.runtime === 'deno';
  const isKotlin = frameworkDef?.runtime === 'kotlin';
  const isAi = frameworkDef?.value === 'python-ml';

  // language may be legitimately unset for TS-forced frameworks (Angular,
  // NestJS) — getProjectOptions resolves those on its own either way.
  if (preset.language === undefined) preset.language = 'ts';
  if (preset.styling === undefined) preset.styling = 'none';
  if (preset.database === undefined && !frameworkDef?.forceDatabase) preset.database = 'none';
  if (preset.auth === undefined) preset.auth = 'none';
  if (preset.testing === undefined) preset.testing = 'none';
  // Only consumed for projectType 'backend' (see prompts.js's
  // supportsHotReload) — harmless to default everywhere else, same as
  // auth/testing/quality above already do.
  if (preset.hotReload === undefined) preset.hotReload = true;
  // Same story — only consumed for frontend/fullstack (supportsUiLayer), and
  // uiKit further narrows by framework/styling on top of that (stepUiKit) —
  // defaulting to 'none' everywhere else is always harmless.
  if (preset.stateManagement === undefined) preset.stateManagement = 'none';
  if (preset.apiLayer === undefined) preset.apiLayer = 'none';
  if (preset.uiKit === undefined) preset.uiKit = 'none';
  if (preset.quality === undefined) preset.quality = 'none';
  if (preset.extraPackages === undefined) preset.extraPackages = [];
  if (preset.docker === undefined) preset.docker = false;
  if (preset.install === undefined) preset.install = true;
  // Neutralino ships no package.json — nothing for a live install to act on
  // (see prompts.js's stepInstall for the interactive-mode equivalent).
  if (preset.framework === 'neutralino') preset.install = false;
  if (isPython) preset.pm = 'pip';
  if (isJava) {
    if (preset.buildTool === undefined) preset.buildTool = 'maven';
    if (preset.packaging === undefined) preset.packaging = 'jar';
    if (preset.javaVersion === undefined) preset.javaVersion = '21';
    if (preset.springDependencies === undefined) preset.springDependencies = ['web'];
    if (preset.springHotReload === undefined) preset.springHotReload = true;
    preset.pm = preset.buildTool;
    preset.install = false;
  }
  if (isRust) {
    preset.pm = 'cargo';
    preset.install = false;
  }
  if (isDart) {
    preset.pm = 'flutter';
    preset.install = false;
  }
  if (isGo) {
    preset.pm = 'go';
    // Wails is the one Go framework with a genuine npm-installable
    // frontend/ (see prompts.js's stepInstall) — default it to true, the
    // same as every Node-family framework, rather than forcing it off.
    preset.install = preset.framework === 'wails' ? (preset.install ?? true) : false;
  }
  if (isPhp) {
    preset.pm = 'composer';
    preset.install = false;
  }
  if (isRuby) {
    preset.pm = 'bundler';
    preset.install = false;
  }
  if (isDotnet) {
    preset.pm = 'dotnet';
    preset.install = false;
  }
  if (isDeno) {
    preset.pm = 'deno';
    preset.install = false;
  }
  if (isKotlin) {
    preset.pm = 'gradle';
    preset.install = false;
  }
  if (isAi && preset.mlLibraries === undefined) preset.mlLibraries = [];
}
