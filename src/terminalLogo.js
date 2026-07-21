import { hex } from './color.js';

/**
 * This project's mascot — a Braille dragon, in the same spirit as
 * neofetch's own distro ASCII/Braille art. Unlike the network-graph
 * Logo.png this replaced for the terminal banner (still used for the
 * README header and npm package listing), this is a hand-placed piece of
 * text, not derived from a raster image at all.
 */
const DRAGON_ART = `⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⠴⠖⠚⠛⠛⠙⠛⠓⠒⠦⢤⣀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣠⡴⠋⠁⠀⢠⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠦⣀⠀⠀⠀⠀⠀
⠀⠀⠀⣠⠞⠁⠀⠀⠀⠀⠈⢿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠳⡄⠀⠀⠀
⠀⠀⣴⠋⠀⠀⠀⠀⢦⣄⠰⣄⡛⢿⣷⣦⣤⣀⡀⠀⠀⠀⠀⠀⠀⠀⠘⢆⠀⠀
⠀⣼⠁⠀⠀⠀⠀⠀⠈⣿⣿⣿⣿⣷⣿⣿⣿⣿⣿⣷⣦⣀⠀⠀⠀⠀⠀⠈⢇⠀
⢰⠇⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣻⣿⣿⣿⣿⣌⡻⣿⣄⠀⠀⠀⠀⠀⠘⡆
⣾⠀⠀⠀⠀⢀⣾⣿⣿⡿⢚⣿⡿⠟⠙⢿⣿⣿⣿⡟⠻⢿⣿⣷⣶⣆⠀⠀⠀⢣
⣿⠀⠀⠀⠀⣼⣿⡿⣫⣾⡖⠀⠐⣿⠗⠀⠉⠻⣿⣷⠀⠀⠈⠙⢿⡏⠀⠀⠀⢸
⢿⠀⠀⠀⠀⣿⣿⣵⣿⡟⢴⣦⣤⠙⠀⠀⠀⢀⣼⣿⣆⡀⠀⠀⠘⠀⠀⠀⠀⡘
⠸⡄⠀⠀⠀⡿⢻⣿⣿⡇⡌⢻⣿⡀⠀⠀⠀⠀⠈⠉⠉⠁⠀⠀⠀⠀⠀⠀⢀⠃
⠀⢳⡀⠀⠀⠇⠸⣿⣿⡇⣧⡀⠈⠓⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠌⠀
⠀⠀⠳⡄⠀⠀⠀⢻⣿⣇⢻⣷⡴⢦⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⠎⠀⠀
⠀⠀⠀⠘⢦⡀⠀⠀⠙⣿⡀⠻⠿⢶⣤⣀⣀⠀⠀⠀⠀⠀⠀⠀⢀⠔⠁⠀⠀⠀
⠀⠀⠀⠀⠀⠉⠲⢄⡀⠈⠓⠄⠀⠀⠀⠀⠉⠁⠀⠀⠀⠀⡠⠔⠁⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠉⠑⠒⠤⠤⣀⣀⣀⣀⠠⠤⠐⠂⠁⠀⠀⠀⠀`;

/** The dragon's one brand color — a single, real 24-bit color, not one of picocolors' 16 standard ANSI ones. */
const DRAGON_COLOR = hex('#8c52ff');

/**
 * Unicode Braille Patterns block (U+2800-U+28FF) bit layout, indexed
 * [dotRow][dotCol] (0-3, 0-1) — used both to decode DRAGON_ART back into a
 * plain boolean dot grid (so it can be resized) and to re-encode a resized
 * grid back into Braille characters.
 */
const BRAILLE_DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/** DRAGON_ART, decoded once into a plain boolean dot grid (4 dot-rows/2 dot-cols per character) so it can be resized without hand-drawing a second, smaller piece of art. */
function decodeBrailleArt(art) {
  const rows = art.split('\n');
  const charRows = rows.length;
  const charCols = Math.max(...rows.map((row) => row.length));
  const dotRows = charRows * 4;
  const dotCols = charCols * 2;
  const grid = Array.from({ length: dotRows }, () => new Array(dotCols).fill(false));

  for (let cr = 0; cr < charRows; cr++) {
    const line = rows[cr];
    for (let cc = 0; cc < charCols; cc++) {
      const ch = line[cc];
      if (!ch) continue;
      const bits = ch.codePointAt(0) - 0x2800;
      if (bits < 0 || bits > 0xff) continue;
      for (let dotRow = 0; dotRow < 4; dotRow++) {
        for (let dotCol = 0; dotCol < 2; dotCol++) {
          if (bits & BRAILLE_DOT_BITS[dotRow][dotCol]) grid[cr * 4 + dotRow][cc * 2 + dotCol] = true;
        }
      }
    }
  }
  return grid;
}

/**
 * Shrinks a boolean dot grid to `targetDotCols` x `targetDotRows` — a dot in
 * the output is "on" if *any* dot in its corresponding source region is on.
 * A plain average/majority vote would fade the dragon's relatively thin
 * outline away at small sizes the same way it would for a sparser image;
 * "any dot on" keeps the silhouette solid and recognizable instead.
 */
function downsampleDots(grid, targetDotCols, targetDotRows) {
  const srcRows = grid.length;
  const srcCols = grid[0].length;
  const out = Array.from({ length: targetDotRows }, () => new Array(targetDotCols).fill(false));

  for (let r = 0; r < targetDotRows; r++) {
    const y0 = Math.floor((r * srcRows) / targetDotRows);
    const y1 = Math.floor(((r + 1) * srcRows) / targetDotRows);
    for (let c = 0; c < targetDotCols; c++) {
      const x0 = Math.floor((c * srcCols) / targetDotCols);
      const x1 = Math.floor(((c + 1) * srcCols) / targetDotCols);
      let on = false;
      for (let y = y0; y < y1 && !on; y++) {
        for (let x = x0; x < x1; x++) {
          if (grid[y][x]) {
            on = true;
            break;
          }
        }
      }
      out[r][c] = on;
    }
  }
  return out;
}

/** The inverse of decodeBrailleArt: a boolean dot grid back into an array of Braille-character lines. */
function encodeBrailleLines(grid) {
  const dotRows = grid.length;
  const dotCols = grid[0].length;
  const charRows = Math.ceil(dotRows / 4);
  const charCols = Math.ceil(dotCols / 2);
  const lines = [];

  for (let cr = 0; cr < charRows; cr++) {
    let line = '';
    for (let cc = 0; cc < charCols; cc++) {
      let bits = 0;
      for (let dotRow = 0; dotRow < 4; dotRow++) {
        for (let dotCol = 0; dotCol < 2; dotCol++) {
          const y = cr * 4 + dotRow;
          const x = cc * 2 + dotCol;
          if (y < dotRows && x < dotCols && grid[y][x]) bits |= BRAILLE_DOT_BITS[dotRow][dotCol];
        }
      }
      line += String.fromCodePoint(0x2800 + bits);
    }
    lines.push(line);
  }
  return lines;
}

/** Decoded once at module load — every renderDragonLines() call resizes from this instead of re-parsing DRAGON_ART each time. */
const DRAGON_DOTS = decodeBrailleArt(DRAGON_ART);

/**
 * Renders the dragon mascot as an array of colored lines, `charCols`
 * characters wide (proportionally scaled — the dragon's own aspect ratio is
 * preserved). Meant to be embedded directly into a layout (banner.js's
 * boxed left column), not printed as a large standalone block: a full-size
 * dragon plus the summary box together ran taller than a lot of terminal
 * windows, forcing a zoom-out or a scrollbar just to see the whole banner.
 *
 * Returns null when stdout isn't a real TTY (piped to a file, CI logs, ...),
 * since raw escape codes have no business there.
 */
export function renderDragonLines(charCols = 20) {
  if (!process.stdout.isTTY) return null;

  const srcDotCols = DRAGON_DOTS[0].length;
  const srcDotRows = DRAGON_DOTS.length;
  const targetDotCols = Math.max(2, charCols * 2);
  const targetDotRows = Math.max(4, Math.round((targetDotCols * srcDotRows) / srcDotCols));

  const grid =
    targetDotCols >= srcDotCols ? DRAGON_DOTS : downsampleDots(DRAGON_DOTS, targetDotCols, targetDotRows);

  return encodeBrailleLines(grid).map((line) => DRAGON_COLOR(line));
}
