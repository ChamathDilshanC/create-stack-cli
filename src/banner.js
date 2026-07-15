import boxen from 'boxen';
import pc from 'picocolors';

export function printBanner(version) {
  const title = `${pc.bold(pc.cyan('create-stack'))} ${pc.dim(`v${version}`)}`;
  const tagline = 'Universal, interactive project scaffolder';
  const stack = pc.dim('React · Vue · Angular · Vanilla — TypeScript or JavaScript');

  console.log(
    boxen(`${title}\n\n${tagline}\n${stack}`, {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
      textAlignment: 'center',
    })
  );
}
