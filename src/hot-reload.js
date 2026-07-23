import path from 'node:path';
import fs from 'fs-extra';

import { checkToolchain } from './runtime-check.js';
import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

const AIR_TOML = `root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -o ./tmp/main ."
  bin = "tmp/main"
  include_ext = ["go", "tpl", "tmpl", "html"]
  exclude_dir = ["tmp", "vendor"]
  delay = 1000

[log]
  time = false

[misc]
  clean_on_exit = true
`;

const goMakefile = (mod) => `.PHONY: dev run build

dev:
\tair

run:
\tgo run .

build:
\tgo build -o bin/${mod} .
`;

/**
 * Air (https://github.com/air-verse/air) is Go's nodemon-equivalent — a
 * standalone binary you run, not a package the app imports, so "wiring it
 * up" means writing its config + a `make dev` shortcut rather than touching
 * go.mod at all. Only called when the hot-reload question (prompts.js's
 * stepHotReload) was answered yes — see backend-go.js's handleGoBackend.
 */
export async function writeGoAirConfig(targetDir, mod, warnings) {
  const spinner = createSpinner('Setting up air for hot-reloading...');
  try {
    await fs.writeFile(path.join(targetDir, '.air.toml'), AIR_TOML);
    await fs.writeFile(path.join(targetDir, 'Makefile'), goMakefile(mod));
    await fs.appendFile(path.join(targetDir, '.gitignore'), 'tmp/\n');
    spinnerSucceed(spinner, 'Hot-reloading configured (.air.toml, Makefile).');
  } catch (err) {
    spinnerFail(spinner, 'Hot-reload config could not be written.');
    warnings.push(`.air.toml/Makefile could not be written: ${err.message}`);
    return;
  }

  const airFound = await checkToolchain('air', ['-v']);
  if (!airFound) {
    warnings.push(
      'air was not found on PATH — install it with `go install github.com/air-verse/air@latest`, then `make dev` will auto-restart on changes (falls back to a plain `go run .` until then).'
    );
  }
}
