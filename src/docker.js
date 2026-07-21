import path from 'node:path';
import fs from 'fs-extra';

import { createSpinner, spinnerFail, spinnerSucceed } from './utils.js';

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

/** Python backend flavor: no venv inside the container — dependencies install straight into the image's own site-packages. */
const pythonDockerfile = ({ startCommand, port }) => `# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${port}
CMD ${JSON.stringify(startCommand.replace(/^\.venv\/bin\//, '').split(' '))}
`;

/** Java/Spring Boot flavor: build with the project's own Maven/Gradle wrapper, then run the packaged jar on a slim JRE. */
const javaDockerfile = ({ buildTool, javaVersion, port }) => {
  const jdkVersion = javaVersion || '21';
  const wrapper = buildTool === 'gradle' ? './gradlew' : './mvnw';
  const buildCommand = buildTool === 'gradle' ? `${wrapper} bootJar --no-daemon` : `${wrapper} -B package -DskipTests`;
  const jarGlob = buildTool === 'gradle' ? 'build/libs/*.jar' : 'target/*.jar';

  return `# syntax=docker/dockerfile:1
FROM eclipse-temurin:${jdkVersion}-jdk AS build
WORKDIR /app
COPY . .
RUN chmod +x ${wrapper} && ${buildCommand}

FROM eclipse-temurin:${jdkVersion}-jre AS runner
WORKDIR /app
COPY --from=build /app/${jarGlob} app.jar
EXPOSE ${port}
CMD ["java", "-jar", "app.jar"]
`;
};

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
export async function applyDocker(options, warnings, { flavor, buildCommand, startCommand, port, buildTool, javaVersion }) {
  const spinner = createSpinner('Generating Docker files...');
  try {
    const containerPort = flavor === 'static' ? 80 : port;
    const dockerfile =
      flavor === 'static'
        ? staticDockerfile({ buildCommand })
        : flavor === 'python'
          ? pythonDockerfile({ startCommand, port })
          : flavor === 'java'
            ? javaDockerfile({ buildTool, javaVersion, port })
            : nodeDockerfile({ buildCommand, startCommand, port });

    await fs.writeFile(path.join(options.targetDir, 'Dockerfile'), dockerfile);
    await fs.writeFile(
      path.join(options.targetDir, 'docker-compose.yml'),
      composeTemplate(options.packageName, port, containerPort)
    );
    const dockerignore =
      flavor === 'python'
        ? '.venv\n__pycache__\n*.pyc\n.git\n'
        : flavor === 'java'
          ? 'target\nbuild\n.gradle\n.mvn\nHELP.md\n.git\n'
          : 'node_modules\ndist\nbuild\n.git\n';
    await fs.writeFile(path.join(options.targetDir, '.dockerignore'), dockerignore);

    // docker-compose's `env_file: .env` needs a real file to exist, but not
    // necessarily yet — scaffoldProject() always calls applyEnvFiles() right
    // after the handler this runs inside of finishes, well before the user
    // could actually run `docker compose up`.

    spinnerSucceed(spinner, 'Docker files generated (Dockerfile, docker-compose.yml).');
  } catch (err) {
    spinnerFail(spinner, 'Docker file generation failed.');
    warnings.push(`Docker files could not be written: ${err.message}`);
  }
}
