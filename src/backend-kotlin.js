import path from 'node:path';
import fs from 'fs-extra';

import { applyDocker } from './docker.js';
import { checkToolchain, missingToolchainWarning } from './runtime-check.js';
import { tryRun } from './scaffold-utils.js';
import { logger } from './utils.js';

/** Gradle root project names: lowercase, digits, hyphens — same practical convention as toCargoPackageName/toGoModuleName. */
function toGradleProjectName(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'app';
}

const SETTINGS_GRADLE_KTS = (name) => `rootProject.name = "${name}"
`;

/**
 * The `io.ktor.plugin` Gradle plugin is Ktor's own official build-tooling
 * plugin (the same one start.ktor.io's generated projects use) — it adds
 * the `buildFatJar`/`runFatJar` tasks docker.js's kotlinDockerfile relies on,
 * on top of the plain `application` plugin's `run` task used for local dev.
 * `kotlin("plugin.serialization")` is the compiler plugin that actually
 * processes `@Serializable` on the data classes in models/Models.kt — it's
 * a separate concern from the runtime `ktor-serialization-kotlinx-json-jvm`
 * dependency below, and (being part of the Kotlin distribution itself) is
 * always versioned identically to `kotlin("jvm")`.
 * Versions pinned to a long-stable Ktor 2.3.x + Kotlin 1.9.24 pairing rather
 * than the newer Kotlin 2.x/Ktor 3.x combo, to keep this template's version
 * compatibility low-risk.
 */
const BUILD_GRADLE_KTS = `plugins {
    kotlin("jvm") version "1.9.24"
    kotlin("plugin.serialization") version "1.9.24"
    id("io.ktor.plugin") version "2.3.12"
}

group = "com.example"
version = "0.0.1"

application {
    mainClass.set("com.example.ApplicationKt")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-core-jvm")
    implementation("io.ktor:ktor-server-netty-jvm")
    implementation("io.ktor:ktor-server-content-negotiation-jvm")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm")
    implementation("ch.qos.logback:logback-classic:1.5.6")
    testImplementation("io.ktor:ktor-server-test-host-jvm")
    testImplementation("org.jetbrains.kotlin:kotlin-test-junit:1.9.24")
}
`;

const GRADLE_PROPERTIES = `kotlin.code.style=official
`;

/** Thin on purpose — wiring only, same "Application.kt just calls configureX()" idiom start.ktor.io's own generated projects use. */
const APPLICATION_KT = `package com.example

import com.example.plugins.configureRouting
import com.example.plugins.configureSerialization
import io.ktor.server.application.*
import io.ktor.server.engine.*
import io.ktor.server.netty.*

fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    embeddedServer(Netty, port = port, module = Application::module).start(wait = true)
}

fun Application.module() {
    configureSerialization()
    configureRouting()
}
`;

const SERIALIZATION_PLUGIN_KT = `package com.example.plugins

import io.ktor.serialization.kotlinx.json.*
import io.ktor.server.application.*
import io.ktor.server.plugins.contentnegotiation.*

fun Application.configureSerialization() {
    install(ContentNegotiation) {
        json()
    }
}
`;

const ROUTING_PLUGIN_KT = `package com.example.plugins

import com.example.repository.UserRepository
import com.example.routes.registerRoutes
import com.example.services.UserService
import io.ktor.server.application.*
import io.ktor.server.routing.*

fun Application.configureRouting() {
    val userService = UserService(UserRepository())

    routing {
        registerRoutes(userService)
    }
}
`;

const ROUTES_KT = `package com.example.routes

import com.example.models.Message
import com.example.services.UserService
import io.ktor.server.response.*
import io.ktor.server.routing.*

fun Route.registerRoutes(userService: UserService) {
    get("/") {
        call.respond(Message("Hello from Ktor!"))
    }
    get("/users") {
        call.respond(userService.listUsers())
    }
}
`;

/** The business-logic layer between routes and storage — routes call this, never the repository directly, so the storage backend can change without touching the HTTP layer. */
const USER_SERVICE_KT = `package com.example.services

import com.example.models.User
import com.example.repository.UserRepository

class UserService(private val repository: UserRepository) {
    fun listUsers(): List<User> = repository.findAll()
}
`;

/** In-memory on purpose: this step doesn't force a database choice — swap this for a real database-backed implementation (e.g. Exposed) once you've picked one; nothing above this layer needs to change to do that. */
const USER_REPOSITORY_KT = `package com.example.repository

import com.example.models.User
import java.util.concurrent.ConcurrentHashMap

class UserRepository {
    private val users = ConcurrentHashMap<Int, User>().apply {
        put(1, User(id = 1, name = "Ada Lovelace", email = "ada@example.com"))
    }

    fun findAll(): List<User> = users.values.toList()
}
`;

const MODELS_KT = `package com.example.models

import kotlinx.serialization.Serializable

@Serializable
data class Message(val message: String)

@Serializable
data class User(val id: Int, val name: String, val email: String)
`;

const LOGBACK_XML = `<configuration>
    <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>
    <root level="INFO">
        <appender-ref ref="STDOUT" />
    </root>
</configuration>
`;

/**
 * Ktor has no verified, documented public generator API the way Spring
 * Initializr does (start.ktor.io's own generator isn't backed by a stable
 * published REST contract this CLI can safely integrate with) — so this
 * writes a Gradle Kotlin DSL project by hand instead, the same exception
 * already made for Axum/Actix-web/Go/Oak above. The generic JS-shaped
 * enterprise structure is skipped in favor of Ktor's own idiomatic layout
 * instead: a thin Application.kt delegating to plugins/ (Ktor's own
 * "configureX()" convention), plus routes/services/repository/models —
 * the same controller/service/repository/model layering spring.js's
 * generateSpringStructure builds for Spring Boot, adapted to Ktor's own
 * idiom rather than Java's class-plus-annotation one. `GET /users` is real
 * and working end-to-end (route → service → in-memory repository), not a
 * stub — the same "always have one working vertical slice" bar Spring's own
 * Hello controller/service/dto chain sets.
 *
 * If a system `gradle` is found, this runs `gradle wrapper` once so the
 * project gets its own `./gradlew`/`gradlew.bat` for local dev — otherwise
 * it's left without one, with a warning pointing at installing Gradle (or
 * opening the folder in IntelliJ, which manages the wrapper on its own).
 * Docker builds don't depend on this either way — kotlinDockerfile always
 * builds via the `gradle:8-jdk21` base image's own bundled Gradle.
 */
export async function handleKtorBackend(options, warnings) {
  const { targetDir, packageName } = options;
  await fs.ensureDir(targetDir);

  const projectName = toGradleProjectName(packageName);
  const kotlinSrc = (...segments) => path.join(targetDir, 'src', 'main', 'kotlin', 'com', 'example', ...segments);

  await fs.outputFile(path.join(targetDir, 'settings.gradle.kts'), SETTINGS_GRADLE_KTS(projectName));
  await fs.outputFile(path.join(targetDir, 'build.gradle.kts'), BUILD_GRADLE_KTS);
  await fs.outputFile(path.join(targetDir, 'gradle.properties'), GRADLE_PROPERTIES);
  await fs.outputFile(kotlinSrc('Application.kt'), APPLICATION_KT);
  await fs.outputFile(kotlinSrc('plugins', 'Serialization.kt'), SERIALIZATION_PLUGIN_KT);
  await fs.outputFile(kotlinSrc('plugins', 'Routing.kt'), ROUTING_PLUGIN_KT);
  await fs.outputFile(kotlinSrc('routes', 'Routes.kt'), ROUTES_KT);
  await fs.outputFile(kotlinSrc('services', 'UserService.kt'), USER_SERVICE_KT);
  await fs.outputFile(kotlinSrc('repository', 'UserRepository.kt'), USER_REPOSITORY_KT);
  await fs.outputFile(kotlinSrc('models', 'Models.kt'), MODELS_KT);
  await fs.outputFile(path.join(targetDir, 'src', 'main', 'resources', 'logback.xml'), LOGBACK_XML);
  await fs.writeFile(path.join(targetDir, '.gitignore'), '.gradle/\nbuild/\n.idea/\n*.iml\n.env\n');

  logger.dim('  › Wrote settings.gradle.kts + build.gradle.kts + src/main/kotlin/com/example/{plugins,routes,services,repository,models} by hand (Ktor has no verified public project-generator API).');

  const gradleFound = await checkToolchain('gradle', ['--version']);
  if (gradleFound) {
    await tryRun({
      label: 'Generating Gradle wrapper (gradle wrapper)...',
      success: 'Gradle wrapper generated (./gradlew).',
      failure: 'Could not generate the Gradle wrapper — run "gradle wrapper" yourself once you have Gradle available.',
      command: 'gradle',
      args: ['wrapper', '--gradle-version', '8.10'],
      cwd: targetDir,
    });
  } else {
    warnings.push(
      `${missingToolchainWarning('Gradle', 'https://gradle.org/install/')} Alternatively, open the project folder in IntelliJ IDEA, which can generate the wrapper and resolve dependencies on its own.`
    );
  }

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'kotlin', port: 8080 });
  }
}
