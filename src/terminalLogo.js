import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import supportsTerminalGraphics from 'supports-terminal-graphics';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'Logo.png');

/**
 * Which way (if any) this terminal can show assets/Logo.png: a real inline
 * image via Kitty's or iTerm2's own graphics protocol ('native', highest
 * quality); a 24-bit-color block-art approximation for every other real
 * terminal with truecolor support ('blockart' — Sixel is deliberately not
 * implemented as a third native protocol here, unlike the other two it needs
 * real pixel-level encoding, and block-art already covers the same ground);
 * or nothing at all for piped/non-TTY output ('none' — redirected to a file,
 * CI logs, ... raw escape codes have no business there).
 */
export function getLogoKind() {
  if (!process.stdout.isTTY) return 'none';
  const support = supportsTerminalGraphics.stdout;
  return support.kitty || support.iterm2 ? 'native' : 'blockart';
}

/**
 * iTerm2's inline image protocol (OSC 1337). Both this and Kitty's below
 * accept a raw PNG's bytes directly, base64-encoded — no pixel decoding
 * needed for this path.
 */
function renderIterm2(base64, widthCells) {
  return `\x1b]1337;File=inline=1;width=${widthCells};preserveAspectRatio=1:${base64}\x07`;
}

/**
 * Kitty's graphics protocol. `f=100` tells Kitty the payload is already a
 * PNG (it decodes it itself); the base64 payload is chunked into ≤4096-byte
 * pieces per the spec, with `m=1`/`m=0` marking "more chunks follow"/"last chunk".
 */
function renderKitty(base64, widthCells) {
  const CHUNK_SIZE = 4096;
  const chunks = [];
  for (let i = 0; i < base64.length; i += CHUNK_SIZE) {
    chunks.push(base64.slice(i, i + CHUNK_SIZE));
  }

  return chunks
    .map((chunk, i) => {
      const isFirst = i === 0;
      const hasMore = i < chunks.length - 1 ? 1 : 0;
      const control = isFirst ? `a=T,f=100,c=${widthCells},m=${hasMore}` : `m=${hasMore}`;
      return `\x1b_G${control};${chunk}\x1b\\`;
    })
    .join('');
}

/**
 * Renders assets/Logo.png as a real inline image via whichever native
 * protocol getLogoKind() found ('native' only — the caller decides when to
 * call this). Returns null if the file can't be read for any reason; this
 * is a cosmetic nice-to-have, never worth failing the CLI over.
 */
export function renderNativeLogo(widthCells = 24) {
  try {
    const support = supportsTerminalGraphics.stdout;
    const base64 = fs.readFileSync(LOGO_PATH).toString('base64');
    return support.kitty ? renderKitty(base64, widthCells) : renderIterm2(base64, widthCells);
  } catch {
    return null;
  }
}

/**
 * Alpha-weighted average color of the source PNG's pixels inside
 * [x0,x1) x [y0,y1) — averaging (a box filter), not nearest-neighbor point
 * sampling, matters a lot here: the logo is a sparse network-graph drawing
 * (thin lines, small dots, ~95% transparent background), so a naive
 * point-sample at low resolution would land on empty space almost every
 * time and render as a near-blank box. Averaging lets faint/thin regions
 * still show up, diluted, instead of disappearing outright. Weighting by
 * alpha (rather than a plain mean) keeps the transparent background from
 * dragging the averaged color toward black.
 */
function averageRegion(png, x0, x1, y0, y1) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let aSum = 0;
  let count = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (png.width * y + x) * 4;
      const a = png.data[idx + 3];
      rSum += png.data[idx] * a;
      gSum += png.data[idx + 1] * a;
      bSum += png.data[idx + 2] * a;
      aSum += a;
      count++;
    }
  }

  if (aSum === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: Math.round(rSum / aSum),
    g: Math.round(gSum / aSum),
    b: Math.round(bSum / aSum),
    // The region's own average alpha (not alpha-weighted) — how much of
    // this cell is actually covered by non-transparent pixels, used below
    // to decide whether the cell renders as visible content at all.
    a: Math.round(aSum / count),
  };
}

/**
 * Renders one row of the image as a line of half-block (▀) characters: each
 * terminal cell packs two source pixel-rows into one line of text —
 * foreground color = the top pixel, background color = the bottom one —
 * which is what gives this roughly twice the vertical resolution a plain
 * "one character per pixel" render would have, at no extra character width.
 * True transparency (alpha below the threshold on both halves) becomes a
 * plain space instead of a colored block, so the image's own transparent
 * background shows through as the terminal's actual background — correct
 * on both light and dark themes, since neither is ever guessed at.
 */
function renderBlockArtRow(png, cols, threshold, y0Top, y1Top, y0Bottom, y1Bottom) {
  let line = '';
  for (let c = 0; c < cols; c++) {
    const x0 = Math.floor((c * png.width) / cols);
    const x1 = Math.floor(((c + 1) * png.width) / cols);
    const top = averageRegion(png, x0, x1, y0Top, y1Top);
    const bottom = averageRegion(png, x0, x1, y0Bottom, y1Bottom);
    const topOn = top.a >= threshold;
    const bottomOn = bottom.a >= threshold;

    if (!topOn && !bottomOn) {
      line += ' ';
    } else if (topOn && bottomOn) {
      line += `\x1b[38;2;${top.r};${top.g};${top.b}m\x1b[48;2;${bottom.r};${bottom.g};${bottom.b}m▀\x1b[0m`;
    } else if (topOn) {
      // \x1b[49m resets only the background to the terminal's own default,
      // rather than guessing at a color for the transparent half.
      line += `\x1b[49m\x1b[38;2;${top.r};${top.g};${top.b}m▀\x1b[0m`;
    } else {
      line += `\x1b[49m\x1b[38;2;${bottom.r};${bottom.g};${bottom.b}m▄\x1b[0m`;
    }
  }
  return line;
}

/**
 * Renders assets/Logo.png as an array of lines of 24-bit-color block art —
 * real color, no special terminal protocol required, which is what actually
 * shows up in Windows Terminal, VS Code's integrated terminal, GNOME
 * Terminal, and effectively every other modern terminal that isn't Kitty/
 * iTerm2. Returns an array (not a joined string) so the caller can splice
 * individual lines into a layout (e.g. banner.js's boxed left column)
 * instead of only ever printing it as one standalone block; returns null if
 * the asset can't be read/decoded for any reason.
 *
 * `cols` is rounded down to an even number since each pair of source
 * pixel-rows becomes one printed line. `threshold` (0-255, how covered a
 * cell must be by non-transparent pixels to render as visible) needs to go
 * *down* as `cols` gets smaller: a coarser grid averages away more of the
 * source's thin lines/dots per cell, and a small embedded render (e.g. 16
 * cols, for banner.js's box) would come out looking nearly blank at the same
 * threshold that looks right for a large standalone one (e.g. 60 cols).
 */
export function renderBlockArtLines(cols, threshold = 24) {
  const evenCols = Math.max(2, cols & ~1);

  try {
    const png = PNG.sync.read(fs.readFileSync(LOGO_PATH));
    const pixelRows = Math.max(2, Math.round(evenCols * (png.height / png.width)) & ~1);
    const lines = [];

    for (let r = 0; r < pixelRows; r += 2) {
      const y0Top = Math.floor((r * png.height) / pixelRows);
      const y1Top = Math.floor(((r + 1) * png.height) / pixelRows);
      const y0Bottom = y1Top;
      const y1Bottom = Math.floor(((r + 2) * png.height) / pixelRows);
      lines.push(renderBlockArtRow(png, evenCols, threshold, y0Top, y1Top, y0Bottom, y1Bottom));
    }

    return lines;
  } catch {
    return null;
  }
}
