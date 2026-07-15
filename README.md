# create-stack

A universal, interactive project scaffolder CLI — like `create-vite` or `create-next-app`, but framework-agnostic. Pick a framework, a language, and extra tooling, and get a working project with dependencies installed in seconds.

## Features

- **Interactive prompts** for project name, framework, language, extras, and package manager
- **Frameworks:** React, Vue, Angular, Vanilla
- **Languages:** TypeScript or JavaScript (Angular is TypeScript-only)
- **Extras:** Tailwind CSS, ESLint, Prettier — wired into the generated project automatically
- **Auto-installs dependencies** with your package manager of choice: npm, yarn, pnpm, or bun
- **Non-interactive mode** via CLI flags, for scripting and CI
- Graceful handling of existing directories and Ctrl+C cancellation — no unhandled promise rejections

## Quick start

```bash
npx @chamathdilshanc/create-stack my-app
# or, once published, the shorter form some registries support:
npm create @chamathdilshanc/stack my-app
```

Then follow the prompts:

```
Project name: my-app
Select a framework: React
Select a variant: TypeScript
Select extra tools: Tailwind CSS, ESLint
Install dependencies with: pnpm
Install dependencies now? Yes
```

## Non-interactive usage

Every prompt can be skipped by passing the equivalent flag. Combine `--yes` with the required flags to run fully non-interactively (useful in CI):

```bash
npx @chamathdilshanc/create-stack my-app \
  --template react-ts \
  --extras tailwind,eslint,prettier \
  --pm pnpm \
  --yes
```

### CLI options

| Flag | Description |
| --- | --- |
| `[project-directory]` | Directory to create the project in (positional argument) |
| `-t, --template <name>` | Template to use: `react-ts`, `react-js`, `vue-ts`, `vue-js`, `angular-ts`, `vanilla-ts`, `vanilla-js` |
| `-e, --extras <list>` | Comma-separated extras: `tailwind`, `eslint`, `prettier` |
| `-p, --pm <manager>` | Package manager: `npm`, `yarn`, `pnpm`, `bun` |
| `--no-install` | Skip automatic dependency installation |
| `-y, --yes` | Skip prompts; fails if a required option isn't supplied via flags |
| `--overwrite` | Overwrite the target directory if it already exists, without prompting |
| `-V, --version` | Print the CLI version |
| `-h, --help` | Print usage |

## Project structure

```text
create-stack-cli/
├── bin/
│   └── cli.js              # Shebang entry point
├── src/
│   ├── index.js             # CLI parsing + orchestration
│   ├── prompts.js            # Interactive prompt flow
│   ├── scaffold.js           # Template copying + extras (Tailwind/ESLint/Prettier) wiring
│   ├── install.js            # Dependency installation (execa + ora spinner)
│   └── utils.js              # Logger, validators, package-manager detection
├── templates/
│   ├── react-ts/ react-js/
│   ├── vue-ts/   vue-js/
│   ├── angular-ts/
│   └── vanilla-ts/ vanilla-js/
├── package.json
└── README.md
```

## Development

```bash
git clone https://github.com/ChamathDilshanC/create-stack-cli.git
cd create-stack-cli
npm install
npm start -- my-test-app   # runs bin/cli.js locally
```

To try the CLI as if it were installed globally:

```bash
npm link
create-stack my-test-app
```

## Releasing

Releases are fully automated with [semantic-release](https://semantic-release.gitbook.io/) via `.github/workflows/ci.yml`. On every push to `main`:

1. The CLI is scaffolded, installed, linted, and built for all 7 templates (a matrix job) as a sanity check.
2. `semantic-release` analyzes commit messages since the last release using [Conventional Commits](https://www.conventionalcommits.org/):
   - `fix:` → patch release
   - `feat:` → minor release
   - `BREAKING CHANGE:` (in the commit body/footer) → major release
   - `docs:`, `chore:`, `ci:`, etc. → no release
3. If a release is warranted, it bumps `package.json`, updates `CHANGELOG.md`, publishes to **npm** and **GitHub Packages**, creates a Git tag + GitHub Release, and commits the version bump back to `main` (with `[skip ci]`).

This requires an `NPM_TOKEN` repository secret (Settings → Secrets and variables → Actions) — a npm granular access token with **read/write** access to this package and **bypass 2FA** enabled.

### Manual publish (fallback)

```bash
npm login --registry=https://npm.pkg.github.com
npm publish --registry=https://npm.pkg.github.com   # GitHub Packages (publishConfig default)

npm login
npm publish --access public --registry=https://registry.npmjs.org   # public npm
```

## License

MIT
