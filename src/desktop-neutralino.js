import path from 'node:path';
import fs from 'fs-extra';

import { runScaffolder, scaffolderInvocation } from './scaffold-utils.js';

/**
 * `neu create <name>` (the official @neutralinojs/neu CLI, run via npx —
 * same "call the real tool" story every other scaffolder here follows)
 * defaults to the neutralinojs-minimal template: plain HTML/CSS/JS served
 * straight from resources/, no package.json or build step at all. That
 * means there's genuinely nothing for applyStyling/applyQuality/
 * generateEnterpriseStructure to hook into (all three assume a
 * package.json-based JS project) — this handler stays deliberately short
 * rather than force-fitting them, the same call Flutter/Rust/Spring's own
 * handlers already make for their own non-npm project shapes.
 */
export async function handleNeutralinoDesktop(options, warnings) {
  const { targetDir, packageName } = options;

  const { cwd, dirArg } = await scaffolderInvocation(targetDir);
  await runScaffolder({
    label: 'Scaffolding Neutralino.js app with neu create...',
    success: 'Neutralino.js app scaffolded.',
    command: 'npx',
    args: ['@neutralinojs/neu', 'create', dirArg],
    cwd,
    expectFile: path.join(targetDir, 'neutralino.config.json'),
  });

  const configPath = path.join(targetDir, 'neutralino.config.json');
  if (await fs.pathExists(configPath)) {
    const config = await fs.readJson(configPath);
    config.applicationId = `js.neutralino.${packageName.replace(/^@[^/]+\//, '').replace(/[^a-zA-Z0-9]/g, '')}`;
    await fs.writeJson(configPath, config, { spaces: 2 });
  }

  warnings.push(
    'The neutralinojs-minimal template ships no package.json or build step (plain HTML/CSS/JS served from resources/) — styling/quality tooling was not auto-wired. Run "neu run" to launch it as-is, or "neu build" to package it.'
  );
  if (options.docker) {
    warnings.push('Docker support was skipped — desktop apps run natively and are not typically containerized.');
  }
}
