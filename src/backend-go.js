import path from 'node:path';
import fs from 'fs-extra';

import { applyDocker } from './docker.js';
import { checkToolchain, missingToolchainWarning } from './runtime-check.js';
import { tryRun } from './scaffold-utils.js';
import { logger } from './utils.js';

/** Go module names: lowercase, digits, hyphens, underscores; must start with a letter — same shape as toCargoPackageName in scaffold.js, since bare (non-domain-qualified) module names follow the same practical convention. */
function toGoModuleName(packageName) {
  const base = packageName
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z_]/.test(base) ? base || 'app' : `app-${base}`;
}

const GIN_GO_MOD = (mod) => `module ${mod}

go 1.23

require github.com/gin-gonic/gin v1.10.0
`;

const GIN_MAIN_GO = (mod) => `package main

import (
	"log"

	"${mod}/internal/config"
	"${mod}/internal/routes"
)

func main() {
	port := config.Port()
	router := routes.NewRouter()

	log.Printf("Server running at http://localhost:%s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
`;

const GIN_ROUTES_GO = (mod) => `package routes

import (
	"github.com/gin-gonic/gin"

	"${mod}/internal/handlers"
)

func NewRouter() *gin.Engine {
	router := gin.Default()
	router.GET("/", handlers.Root)
	return router
}
`;

const GIN_HANDLERS_GO = (mod) => `package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"${mod}/internal/models"
)

func Root(c *gin.Context) {
	c.JSON(http.StatusOK, models.Message{Message: "Hello from Gin!"})
}
`;

const FIBER_GO_MOD = (mod) => `module ${mod}

go 1.23

require github.com/gofiber/fiber/v2 v2.52.5
`;

const FIBER_MAIN_GO = (mod) => `package main

import (
	"log"

	"${mod}/internal/config"
	"${mod}/internal/routes"
)

func main() {
	port := config.Port()
	app := routes.NewApp()

	log.Printf("Server running at http://localhost:%s", port)
	log.Fatal(app.Listen(":" + port))
}
`;

const FIBER_ROUTES_GO = (mod) => `package routes

import (
	"github.com/gofiber/fiber/v2"

	"${mod}/internal/handlers"
)

func NewApp() *fiber.App {
	app := fiber.New()
	app.Get("/", handlers.Root)
	return app
}
`;

const FIBER_HANDLERS_GO = (mod) => `package handlers

import (
	"github.com/gofiber/fiber/v2"

	"${mod}/internal/models"
)

func Root(c *fiber.Ctx) error {
	return c.JSON(models.Message{Message: "Hello from Fiber!"})
}
`;

const ECHO_GO_MOD = (mod) => `module ${mod}

go 1.23

require github.com/labstack/echo/v4 v4.12.0
`;

const ECHO_MAIN_GO = (mod) => `package main

import (
	"log"

	"${mod}/internal/config"
	"${mod}/internal/routes"
)

func main() {
	port := config.Port()
	e := routes.NewEcho()

	log.Printf("Server running at http://localhost:%s", port)
	log.Fatal(e.Start(":" + port))
}
`;

const ECHO_ROUTES_GO = (mod) => `package routes

import (
	"github.com/labstack/echo/v4"

	"${mod}/internal/handlers"
)

func NewEcho() *echo.Echo {
	e := echo.New()
	e.GET("/", handlers.Root)
	return e
}
`;

const ECHO_HANDLERS_GO = (mod) => `package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"${mod}/internal/models"
)

func Root(c echo.Context) error {
	return c.JSON(http.StatusOK, models.Message{Message: "Hello from Echo!"})
}
`;

/** Shared across all three routers — a plain data struct, no framework-specific trait to differ on (same idea as scaffold.js's RUST_MODELS_RS). */
const GO_MODELS_GO = `package models

type Message struct {
	Message string ` + '`json:"message"`' + `
}
`;

/** Also shared — reads PORT from the environment (wired into .env by env.js), same idea as every other backend's PORT var. */
const GO_CONFIG_GO = `package config

import "os"

func Port() string {
	if port := os.Getenv("PORT"); port != "" {
		return port
	}
	return "8080"
}
`;

const GO_TEMPLATES = {
  'go-gin': { label: 'Gin', goMod: GIN_GO_MOD, mainGo: GIN_MAIN_GO, routesGo: GIN_ROUTES_GO, handlersGo: GIN_HANDLERS_GO },
  'go-fiber': { label: 'Fiber', goMod: FIBER_GO_MOD, mainGo: FIBER_MAIN_GO, routesGo: FIBER_ROUTES_GO, handlersGo: FIBER_HANDLERS_GO },
  'go-echo': { label: 'Echo', goMod: ECHO_GO_MOD, mainGo: ECHO_MAIN_GO, routesGo: ECHO_ROUTES_GO, handlersGo: ECHO_HANDLERS_GO },
};

/**
 * None of Gin/Fiber/Echo has an official project-scaffolding CLI (no
 * "go run gin-new" equivalent), so — like Express/Fastify/Axum/Actix-web —
 * this writes go.mod + main.go by hand instead of running an initializer.
 * The generic JS-shaped enterprise structure doesn't fit Go conventions
 * (same reasoning Rust/Spring Boot skip it), so this lays down Go's own
 * idiomatic package split instead: internal/{routes,handlers,models,config},
 * mirroring the module split scaffold.js's Rust handler already uses.
 *
 * `go mod tidy` resolves + downloads dependencies (writing go.sum) the same
 * way `cargo build` does for Rust — there's no separate "install" step in
 * prompts.js for this runtime (stepInstall forces it off), so this only
 * offers to run it opportunistically when a caller does pass install: true;
 * otherwise go.mod is left ready for the user's own first `go build`/`go run`.
 */
export async function handleGoBackend(options, warnings) {
  const { targetDir, packageName, framework, install } = options;
  await fs.ensureDir(targetDir);

  const template = GO_TEMPLATES[framework];
  const mod = toGoModuleName(packageName);

  await fs.outputFile(path.join(targetDir, 'go.mod'), template.goMod(mod));
  await fs.outputFile(path.join(targetDir, 'main.go'), template.mainGo(mod));
  await fs.outputFile(path.join(targetDir, 'internal', 'routes', 'routes.go'), template.routesGo(mod));
  await fs.outputFile(path.join(targetDir, 'internal', 'handlers', 'handlers.go'), template.handlersGo(mod));
  await fs.outputFile(path.join(targetDir, 'internal', 'models', 'models.go'), GO_MODELS_GO);
  await fs.outputFile(path.join(targetDir, 'internal', 'config', 'config.go'), GO_CONFIG_GO);
  // `go build` (no -o flag) drops a binary named after the module right at
  // the project root — ignoring it by that exact name, plus the Windows
  // .exe variant, keeps a stray compiled binary out of git the same way
  // Rust's .gitignore keeps /target out.
  await fs.writeFile(path.join(targetDir, '.gitignore'), `/${mod}\n${mod}.exe\n.env\n`);

  logger.dim(`  › Wrote go.mod + main.go + internal/{routes,handlers,models,config} by hand (${template.label} has no official project scaffolder).`);

  const goFound = await checkToolchain('go', ['version']);
  if (!goFound) {
    warnings.push(missingToolchainWarning('The Go toolchain', 'https://go.dev/dl/'));
    warnings.push(`Once Go is installed, run "go mod tidy" inside the project to resolve ${template.label}'s dependencies, then "go run .".`);
  } else if (install) {
    await tryRun({
      label: 'Resolving Go module dependencies (go mod tidy)...',
      success: 'Go dependencies resolved (go.sum written).',
      failure: 'go mod tidy failed — run it yourself once you\'re back online.',
      command: 'go',
      args: ['mod', 'tidy'],
      cwd: targetDir,
    });
  } else {
    warnings.push(`Go/${template.label} projects resolve dependencies via Cargo-style on-demand fetch — run "go mod tidy" then "go run ." to fetch dependencies, compile, and start the server.`);
  }

  if (options.docker) {
    await applyDocker(options, warnings, { flavor: 'go', binaryName: mod, port: 8080 });
  }
}
