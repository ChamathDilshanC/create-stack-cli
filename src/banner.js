import os from 'node:os';
import boxen from 'boxen';
import pc from 'picocolors';

import { detectPackageManager } from './utils.js';

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const visibleWidth = (text) => text.replace(ANSI_RE, '').length;

/** Lays `left` and `right` on one line, right-aligned to `width` columns. */
function spaceBetween(left, right, width) {
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return `${left}${' '.repeat(gap)}${right}`;
}

/** `C:\Users\me\Desktop` → `~\Desktop`, like every polished CLI prints it. */
function prettyCwd() {
  const cwd = process.cwd();
  const home = os.homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

/**
 * The startup screen: a single responsive box with the product line, what the
 * tool does, and copy-pasteable tips — inspired by the Claude Code / Nuxt CLI
 * welcome banners.
 */
export function printBanner(version) {
  const columns = process.stdout.columns ?? 80;
  // Inner text width: capped so lines stay scannable on wide terminals,
  // shrunk (and gracefully wrapped by boxen) on narrow ones.
  const width = Math.max(48, Math.min(64, columns - 8));

  const title = spaceBetween(
    `${pc.cyan('◆')} ${pc.bold(pc.cyan('Create Stack CLI'))}`,
    pc.dim(`v${version}`),
    width
  );

  const tips = [
    ['create-stack my-app', 'scaffold straight into ./my-app'],
    ['-t react-ts -e tailwind', 'preselect your stack'],
    ['--help', 'see every option'],
  ];
  const cmdWidth = Math.max(...tips.map(([cmd]) => cmd.length));
  const tipLines = tips.map(
    ([cmd, hint]) => `${pc.dim('❯')} ${pc.cyan(cmd.padEnd(cmdWidth))}  ${pc.dim(hint)}`
  );

  const body = [
    title,
    '',
    `Scaffold ${pc.bold('production-ready apps')} with the official tooling —`,
    `powered by ${pc.green('create-vite')} and the ${pc.red('Angular CLI')}. No stale templates.`,
    '',
    pc.dim(`${pc.cyan('React')} · ${pc.green('Vue')} · ${pc.red('Angular')} · ${pc.yellow('Vanilla')} — TypeScript or JavaScript`),
    '',
    pc.dim('─'.repeat(width)),
    '',
    pc.bold('Tips for getting started'),
    '',
    ...tipLines,
  ].join('\n');

  console.log(
    boxen(body, {
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      margin: { top: 1, bottom: 0, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      width: Math.min(width + 8, columns),
    })
  );

  console.log(
    `  ${pc.dim(`node ${process.version} · ${detectPackageManager()} detected · ${prettyCwd()}`)}\n`
  );
}
