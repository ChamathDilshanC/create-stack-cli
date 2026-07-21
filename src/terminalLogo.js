import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import supportsTerminalGraphics from 'supports-terminal-graphics';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'Logo.png');

/**
 * iTerm2's inline image protocol (OSC 1337). Both this and Kitty's below
 * accept a raw PNG's bytes directly, base64-encoded — no pixel decoding
 * needed, so no image-processing dependency (e.g. jimp) is required.
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
 * Renders assets/Logo.png as a real inline image using whichever native
 * terminal-graphics protocol this terminal actually supports (Kitty or
 * iTerm2 — Sixel is deliberately not implemented here: unlike the other two,
 * it needs actual pixel-level encoding, not just a base64-wrapped PNG passthrough).
 * Returns null on any terminal without one of those two (the caller falls
 * back to the plain ASCII bars logo in that case), or if the file can't be
 * read for any reason — this is a cosmetic nice-to-have, never worth failing
 * the CLI over.
 */
export function tryRenderLogo(widthCells = 24) {
  const support = supportsTerminalGraphics.stdout;
  if (!support.kitty && !support.iterm2) return null;

  try {
    const base64 = fs.readFileSync(LOGO_PATH).toString('base64');
    return support.kitty ? renderKitty(base64, widthCells) : renderIterm2(base64, widthCells);
  } catch {
    return null;
  }
}
