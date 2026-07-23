import path from 'node:path';
import fs from 'fs-extra';

import { checkToolchain, missingToolchainWarning } from './runtime-check.js';
import { tryRun } from './scaffold-utils.js';
import { logger } from './utils.js';

/** Gradle project names: same practical convention as backend-kotlin.js's toGradleProjectName. */
function toGradleProjectName(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'app';
}

const SETTINGS_GRADLE_KTS = (name) => `rootProject.name = "${name}"

include(":shared", ":app")
`;

const ROOT_BUILD_GRADLE_KTS = `plugins {
    kotlin("multiplatform") version "2.0.20" apply false
    kotlin("jvm") version "2.0.20" apply false
}

allprojects {
    repositories {
        mavenCentral()
    }
}
`;

/**
 * Only a `jvm()` target, not the full Android/iOS/JS spread a "real" KMP app
 * would eventually want — those each need their own SDK (Android Studio +
 * the Android SDK, Xcode, ...) this CLI can't assume is installed, and
 * getting their Gradle wiring subtly wrong would be worse than not
 * attempting it. `jvm()` is the one target buildable and runnable with
 * nothing beyond the JDK this project already needs for Gradle itself —
 * `androidTarget()`/`iosX64()`/etc. are a couple of lines to add once those
 * toolchains are actually present (see the warning pushed below).
 *
 * No `application` plugin here: Gradle's own KMP plugin explicitly warns
 * that `application` (and the plain `java` plugin it pulls in) isn't
 * compatible applied directly alongside `kotlin("multiplatform")` in the
 * same module — confirmed by actually running this and reading the
 * warning, which points at exactly the fix below: a separate JVM-only
 * subproject (`:app`) that depends on `:shared` and owns `application`
 * instead.
 */
const SHARED_BUILD_GRADLE_KTS = `plugins {
    kotlin("multiplatform") version "2.0.20"
}

kotlin {
    jvm()

    sourceSets {
        val commonMain by getting
        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
            }
        }
    }
}
`;

/** Plain Kotlin/JVM, not multiplatform — its only job is owning the `application` plugin (mainClass + the `run` task) and depending on `:shared` for the actual logic. */
const APP_BUILD_GRADLE_KTS = `plugins {
    kotlin("jvm") version "2.0.20"
    application
}

dependencies {
    implementation(project(":shared"))
}

application {
    mainClass.set("MainKt")
}
`;

/** \`expect\`/\`actual\` is Kotlin Multiplatform's own mechanism for "one shared API, a per-platform implementation" — Greeting.kt (commonMain) declares the contract, Platform.jvm.kt (shared's jvmMain) is the one implementation this scaffold ships; adding androidMain/iosMain later just means adding their own actual fun getPlatform() alongside it. */
const GREETING_KT = `package com.example.shared

class Greeting {
    private val platform: String = getPlatform()

    fun greet(): String = "Hello from Kotlin Multiplatform, running on $platform!"
}

expect fun getPlatform(): String
`;

const PLATFORM_JVM_KT = `package com.example.shared

actual fun getPlatform(): String = "JVM \${System.getProperty("java.version")}"
`;

const MAIN_KT = `import com.example.shared.Greeting

fun main() {
    println(Greeting().greet())
}
`;

const GREETING_TEST_KT = `package com.example.shared

import kotlin.test.Test
import kotlin.test.assertTrue

class GreetingTest {
    @Test
    fun testGreetingContainsPlatform() {
        assertTrue(Greeting().greet().contains("JVM"))
    }
}
`;

const GRADLE_PROPERTIES = `kotlin.code.style=official
kotlin.mpp.stability.nowarn=true
`;

/**
 * Hand-written, the same "no verified public project-generator API" story
 * backend-kotlin.js's Ktor handler already tells — the JetBrains KMP wizard
 * (kmp.jetbrains.com) is a web form with no documented REST API this CLI
 * could safely script against, so this writes a minimal-but-real two-module
 * project (:shared, the actual KMP module; :app, a plain JVM runner — see
 * SHARED_BUILD_GRADLE_KTS above for why they're split) by hand instead,
 * mirroring Ktor's own gradle-wrapper-if-available handling. Verified by
 * actually running `gradle :app:run` against this exact output.
 */
export async function handleKmpMobile(options, warnings) {
  const { targetDir, packageName } = options;
  await fs.ensureDir(targetDir);

  const projectName = toGradleProjectName(packageName);
  const commonMain = (...segments) => path.join(targetDir, 'shared', 'src', 'commonMain', 'kotlin', 'com', 'example', 'shared', ...segments);
  const sharedJvmMain = (...segments) => path.join(targetDir, 'shared', 'src', 'jvmMain', 'kotlin', 'com', 'example', 'shared', ...segments);
  const commonTest = (...segments) => path.join(targetDir, 'shared', 'src', 'commonTest', 'kotlin', 'com', 'example', 'shared', ...segments);
  const appMain = (...segments) => path.join(targetDir, 'app', 'src', 'main', 'kotlin', ...segments);

  await fs.outputFile(path.join(targetDir, 'settings.gradle.kts'), SETTINGS_GRADLE_KTS(projectName));
  await fs.outputFile(path.join(targetDir, 'build.gradle.kts'), ROOT_BUILD_GRADLE_KTS);
  await fs.outputFile(path.join(targetDir, 'gradle.properties'), GRADLE_PROPERTIES);
  await fs.outputFile(path.join(targetDir, 'shared', 'build.gradle.kts'), SHARED_BUILD_GRADLE_KTS);
  await fs.outputFile(commonMain('Greeting.kt'), GREETING_KT);
  await fs.outputFile(sharedJvmMain('Platform.jvm.kt'), PLATFORM_JVM_KT);
  await fs.outputFile(commonTest('GreetingTest.kt'), GREETING_TEST_KT);
  await fs.outputFile(path.join(targetDir, 'app', 'build.gradle.kts'), APP_BUILD_GRADLE_KTS);
  await fs.outputFile(appMain('Main.kt'), MAIN_KT);
  await fs.writeFile(path.join(targetDir, '.gitignore'), '.gradle/\nbuild/\n.idea/\n*.iml\nlocal.properties\n.env\n');

  logger.dim('  › Wrote settings.gradle.kts + shared/{commonMain,jvmMain,commonTest} + app/ by hand (the JetBrains KMP wizard has no scriptable public API).');

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
      `${missingToolchainWarning('Gradle', 'https://gradle.org/install/')} Alternatively, open the project folder in Android Studio or IntelliJ IDEA, which can generate the wrapper and resolve dependencies on their own.`
    );
  }

  warnings.push(
    'Only a jvm() target was scaffolded (see shared/build.gradle.kts) — add androidTarget()/iosX64()/etc. once you have the Android SDK/Xcode installed; this CLI can\'t safely assume either is present.'
  );
  if (options.docker) {
    warnings.push('Docker support was skipped — mobile apps run on-device/in-simulator and are not typically containerized.');
  }
}
