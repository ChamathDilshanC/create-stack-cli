import { hex } from './color.js';

/**
 * This project's mascot — a Braille dragon, in the same spirit as
 * neofetch's own distro ASCII/Braille art. Unlike the network-graph
 * Logo.png this replaced for the terminal banner (still used for the
 * README header and npm package listing), this is a hand-placed piece of
 * text, not derived from a raster image at all: nothing to decode, no
 * resolution/threshold tuning, no per-terminal graphics-protocol detection
 * needed — just one colored block of text that renders identically
 * everywhere a TTY with 24-bit color support does (Windows Terminal, VS
 * Code's integrated terminal, iTerm2, Kitty, ...).
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
 * Returns the dragon art as an array of colored lines, ready for the caller
 * to print standalone (banner.js prints it above the summary box). Returns
 * null when stdout isn't a real TTY (piped to a file, CI logs, ...), since
 * raw escape codes have no business there.
 */
export function renderDragonLines() {
  if (!process.stdout.isTTY) return null;
  return DRAGON_ART.split('\n').map((line) => DRAGON_COLOR(line));
}
