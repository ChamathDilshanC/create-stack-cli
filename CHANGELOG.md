# [2.0.0](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.7...v2.0.0) (2026-07-16)


### Features

* orchestrate official scaffolders and add enterprise folder structure ([b1ee1a8](https://github.com/ChamathDilshanC/create-stack-cli/commit/b1ee1a862976aca2393d77600b0ff228d035eb42))


### BREAKING CHANGES

* minimum supported Node version raised to >=20.19.0

## [1.0.7](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.6...v1.0.7) (2026-07-16)


### Bug Fixes

* use setup-node registry-url for GitHub Packages auth instead of manual npmrc append ([95727f5](https://github.com/ChamathDilshanC/create-stack-cli/commit/95727f53190ed7b915972f47e605ed61c2aaab8c))

## [1.0.6](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.5...v1.0.6) (2026-07-16)


### Bug Fixes

* bump vite floor version in templates to latest 5.4.x patch ([a453eae](https://github.com/ChamathDilshanC/create-stack-cli/commit/a453eae89d8899decd15940904982a59f6f787e2))

## [1.0.5](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.4...v1.0.5) (2026-07-16)


### Bug Fixes

* add safe (non-secret-leaking) npmrc diagnostics for GitHub Packages publish ([2c0d242](https://github.com/ChamathDilshanC/create-stack-cli/commit/2c0d24254f38efca3ec6e9dc9f0ddccb7f5d3de5))

## [1.0.4](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.3...v1.0.4) (2026-07-16)


### Bug Fixes

* use dedicated PAT for GitHub Packages auth in CI instead of GITHUB_TOKEN ([920a613](https://github.com/ChamathDilshanC/create-stack-cli/commit/920a61317fc6efd50ca91902e0ec49b29c02c978))

## [1.0.3](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.2...v1.0.3) (2026-07-16)


### Bug Fixes

* write GitHub Packages auth to the correct npm userconfig path in CI ([aaae384](https://github.com/ChamathDilshanC/create-stack-cli/commit/aaae384dd69ee17d90b8a2483b1d9aa56f754813))

## [1.0.2](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.1...v1.0.2) (2026-07-16)


### Bug Fixes

* publish to npm directly instead of relying on semantic-release's whoami check ([9a3b5da](https://github.com/ChamathDilshanC/create-stack-cli/commit/9a3b5da2630ee944687bd8218d17048f1e9817ab))
* publish to public npm by default and fix GitHub Packages auth in CI ([89f2714](https://github.com/ChamathDilshanC/create-stack-cli/commit/89f2714d9adb6d7eaa7a3c1d44fedd378edcc4f2))

## [1.0.1](https://github.com/ChamathDilshanC/create-stack-cli/compare/v1.0.0...v1.0.1) (2026-07-16)


### Bug Fixes

* apply Tailwind utility classes to the starter component instead of just wiring config ([189a8e0](https://github.com/ChamathDilshanC/create-stack-cli/commit/189a8e0f7a71552c108bb640d6a8f262c90de14f))
