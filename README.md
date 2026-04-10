# @b4r7/cli-core

Shared CLI framework for building registry-based CLIs (shadcn-style). Provides the full lifecycle for component/hook registries: init, add, list, diff, remove — with atomic file writes, rollback, and SHA-256 integrity verification.

## Install

```bash
npm install @b4r7/cli-core
```

## Quick Start

```ts
import { createCli, runCli, Command } from "@b4r7/cli-core";

const program = createCli({
  name: "my-cli",
  version: "1.0.0",
  description: "My registry CLI",
});

program.addCommand(
  new Command("list").description("List available items").action(async () => {
    // use runListWorkflow(...)
  }),
);

runCli(program);
```

## API Overview

| Module | Key Exports |
|--------|-------------|
| `cli.ts` | `createCli`, `runCli` |
| `config.ts` | `loadJsonConfig`, `writeJsonConfig`, `updateManifest` |
| `registry.ts` | `createRegistryLoader`, `resolveRegistryDeps`, `collectNpmDeps`, `metaField` |
| `command-helpers.ts` | `withErrorHandler`, `createRequireConfig`, `createInstallChecker`, `parseEnumOption` |
| `logger.ts` | `showBanner`, `info`, `success`, `warn`, `error`, `promptConfirm`, `promptSelect` |
| `fs.ts` | `writeFileSafe`, `ensureWithinDir`, `readTsConfigPaths` |
| `package-manager.ts` | `detectPackageManager`, `installDeps`, `readPackageJson` |
| `add-helpers.ts` | `writeFilesWithRollback`, `installDepsWithRollback`, `showDryRunPreview` |
| `bundler/` | `createBundler`, `detectNpmImports` |
| `workflows/` | `runInitWorkflow`, `runAddWorkflow`, `runListWorkflow`, `runDiffWorkflow`, `runRemoveWorkflow` |

## Workflows

Generic, reusable workflows that handle the full user interaction for each CLI command:

- **`runInitWorkflow`** — create config file with interactive prompts
- **`runAddWorkflow`** — install registry items with dependency resolution, `--dry-run`, `--overwrite`
- **`runListWorkflow`** — show available/installed items with `--json`, `--installed-only`
- **`runDiffWorkflow`** — compare local files against registry versions
- **`runRemoveWorkflow`** — uninstall items and clean up orphaned dependencies

Workflows take accessor callbacks so they remain domain-agnostic. Your CLI provides the config loader, registry accessor, and path resolver.

## Registry Bundler

Build-time bundling for offline-first CLIs:

```ts
import { createBundler } from "@b4r7/cli-core";

const bundler = createBundler({
  registryPath: "registry/registry.json",
  outputPath: "src/cli/generated/registry-bundle.json",
});

await bundler.bundle();
```

The bundler reads your `registry.json`, embeds all file contents, and computes SHA-256 integrity. At runtime, `createRegistryLoader()` verifies the integrity before loading.

## Reference Implementations

- [keyscope](https://github.com/b4r7x/keyscope) — keyboard navigation hooks CLI
- [diff-ui](https://github.com/b4r7x/diff-ui) — terminal-inspired UI component CLI

## License

MIT
