# Contributing

Thanks for your interest in improving `create-stack`!

## Getting started

```bash
git clone https://github.com/ChamathDilshanC/create-stack-cli.git
cd create-stack-cli
npm install
npm start -- my-test-app
```

To try the CLI as if it were installed globally:

```bash
npm link
create-stack my-test-app
```

## Making changes

- **CLI logic** lives in `src/` (`prompts.js`, `scaffold.js`, `install.js`, `index.js`, `utils.js`, `banner.js`).
- **Templates** live in `templates/<framework>-<variant>/`. Each template is a standalone, runnable project — after editing one, scaffold it into a temp directory and run its `install`/`build` scripts to confirm it still works.
- Keep templates minimal: they're starting points, not fully-configured production apps.

## Before opening a pull request

- Run `npx create-stack <dir> --template <name> --extras tailwind,eslint,prettier --pm npm --yes` for any template you touched, then `npm install`, `npx eslint .`, and `npm run build` inside the generated project.
- Keep commits focused and use clear, descriptive messages.

## Reporting issues

Open an issue with the command you ran, the flags/answers you gave, and the actual vs. expected output.
