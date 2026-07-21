import path from 'node:path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';

import { commandOutputTail, createSpinner, logger, spinnerFail, spinnerSucceed } from './utils.js';

const INITIALIZR_BASE = 'https://start.spring.io';

/**
 * A small, deliberately short offline fallback — used only when start.spring.io
 * can't be reached (metadata fetch failed). This is NOT the source of truth:
 * every normal run fetches the real, current dependency catalog live, exactly
 * so this list never needs to track what Spring Initializr adds/renames/retires.
 */
const FALLBACK_DEPENDENCIES = [
  { id: 'web', name: 'Spring Web', group: 'Web', description: 'Build web, REST APIs with Spring MVC.' },
  { id: 'data-jpa', name: 'Spring Data JPA', group: 'SQL', description: 'Persist data in SQL stores with Java Persistence API.' },
  { id: 'h2', name: 'H2 Database', group: 'SQL', description: 'In-memory database.' },
  { id: 'postgresql', name: 'PostgreSQL Driver', group: 'SQL', description: 'JDBC driver for PostgreSQL.' },
  { id: 'mysql', name: 'MySQL Driver', group: 'SQL', description: 'JDBC driver for MySQL.' },
  { id: 'validation', name: 'Validation', group: 'I/O', description: 'Bean Validation with Hibernate validator.' },
  { id: 'lombok', name: 'Lombok', group: 'Developer Tools', description: 'Reduce boilerplate for POJOs.' },
  { id: 'devtools', name: 'Spring Boot DevTools', group: 'Developer Tools', description: 'Automatic restarts, live reload.' },
  { id: 'security', name: 'Spring Security', group: 'Security', description: 'Authentication and authorization.' },
  { id: 'actuator', name: 'Spring Boot Actuator', group: 'Ops', description: 'Production-ready monitoring endpoints.' },
];

const FALLBACK_JAVA_VERSIONS = ['21', '17'];
const FALLBACK_BOOT_VERSION = '3.4.1';

let cachedMetadata;

/**
 * Fetches Spring Initializr's own live metadata (dependency catalog, Boot
 * versions, Java versions) instead of shipping a copy in this package — the
 * whole point being that this list is exactly as current as start.spring.io
 * itself, never stale. Cached per-process since prompts.js and spring.js
 * both need it and it never changes mid-run.
 */
export async function fetchSpringMetadata() {
  if (cachedMetadata) return cachedMetadata;

  const res = await fetch(`${INITIALIZR_BASE}/metadata/client`, {
    headers: { Accept: 'application/vnd.initializr.v2.2+json' },
  });
  if (!res.ok) throw new Error(`start.spring.io responded with HTTP ${res.status}`);
  cachedMetadata = await res.json();
  return cachedMetadata;
}

/** Flattens metadata's grouped dependency catalog into clack's `{ value, label, hint }` option shape for a searchable multiselect — label is the searchable name, hint carries the category + blurb shown under the highlighted entry. */
export function dependencyChoicesFromMetadata(metadata) {
  const groups = metadata?.dependencies?.values ?? [];
  return groups.flatMap((group) =>
    group.values.map((dep) => ({
      value: dep.id,
      label: dep.name,
      hint: `${group.name}${dep.description ? ` — ${dep.description}` : ''}`,
    }))
  );
}

function fallbackChoices() {
  return FALLBACK_DEPENDENCIES.map((dep) => ({
    value: dep.id,
    label: dep.name,
    hint: `${dep.group} — ${dep.description}`,
  }));
}

/**
 * Everything prompts.js's Spring-specific steps need: dependency choices to
 * search, and the Java-version options to pick from. Falls back to a tiny
 * built-in list (with a warning) only when the live catalog can't be reached
 * — the same "network first, local fallback" shape as installOrRecord and
 * pipInstallOrRecord already use elsewhere in this CLI.
 */
export async function getSpringChoices(warnings) {
  try {
    const metadata = await fetchSpringMetadata();
    const javaVersions = (metadata?.javaVersion?.values ?? FALLBACK_JAVA_VERSIONS.map((id) => ({ id })))
      .map((v) => v.id)
      .sort((a, b) => Number(b) - Number(a));
    return {
      dependencies: dependencyChoicesFromMetadata(metadata),
      javaVersions: javaVersions.length > 0 ? javaVersions : FALLBACK_JAVA_VERSIONS,
      bootVersion: metadata?.bootVersion?.default ?? FALLBACK_BOOT_VERSION,
      live: true,
    };
  } catch (err) {
    warnings.push(
      `Could not reach start.spring.io for the live dependency catalog (${err.message}) — falling back to a short built-in list. Re-run once you're back online for the full, current catalog.`
    );
    return {
      dependencies: fallbackChoices(),
      javaVersions: FALLBACK_JAVA_VERSIONS,
      bootVersion: FALLBACK_BOOT_VERSION,
      live: false,
    };
  }
}

/** The current recommended Boot version, resolved fresh at generation time so it's never a stale value carried over from earlier in the prompt flow. */
async function resolveBootVersion() {
  try {
    const metadata = await fetchSpringMetadata();
    return metadata?.bootVersion?.default ?? FALLBACK_BOOT_VERSION;
  } catch {
    return FALLBACK_BOOT_VERSION;
  }
}

/** Maven's artifactId rules: lowercase, alphanumeric plus `-`/`.`, must start with a letter. */
function toArtifactId(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[^a-z]+/, '');
  return base || 'demo';
}

/** Java's package-name rules: dot-separated identifiers, no hyphens. */
function toJavaPackageSegment(name) {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return /^[a-z]/.test(safe) ? safe : `a${safe}`;
}

/**
 * Downloads a generated project straight from start.spring.io/starter.zip —
 * the same endpoint start.spring.io's own web UI and Spring's official CLIs
 * use — and extracts it into targetDir. `baseDir=.` asks Initializr to zip
 * the project's files at the archive root, so no wrapping folder needs to be
 * unwrapped afterward.
 */
export async function scaffoldSpringProject(options) {
  const { targetDir, packageName, buildTool, packaging, javaVersion, springDependencies = [] } = options;
  await fs.ensureDir(targetDir);

  // 'devtools' enables Spring Boot's own auto-restart-on-recompile — folded
  // in here (deduped via Set) rather than left for the user to have to find
  // and add themselves in the dependency search.
  const dependencies = [...new Set(options.springHotReload ? [...springDependencies, 'devtools'] : springDependencies)];

  // Resolved here rather than trusted from options: --yes/non-interactive
  // runs never go through stepSpringJavaVersion (the only place that would
  // otherwise have fetched it), and even in the interactive flow, using the
  // live default at the moment of generation instead of whatever was current
  // several prompts ago is the more correct "never stale" behavior anyway.
  const bootVersion = options.bootVersion || (await resolveBootVersion());

  const artifactId = toArtifactId(packageName);
  const groupId = options.groupId || 'com.example';
  const javaPackage = `${groupId}.${toJavaPackageSegment(artifactId.replace(/-/g, ''))}`;

  const params = new URLSearchParams({
    type: `${buildTool}-project`,
    language: 'java',
    bootVersion,
    baseDir: '.',
    groupId,
    artifactId,
    name: artifactId,
    description: `${artifactId} — scaffolded with create-stack`,
    packageName: javaPackage,
    packaging,
    javaVersion,
    dependencies: dependencies.join(','),
  });

  const spinner = createSpinner('Generating Spring Boot project (start.spring.io)...');
  try {
    const res = await fetch(`${INITIALIZR_BASE}/starter.zip?${params.toString()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${body ? ` — ${body.slice(0, 300)}` : ''}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const zip = new AdmZip(buffer);
    zip.extractAllTo(targetDir, true);

    // mvnw/gradlew ship as executable shell scripts in the zip, but zip entry
    // permissions aren't always honored on extraction — Windows doesn't need
    // this, but a project scaffolded here and later built on macOS/Linux
    // needs `./mvnw`/`./gradlew` to actually be runnable.
    if (process.platform !== 'win32') {
      const wrapper = buildTool === 'maven' ? 'mvnw' : 'gradlew';
      const wrapperPath = path.join(targetDir, wrapper);
      if (await fs.pathExists(wrapperPath)) await fs.chmod(wrapperPath, 0o755);
    }

    spinnerSucceed(spinner, `Spring Boot project generated (Spring Boot ${bootVersion}, ${buildTool}, Java ${javaVersion}).`);
  } catch (err) {
    spinnerFail(spinner, 'Spring Boot project generation failed.');
    const tail = commandOutputTail(err);
    if (tail) logger.dim(tail);
    throw new Error(
      `Could not generate the project from start.spring.io (${err.message}). ` +
        'Check your connection and try again, or generate it manually at https://start.spring.io.'
    );
  }

  return { artifactId, groupId, javaPackage };
}

/* ------------------------------------------------------------------ */
/* Layered package structure (controller/service/repository/...)      */
/* ------------------------------------------------------------------ */

const WEB_DEPENDENCY_IDS = ['web', 'webflux'];
const DATA_ACCESS_DEPENDENCY_IDS = ['data-jpa', 'data-mongodb', 'data-jdbc', 'data-r2dbc'];

const dtoJava = (pkg) => `package ${pkg}.dto;

public class HelloResponse {

    private final String message;

    public HelloResponse(String message) {
        this.message = message;
    }

    public String getMessage() {
        return message;
    }
}
`;

const serviceJava = (pkg) => `package ${pkg}.service;

import org.springframework.stereotype.Service;

@Service
public class HelloService {

    public String getGreeting() {
        return "Hello from Spring Boot!";
    }
}
`;

const controllerJava = (pkg) => `package ${pkg}.controller;

import ${pkg}.dto.HelloResponse;
import ${pkg}.service.HelloService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/hello")
public class HelloController {

    private final HelloService helloService;

    public HelloController(HelloService helloService) {
        this.helloService = helloService;
    }

    @GetMapping
    public HelloResponse hello() {
        return new HelloResponse(helloService.getGreeting());
    }
}
`;

const exceptionHandlerJava = (pkg) => `package ${pkg}.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleException(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(Map.of("error", ex.getMessage() != null ? ex.getMessage() : "Unexpected error"));
    }
}
`;

const modelJava = (pkg) => `package ${pkg}.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

@Entity
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    private String email;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }
}
`;

const repositoryJava = (pkg) => `package ${pkg}.repository;

import ${pkg}.model.User;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, Long> {
}
`;

/**
 * Spring Initializr's own generated project is just the bare application
 * class — no layering at all. This adds the same kind of enterprise package
 * skeleton every other backend in this CLI gets (controller/service/model/...,
 * via structure.js's generateEnterpriseStructure), but Java-shaped: real
 * packages under the project's actual base package, seeded with working code
 * where it's safe to assume something (a REST layer needs `web` on the
 * classpath; a JPA entity/repository needs `data-jpa`), and an empty
 * `.gitkeep`-tracked package everywhere else — exactly the same "skeleton for
 * what you haven't built yet" idea structure.js already applies elsewhere.
 */
export async function generateSpringStructure(options, warnings, javaPackage) {
  const { targetDir, springDependencies = [] } = options;
  const hasWeb = WEB_DEPENDENCY_IDS.some((id) => springDependencies.includes(id));
  const hasJpa = springDependencies.includes('data-jpa');
  const hasDataAccess = DATA_ACCESS_DEPENDENCY_IDS.some((id) => springDependencies.includes(id));

  const spinner = createSpinner('Generating layered package structure...');
  try {
    const baseDir = path.join(targetDir, 'src', 'main', 'java', ...javaPackage.split('.'));

    const write = async (relPackage, fileName, content) => {
      await fs.outputFile(path.join(baseDir, relPackage, fileName), content);
    };
    const empty = async (relPackage) => {
      await fs.outputFile(path.join(baseDir, relPackage, '.gitkeep'), '');
    };

    if (hasWeb) {
      await write('dto', 'HelloResponse.java', dtoJava(javaPackage));
      await write('service', 'HelloService.java', serviceJava(javaPackage));
      await write('controller', 'HelloController.java', controllerJava(javaPackage));
      await write('exception', 'GlobalExceptionHandler.java', exceptionHandlerJava(javaPackage));
    } else {
      await empty('dto');
      await empty('service');
      await empty('controller');
      await empty('exception');
    }

    if (hasJpa) {
      await write('model', 'User.java', modelJava(javaPackage));
      await write('repository', 'UserRepository.java', repositoryJava(javaPackage));
    } else if (hasDataAccess) {
      await empty('model');
      await empty('repository');
    }

    await empty('config');

    spinnerSucceed(spinner, 'Layered package structure generated (controller/service/repository/model/dto/config/exception).');
  } catch (err) {
    spinnerFail(spinner, 'Layered package structure could not be fully generated.');
    warnings.push(`Some Spring Boot packages may be missing — ${err.message}. You can create them manually if needed.`);
  }
}
