import path from 'node:path';
import fs from 'fs-extra';

import { applyDocker } from './docker.js';
import { writeGoAirConfig } from './hot-reload.js';
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
	"${mod}/internal/middleware"
	"${mod}/internal/repository"
	"${mod}/internal/services"
)

func NewRouter() *gin.Engine {
	repo := repository.NewUserRepository()
	userService := services.NewUserService(repo)
	h := handlers.New(userService)

	router := gin.New()
	router.Use(gin.Recovery(), middleware.Logging())

	router.GET("/", h.Root)
	router.GET("/users", h.ListUsers)

	return router
}
`;

const GIN_HANDLERS_GO = (mod) => `package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"${mod}/internal/models"
	"${mod}/internal/services"
)

type Handlers struct {
	users *services.UserService
}

func New(users *services.UserService) *Handlers {
	return &Handlers{users: users}
}

func (h *Handlers) Root(c *gin.Context) {
	c.JSON(http.StatusOK, models.Message{Message: "Hello from Gin!"})
}

func (h *Handlers) ListUsers(c *gin.Context) {
	c.JSON(http.StatusOK, h.users.ListUsers())
}
`;

const GIN_MIDDLEWARE_GO = `package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// Logging is a small example of where cross-cutting concerns (auth,
// rate limiting, request IDs, ...) belong — as their own middleware,
// registered once in routes.go, instead of copy-pasted into every handler.
func Logging() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Printf("%s %s (%s)", c.Request.Method, c.Request.URL.Path, time.Since(start))
	}
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
	"${mod}/internal/middleware"
	"${mod}/internal/repository"
	"${mod}/internal/services"
)

func NewApp() *fiber.App {
	repo := repository.NewUserRepository()
	userService := services.NewUserService(repo)
	h := handlers.New(userService)

	app := fiber.New()
	app.Use(middleware.Logging())

	app.Get("/", h.Root)
	app.Get("/users", h.ListUsers)

	return app
}
`;

const FIBER_HANDLERS_GO = (mod) => `package handlers

import (
	"github.com/gofiber/fiber/v2"

	"${mod}/internal/models"
	"${mod}/internal/services"
)

type Handlers struct {
	users *services.UserService
}

func New(users *services.UserService) *Handlers {
	return &Handlers{users: users}
}

func (h *Handlers) Root(c *fiber.Ctx) error {
	return c.JSON(models.Message{Message: "Hello from Fiber!"})
}

func (h *Handlers) ListUsers(c *fiber.Ctx) error {
	return c.JSON(h.users.ListUsers())
}
`;

const FIBER_MIDDLEWARE_GO = `package middleware

import (
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Logging is a small example of where cross-cutting concerns (auth,
// rate limiting, request IDs, ...) belong — as their own middleware,
// registered once in routes.go, instead of copy-pasted into every handler.
func Logging() fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		log.Printf("%s %s (%s)", c.Method(), c.Path(), time.Since(start))
		return err
	}
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
	"${mod}/internal/middleware"
	"${mod}/internal/repository"
	"${mod}/internal/services"
)

func NewEcho() *echo.Echo {
	repo := repository.NewUserRepository()
	userService := services.NewUserService(repo)
	h := handlers.New(userService)

	e := echo.New()
	e.Use(middleware.Logging)

	e.GET("/", h.Root)
	e.GET("/users", h.ListUsers)

	return e
}
`;

const ECHO_HANDLERS_GO = (mod) => `package handlers

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"${mod}/internal/models"
	"${mod}/internal/services"
)

type Handlers struct {
	users *services.UserService
}

func New(users *services.UserService) *Handlers {
	return &Handlers{users: users}
}

func (h *Handlers) Root(c echo.Context) error {
	return c.JSON(http.StatusOK, models.Message{Message: "Hello from Echo!"})
}

func (h *Handlers) ListUsers(c echo.Context) error {
	return c.JSON(http.StatusOK, h.users.ListUsers())
}
`;

const ECHO_MIDDLEWARE_GO = `package middleware

import (
	"log"
	"time"

	"github.com/labstack/echo/v4"
)

// Logging is a small example of where cross-cutting concerns (auth,
// rate limiting, request IDs, ...) belong — as their own middleware,
// registered once in routes.go, instead of copy-pasted into every handler.
func Logging(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		start := time.Now()
		err := next(c)
		log.Printf("%s %s (%s)", c.Request().Method, c.Request().URL.Path, time.Since(start))
		return err
	}
}
`;

/** Shared across all three routers — plain data structs, no framework-specific trait to differ on (same idea as scaffold.js's RUST_MODELS_RS). */
const GO_MODELS_GO = `package models

type Message struct {
	Message string ` + '`json:"message"`' + `
}

type User struct {
	ID    int    ` + '`json:"id"`' + `
	Name  string ` + '`json:"name"`' + `
	Email string ` + '`json:"email"`' + `
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

/**
 * Shared across all three routers too — plain Go, no framework dependency.
 * In-memory on purpose: this step doesn't force a database choice the way
 * Spring's JPA-conditional model/repository pair does, so an in-memory map
 * is what keeps this a real, working example instead of a stub — swap it
 * for a real database-backed implementation once you've picked one; nothing
 * above this layer (UserService) needs to change to do that.
 */
const GO_REPOSITORY_GO = (mod) => `package repository

import (
	"sync"

	"${mod}/internal/models"
)

type UserRepository struct {
	mu     sync.Mutex
	users  map[int]models.User
	nextID int
}

func NewUserRepository() *UserRepository {
	return &UserRepository{
		users: map[int]models.User{
			1: {ID: 1, Name: "Ada Lovelace", Email: "ada@example.com"},
		},
		nextID: 2,
	}
}

func (r *UserRepository) FindAll() []models.User {
	r.mu.Lock()
	defer r.mu.Unlock()

	users := make([]models.User, 0, len(r.users))
	for _, u := range r.users {
		users = append(users, u)
	}
	return users
}

func (r *UserRepository) Create(name, email string) models.User {
	r.mu.Lock()
	defer r.mu.Unlock()

	user := models.User{ID: r.nextID, Name: name, Email: email}
	r.users[user.ID] = user
	r.nextID++
	return user
}
`;

/** Also shared — the business-logic layer between handlers and storage. Handlers call this, never the repository directly, so the storage backend can change without touching the HTTP layer. */
const GO_SERVICES_GO = (mod) => `package services

import (
	"${mod}/internal/models"
	"${mod}/internal/repository"
)

type UserService struct {
	repo *repository.UserRepository
}

func NewUserService(repo *repository.UserRepository) *UserService {
	return &UserService{repo: repo}
}

func (s *UserService) ListUsers() []models.User {
	return s.repo.FindAll()
}
`;

const GO_TEMPLATES = {
  'go-gin': {
    label: 'Gin',
    goMod: GIN_GO_MOD,
    mainGo: GIN_MAIN_GO,
    routesGo: GIN_ROUTES_GO,
    handlersGo: GIN_HANDLERS_GO,
    middlewareGo: GIN_MIDDLEWARE_GO,
  },
  'go-fiber': {
    label: 'Fiber',
    goMod: FIBER_GO_MOD,
    mainGo: FIBER_MAIN_GO,
    routesGo: FIBER_ROUTES_GO,
    handlersGo: FIBER_HANDLERS_GO,
    middlewareGo: FIBER_MIDDLEWARE_GO,
  },
  'go-echo': {
    label: 'Echo',
    goMod: ECHO_GO_MOD,
    mainGo: ECHO_MAIN_GO,
    routesGo: ECHO_ROUTES_GO,
    handlersGo: ECHO_HANDLERS_GO,
    middlewareGo: ECHO_MIDDLEWARE_GO,
  },
};

/**
 * None of Gin/Fiber/Echo has an official project-scaffolding CLI (no
 * "go run gin-new" equivalent), so — like Express/Fastify/Axum/Actix-web —
 * this writes go.mod + main.go by hand instead of running an initializer.
 * The generic JS-shaped enterprise structure doesn't fit Go conventions
 * (same reasoning Rust/Spring Boot skip it), so this lays down Go's own
 * layered package split instead — routes/handlers/middleware/services/
 * repository/models/config — mirroring the controller/service/repository/
 * model split spring.js's generateSpringStructure already builds for Spring
 * Boot, adapted to Go's own handler-struct-plus-constructor idiom instead of
 * Java's class-plus-annotation one. `GET /users` is real, working, wired
 * all the way through (handler → service → in-memory repository), not a
 * stub — the same "always have one working vertical slice" bar Spring's own
 * Hello controller/service/dto chain sets.
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
  await fs.outputFile(path.join(targetDir, 'internal', 'middleware', 'middleware.go'), template.middlewareGo);
  await fs.outputFile(path.join(targetDir, 'internal', 'services', 'user_service.go'), GO_SERVICES_GO(mod));
  await fs.outputFile(path.join(targetDir, 'internal', 'repository', 'user_repository.go'), GO_REPOSITORY_GO(mod));
  await fs.outputFile(path.join(targetDir, 'internal', 'models', 'models.go'), GO_MODELS_GO);
  await fs.outputFile(path.join(targetDir, 'internal', 'config', 'config.go'), GO_CONFIG_GO);
  // `go build` (no -o flag) drops a binary named after the module right at
  // the project root — ignoring it by that exact name, plus the Windows
  // .exe variant, keeps a stray compiled binary out of git the same way
  // Rust's .gitignore keeps /target out.
  await fs.writeFile(path.join(targetDir, '.gitignore'), `/${mod}\n${mod}.exe\n.env\n`);

  logger.dim(`  › Wrote go.mod + main.go + internal/{routes,handlers,middleware,services,repository,models,config} by hand (${template.label} has no official project scaffolder).`);

  if (options.hotReload) {
    await writeGoAirConfig(targetDir, mod, warnings);
  }

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
