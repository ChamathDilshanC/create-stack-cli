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
