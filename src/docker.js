import path from 'node:path';
import fs from 'fs-extra';
import ora from 'ora';

import { spinnerFail, spinnerSucceed } from './utils.js';

/** Node backend / SSR flavor: build stage, then run the app's own start script. */
const nodeDockerfile = ({ buildCommand, startCommand, port }) => `# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM base AS build
COPY . .
${buildCommand ? `RUN ${buildCommand}\n` : ''}
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app .
EXPOSE ${port}
CMD ${JSON.stringify(startCommand.split(' '))}
`;

/** Static frontend flavor: build the SPA, then serve the output with nginx (container always listens on 80). */
const staticDockerfile = ({ buildCommand }) => `# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN ${buildCommand}

FROM nginx:alpine AS runner
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;

const composeTemplate = (serviceName, hostPort, containerPort) => `services:
  app:
    build: .
    container_name: ${serviceName}
    ports:
      - "${hostPort}:${containerPort}"
    env_file:
      - .env
    restart: unless-stopped
`;

/**
 * Writes a basic Dockerfile + docker-compose.yml + .dockerignore.
 * `flavor`/`buildCommand`/`startCommand`/`port` are decided by the caller
 * (scaffold.js's handlers), which already knows the framework's actual
 * build/start scripts — this module just renders the template. For the
 * `static` flavor nginx always listens on 80 inside the container; `port`
 * is only the host-side port it gets published on.
 */
export async function applyDocker(options, warnings, { flavor, buildCommand, startCommand, port }) {
  const spinner = ora({ text: 'Generating Docker files...', indent: 2 }).start();
  try {
    const containerPort = flavor === 'static' ? 80 : port;
    const dockerfile =
      flavor === 'static'
        ? staticDockerfile({ buildCommand })
        : nodeDockerfile({ buildCommand, startCommand, port });

    await fs.writeFile(path.join(options.targetDir, 'Dockerfile'), dockerfile);
    await fs.writeFile(
      path.join(options.targetDir, 'docker-compose.yml'),
      composeTemplate(options.packageName, port, containerPort)
    );
    await fs.writeFile(path.join(options.targetDir, '.dockerignore'), 'node_modules\ndist\nbuild\n.git\n');

    // docker-compose's `env_file: .env` must resolve to a real file, even an
    // empty one, or `docker compose up` fails before the container starts.
    const envPath = path.join(options.targetDir, '.env');
    if (!(await fs.pathExists(envPath))) {
      await fs.writeFile(envPath, '');
    }

    spinnerSucceed(spinner, 'Docker files generated (Dockerfile, docker-compose.yml).');
  } catch (err) {
    spinnerFail(spinner, 'Docker file generation failed.');
    warnings.push(`Docker files could not be written: ${err.message}`);
  }
}
