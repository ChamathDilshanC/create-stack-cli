import pc from 'picocolors';

/**
 * picocolors only exposes the 16 standard ANSI colors — genuinely too few
 * for six visually-distinct project-type accents, and ANSI blue in
 * particular renders as a dark navy on most terminals' default black
 * background (barely readable, the exact complaint that prompted this).
 * This renders real 24-bit truecolor from a hex string instead, gated on
 * the same `isColorSupported` check picocolors itself uses (NO_COLOR,
 * non-TTY, ...) so plain/piped output still stays plain, not raw escape codes.
 */
export function hex(hexColor) {
  if (!pc.isColorSupported) return (text) => String(text);

  const clean = hexColor.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return (text) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}
