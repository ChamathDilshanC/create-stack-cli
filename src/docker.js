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

/** Rust/Axum flavor: build the release binary with Cargo, then run it directly on a slim Debian base (no runtime needed, just the compiled binary). */
const rustDockerfile = ({ binaryName, port }) => `# syntax=docker/dockerfile:1
FROM rust:1-slim AS build
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim AS runner
WORKDIR /app
COPY --from=build /app/target/release/${binaryName} ./${binaryName}
EXPOSE ${port}
CMD ["./${binaryName}"]
`;

/** Go/Gin/Fiber/Echo flavor: build a static binary, then run it on a bare Alpine base (no runtime needed, just the compiled binary) — same two-stage shape as Rust above. */
const goDockerfile = ({ binaryName, port }) => `# syntax=docker/dockerfile:1
FROM golang:1.23-alpine AS build
WORKDIR /app
COPY . .
RUN go mod tidy && go build -o ${binaryName} .

FROM alpine:latest AS runner
WORKDIR /app
COPY --from=build /app/${binaryName} ./${binaryName}
EXPOSE ${port}
CMD ["./${binaryName}"]
`;

/** PHP/Laravel flavor: single-stage — Composer itself is grabbed from its own official image rather than a separate build stage, since there's nothing to compile. */
const phpDockerfile = ({ startCommand, port }) => `# syntax=docker/dockerfile:1
FROM php:8.3-cli
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends unzip git libzip-dev \\
    && docker-php-ext-install pdo pdo_mysql zip \\
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY composer.json composer.lock* ./
RUN composer install --no-dev --no-interaction --prefer-dist
COPY . .
EXPOSE ${port}
CMD ${JSON.stringify(startCommand.split(' '))}
`;

/** Ruby/Rails flavor: single-stage — build-essential + libsqlite3-dev cover compiling the native gems (sqlite3, etc.) Rails' own default Gemfile pulls in. */
const rubyDockerfile = ({ startCommand, port }) => `# syntax=docker/dockerfile:1
FROM ruby:3.3-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libsqlite3-dev git \\
    && rm -rf /var/lib/apt/lists/*
COPY Gemfile Gemfile.lock* ./
RUN bundle install
COPY . .
EXPOSE ${port}
CMD ${JSON.stringify(startCommand.split(' '))}
`;

/** C#/ASP.NET Core flavor: publish with the full SDK image, then run the published output on the lighter ASP.NET runtime image — same two-stage shape as Java above. */
const dotnetDockerfile = ({ projectName, port }) => `# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /app
COPY . .
RUN dotnet publish -c Release -o /out ${projectName}.csproj

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runner
WORKDIR /app
COPY --from=build /out .
EXPOSE ${port}
ENV ASPNETCORE_URLS=http://+:${port}
ENTRYPOINT ["dotnet", "${projectName}.dll"]
`;

/** Deno/Fresh/Oak flavor: Deno needs no separate install step (imports resolve straight from deno.json) — `deno cache` just pre-warms the module cache into this layer; `|| true` keeps a cache miss from failing the whole build. */
const denoDockerfile = ({ startCommand, port }) => `# syntax=docker/dockerfile:1
FROM denoland/deno:alpine
WORKDIR /app
COPY . .
RUN deno cache main.ts || true
EXPOSE ${port}
CMD ${JSON.stringify(startCommand.split(' '))}
`;

/** Kotlin/Ktor flavor: build the fat jar with Gradle (via the io.ktor.plugin's own buildFatJar task, always run through the gradle:8-jdk21 image's bundled Gradle — not the project's own ./gradlew, which may not exist if the host had no system Gradle to generate it from), then run it on a slim JRE — same two-stage shape as Java above. */
const kotlinDockerfile = ({ port }) => `# syntax=docker/dockerfile:1
FROM gradle:8-jdk21 AS build
WORKDIR /app
COPY . .
RUN gradle buildFatJar --no-daemon

FROM eclipse-temurin:21-jre AS runner
WORKDIR /app
COPY --from=build /app/build/libs/*-all.jar app.jar
EXPOSE ${port}
CMD ["java", "-jar", "app.jar"]
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

/** One builder per flavor — `nodeDockerfile` (the historical default) is the fallback for an unrecognized/omitted flavor, kept out of this table on purpose so that fallback stays obvious at the call site below. */
const DOCKERFILE_BUILDERS = {
  static: staticDockerfile,
  python: pythonDockerfile,
  java: javaDockerfile,
  rust: rustDockerfile,
  go: goDockerfile,
  php: phpDockerfile,
  ruby: rubyDockerfile,
  dotnet: dotnetDockerfile,
  deno: denoDockerfile,
  kotlin: kotlinDockerfile,
};

/** What each flavor's own build/dependency directories look like — kept out of the Docker build context the same way each ecosystem's own .gitignore keeps them out of git. */
const DOCKERIGNORE_BY_FLAVOR = {
  python: '.venv\n__pycache__\n*.pyc\n.git\n',
  java: 'target\nbuild\n.gradle\n.mvn\nHELP.md\n.git\n',
  rust: 'target\n.git\n',
  go: '.git\n*.exe\n',
  php: 'vendor\nnode_modules\n.git\n',
  ruby: '.bundle\nlog\ntmp\n.git\n',
  dotnet: 'bin\nobj\n.git\n',
  deno: '.git\n',
  kotlin: 'build\n.gradle\n.git\n',
};

/**
 * Writes a basic Dockerfile + docker-compose.yml + .dockerignore.
 * `flavor`/`buildCommand`/`startCommand`/`port` are decided by the caller
 * (scaffold.js's handlers), which already knows the framework's actual
 * build/start scripts — this module just renders the template. For the
 * `static` flavor nginx always listens on 80 inside the container; `port`
 * is only the host-side port it gets published on.
 */
export async function applyDocker(
  options,
  warnings,
  { flavor, buildCommand, startCommand, port, buildTool, javaVersion, binaryName, projectName }
) {
  const spinner = createSpinner('Generating Docker files...');
  try {
    const containerPort = flavor === 'static' ? 80 : port;
    // Every builder destructures only the params it needs from one shared
    // object — passing all of them through unconditionally is harmless, and
    // keeps this a flat lookup instead of a ternary chain that gets harder
    // to scan with every new flavor.
    const buildDockerfile = DOCKERFILE_BUILDERS[flavor] ?? nodeDockerfile;
    const dockerfile = buildDockerfile({ buildCommand, startCommand, port, buildTool, javaVersion, binaryName, projectName });

    await fs.writeFile(path.join(options.targetDir, 'Dockerfile'), dockerfile);
    await fs.writeFile(
      path.join(options.targetDir, 'docker-compose.yml'),
      composeTemplate(options.packageName, port, containerPort)
    );
    const dockerignore = DOCKERIGNORE_BY_FLAVOR[flavor] ?? 'node_modules\ndist\nbuild\n.git\n';
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
