# Changelog

## [0.3.0](https://github.com/handleui/nosis/compare/nosis-v0.2.0...nosis-v0.3.0) (2026-02-22)


### Features

* BYOK API keys and Next.js web client ([#22](https://github.com/handleui/nosis/issues/22)) ([ac9b7aa](https://github.com/handleui/nosis/commit/ac9b7aa4c4077bfe1daa6546827f23de2f72cb0b))
* BYOK key management, review fixes, and dead code cleanup ([#21](https://github.com/handleui/nosis/issues/21)) ([e3bfbea](https://github.com/handleui/nosis/commit/e3bfbead12553a0b640865ed29f54dc36f122302))
* implement BYOK user API key management with encrypted storage ([#20](https://github.com/handleui/nosis/issues/20)) ([7b83609](https://github.com/handleui/nosis/commit/7b83609d89df7e6ee59060314949648ed30d901d))
* implement specialist research agents with subagent pattern ([#24](https://github.com/handleui/nosis/issues/24)) ([b7a7d90](https://github.com/handleui/nosis/commit/b7a7d90adaccd2615c08e7c58a63eb91cddaab0b))
* migrate MCP and Arcade from desktop to worker ([#23](https://github.com/handleui/nosis/issues/23)) ([a59fd74](https://github.com/handleui/nosis/commit/a59fd74f35e335267606de5ac1e5ba400b0e0434))
* web/worker runtime split and github code workflows ([#26](https://github.com/handleui/nosis/issues/26)) ([a86578c](https://github.com/handleui/nosis/commit/a86578c7422a25b31110988c822a5e31269d1298))
* **worker:** add Daytona sandbox APIs and validation ([#25](https://github.com/handleui/nosis/issues/25)) ([3d4cdf8](https://github.com/handleui/nosis/commit/3d4cdf893712ef0bc01c0f5b0e231d258cdea7c4))


### Bug Fixes

* correct release-please extra-files paths for monorepo layout ([37732c5](https://github.com/handleui/nosis/commit/37732c5954e8e593e48c9473d608b58fdccdc561))

## [0.2.0](https://github.com/handleui/nosis/compare/nosis-v0.1.0...nosis-v0.2.0) (2026-02-19)


### Features

* adopt Drizzle ORM with auth and authorization ([#18](https://github.com/handleui/nosis/issues/18)) ([faa3d15](https://github.com/handleui/nosis/commit/faa3d15f3422fc5cfe024434406eaf5b5fa1d3a8))
* Phase 4 — Move AI streaming to Worker via Letta provider ([#16](https://github.com/handleui/nosis/issues/16)) ([e49024d](https://github.com/handleui/nosis/commit/e49024dcd081a026fe822c45219d778863c69ae4))
* scaffold bifurcated web UI with chat and code layouts ([#17](https://github.com/handleui/nosis/issues/17)) ([41671e0](https://github.com/handleui/nosis/commit/41671e07f4edb56743055e7008c0964401634a6f))


### Bug Fixes

* handle JSON.parse errors in worker response reading ([#13](https://github.com/handleui/nosis/issues/13)) ([e601068](https://github.com/handleui/nosis/commit/e6010686c8677338863c865a1f2be42b79941a45))
* use bun in D1 migration workflow to resolve workspace protocol error ([217978c](https://github.com/handleui/nosis/commit/217978c234777ba8b8d2b7ac7562e27660c7d629))
