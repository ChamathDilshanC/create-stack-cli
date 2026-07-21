import os from 'node:os';
import boxen from 'boxen';
import pc from 'picocolors';

import { hex } from './color.js';
import { PROJECT_TYPES } from './prompts.js';
import { getLogoKind, renderBlockArtLines, renderNativeLogo } from './terminalLogo.js';
import { detectPackageManager } from './utils.js';

/**
 * Purely decorative — the bars logo's own pink-to-cyan gradient, unrelated
 * to any project type. Six stops sampled evenly across a 10-color source
 * gradient (indices 0,2,4,5,7,9), since the bars logo has always drawn six
 * bars; PROJECT_TYPES' own six colors (prompts.js) are a separate palette
 * used for actually labeling Frontend/Fullstack/etc. as categories, both in
 * the picker and in this file's "Frontend · Fullstack · ..." summary line.
 */
const GRADIENT_COLORS = ['#f72585', '#7209b7', '#480ca8', '#3a0ca3', '#4361ee', '#4cc9f0'].map(hex);

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const visibleWidth = (text) => text.replace(ANSI_RE, '').length;

/** Pads `text` with trailing spaces to `width` visible columns (ANSI-aware). */
function padEndVisible(text, width) {
  const gap = Math.max(0, width - visibleWidth(text));
  return `${text}${' '.repeat(gap)}`;
}

/** Centers `text` within `width` visible columns (ANSI-aware). */
function centerVisible(text, width) {
  const gap = Math.max(0, width - visibleWidth(text));
  const left = Math.floor(gap / 2);
  return `${' '.repeat(left)}${text}${' '.repeat(gap - left)}`;
}

/**
 * Hard-caps plain (unstyled) text to `width` characters before it gets
 * colored — user home directories and Node/package-manager strings are
 * unbounded length, and the left column's divider only stays aligned if
 * nothing in it can ever exceed its width.
 */
function truncate(text, width) {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

/** `C:\Users\me\Desktop` → `~\Desktop`, like every polished CLI prints it. */
function prettyCwd() {
  const cwd = process.cwd();
  const home = os.homedir();
  return cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

/**
 * Our own mark: a ◆ apex over six ascending, widening bars in a pink-to-cyan
 * gradient (GRADIENT_COLORS above), each a little wider than the last —
 * reads as a small "growing stack" rather than six identical blocks. The
 * half-block caps (▐…▌) are the same rounded-corner trick Claude Code's own
 * mascot uses, just drawn as our own shape — and, like the ◆ and █ already
 * used elsewhere in this file, they're plain Block Elements glyphs rather
 * than the "ambiguous width" Dingbats that cause ora's checkmark to glue
 * onto adjacent text in some terminal fonts.
 */
function logo(width) {
  const bar = (color, w) => color(`▐${'█'.repeat(Math.max(0, w - 2))}▌`);
  const minWidth = Math.max(6, Math.round(width / 2));
  const step = (width - minWidth) / (GRADIENT_COLORS.length - 1);
  return [
    pc.bold(pc.white('◆')),
    ...GRADIENT_COLORS.map((color, i) => bar(color, Math.round(minWidth + step * i))),
  ];
}

/**
 * What actually goes in the left column, in place of (or as) the logo: on
 * terminals without a native image protocol but with real color support
 * ('blockart' — Windows Terminal, VS Code's integrated terminal, most
 * terminals people actually use), a small rendering of the real
 * assets/Logo.png fits right where the abstract bars logo used to be,
 * instead of only ever appearing as a large standalone image above the
 * whole banner. `getLogoKind() === 'native'` terminals (Kitty/iTerm2)
 * already get the real, full-resolution image printed above this box (see
 * printBanner below), so they keep the bars logo here instead of a second,
 * redundant small copy; the plain bars logo is also the fallback if the
 * asset can't be read for any reason.
 */
function leftColumnLogo(width) {
  if (getLogoKind() === 'blockart') {
    // Lower threshold than a large standalone render needs (see
    // terminalLogo.js) — averaging the sparse network-graph drawing down to
    // this few columns dilutes coverage a lot more per cell.
    const lines = renderBlockArtLines(width, 12);
    if (lines && lines.length > 0) return lines;
  }
  return logo(width);
}

/** Two-column layout — left: identity/environment, right: tips/links. */
function printWideBanner(pkg, columns) {
  const leftWidth = 30;
  // Box overhead is border(2) + padding(2) + the " │ " divider gutter(3);
  // subtracting all of it makes the box land exactly on `columns` wide
  // instead of stopping short, so the divider reaches the true right edge.
  const rightWidth = Math.max(40, columns - leftWidth - 7);

  const username = os.userInfo().username;
  const barWidth = 16;

  const left = [
    pc.bold(truncate(`Welcome, ${username}!`, leftWidth)),
    '',
    ...centerLogoLines(leftColumnLogo(barWidth), leftWidth),
    '',
    pc.dim(truncate(`Node ${process.version} · ${detectPackageManager()} detected`, leftWidth)),
    pc.dim(truncate(prettyCwd(), leftWidth)),
  ];

  const tips = [
    ['create-stack my-app', 'pick from Frontend/Fullstack/Backend/Desktop/Mobile/AI-ML'],
    ['--type backend -f nestjs', 'preselect your stack'],
    ['--help', 'see every option'],
  ];
  const cmdWidth = Math.max(...tips.map(([cmd]) => cmd.length));
  const tipLines = tips.map(
    ([cmd, hint]) => `${pc.dim('❯')} ${pc.cyan(cmd.padEnd(cmdWidth))}  ${pc.dim(hint)}`
  );

  const right = [
    pc.bold('Tips for getting started'),
    ...tipLines,
    '',
    pc.dim('─'.repeat(rightWidth)),
    '',
    pc.bold('Docs & support'),
    `❯ ${pc.dim(pkg.homepage ?? '')}`,
  ];

  const rowCount = Math.max(left.length, right.length);
  const lines = [];
  for (let i = 0; i < rowCount; i++) {
    const leftCell = padEndVisible(left[i] ?? '', leftWidth);
    const rightCell = right[i] ?? '';
    lines.push(`${leftCell} ${pc.dim('│')} ${rightCell}`);
  }

  console.log(
    boxen(lines.join('\n'), {
      padding: { top: 1, bottom: 1, left: 1, right: 1 },
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      title: `${pc.bold('Create Stack CLI')} ${pc.dim(`v${pkg.version}`)}`,
      titleAlignment: 'left',
      width: columns,
    })
  );
}

/** Centers each logo row within the left column, as one block. */
function centerLogoLines(rows, width) {
  return rows.map((row) => centerVisible(row, width));
}

/** Narrower fallback: a single stacked box, used when the terminal can't fit two columns. */
function printCompactBanner(pkg, columns) {
  // Border(2) + padding(3+3) = 8 of overhead; sizing content to columns - 8
  // makes the box land exactly on the terminal's actual width.
  const width = Math.max(48, columns - 8);

  const title = `${pc.cyan('◆')} ${pc.bold(pc.cyan('Create Stack CLI'))} ${pc.dim(`v${pkg.version}`)}`;

  const tips = [
    ['create-stack my-app', 'pick from Frontend/Fullstack/Backend/Desktop/Mobile/AI-ML'],
    ['--type backend -f nestjs', 'preselect your stack'],
    ['--help', 'see every option'],
  ];
  const cmdWidth = Math.max(...tips.map(([cmd]) => cmd.length));
  const tipLines = tips.map(
    ([cmd, hint]) => `${pc.dim('❯')} ${pc.cyan(cmd.padEnd(cmdWidth))}  ${pc.dim(hint)}`
  );

  const body = [
    title,
    '',
    `Scaffold ${pc.bold('production-ready apps')} with each stack's own official tooling —`,
    `no stale templates, ever.`,
    '',
    PROJECT_TYPES.map((t) => t.color(t.title)).join(' · '),
    '',
    pc.dim('─'.repeat(width)),
    '',
    pc.bold('Tips for getting started'),
    '',
    ...tipLines,
    '',
    pc.dim(`Node ${process.version} · ${detectPackageManager()} detected · ${prettyCwd()}`),
  ].join('\n');

  console.log(
    boxen(body, {
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      width: columns,
    })
  );
}

const MIN_TWO_COLUMN_WIDTH = 92;

/**
 * The startup screen. Wide terminals get a two-column layout (identity/logo
 * on the left, tips/links on the right, matching the Claude Code / Nuxt CLI
 * style welcome banner); narrow ones fall back to a single stacked box.
 *
 * The real assets/Logo.png shows up one of two ways, depending on
 * getLogoKind() (terminalLogo.js): terminals with a native image protocol
 * (Kitty/iTerm2) get it printed full-resolution above the box, since it's
 * sharp enough to be worth the extra space; every other real terminal with
 * color support instead gets a small rendering of it *inside* the box's
 * left column, in place of the abstract bars logo (see leftColumnLogo
 * above) — that's the common case (Windows Terminal, VS Code's integrated
 * terminal, ...), so the box itself stays the one and only thing printed.
 * Piped/non-TTY output gets neither; the box still renders with the plain
 * bars logo either way.
 */
export function printBanner(pkg) {
  if (getLogoKind() === 'native') {
    const rendered = renderNativeLogo();
    if (rendered) process.stdout.write(`${rendered}\n\n`);
  }

  const columns = process.stdout.columns ?? 80;
  if (columns >= MIN_TWO_COLUMN_WIDTH) {
    printWideBanner(pkg, columns);
  } else {
    printCompactBanner(pkg, columns);
  }
}
