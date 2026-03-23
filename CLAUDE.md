# cli-core

Shared CLI framework for building registry-based CLIs (shadcn-style). Published as `@b4r7/cli-core`.

## What This Package Provides

### CLI Framework
- `createCli(options)` / `runCli(program)` — entry point with banner, interactive menu, error handling
- `Command` (re-exported from `commander`) — command definitions

### Command Factories
All 5 standard commands have factories that handle option registration, argument parsing, error handling, and workflow delegation:
- `createInitCommand` — project initialization with config, file scaffolding, and post-setup hooks
- `createAddCommand` — install registry items with dependency resolution, rollback, and dry-run
- `createListCommand` — show available/installed items with JSON output option
- `createDiffCommand` — compare local files vs registry versions
- `createRemoveCommand` — uninstall items, cleanup orphan deps

Consumers provide only domain-specific callbacks (config schema, path resolution, file transforms). Standard options (`--cwd`, `--yes`, `--dry-run`, `--overwrite`, `--skip-install`) are injected by factories.

### Generic Workflows
Standardized, reusable workflows that both `keyscope` and `diff-ui` CLIs delegate to:
- `runInitWorkflow` — detect project settings, create config/files, install deps
- `runListWorkflow` — show available/installed items (`--all`, `--installed-only`, `--json`)
- `runAddWorkflow` — install registry items with dependency resolution (`--all`, `--yes`, `--dry-run`, `--overwrite`)
- `runDiffWorkflow` — compare local files vs registry versions
- `runRemoveWorkflow` — uninstall items, cleanup orphan deps
- `applyInstallPlan` — orchestrate file writes → dep installs → callback with rollback

### Registry System
- `createRegistryLoader()` — cached bundle loading with SHA-256 integrity verification
- `createBundler()` — build-time registry bundling (reads registry.json, embeds file content, computes integrity)
- `resolveRegistryDeps()` — recursive dependency resolution with cycle detection
- `collectNpmDeps()` — gather npm dependencies from registry items
- `metaField()` — type-safe access to item metadata

### Config Management
- `loadJsonConfig()` / `writeJsonConfig()` — atomic JSON config with Zod validation
- `updateManifest()` — add/remove entries in config manifest
- `createRequireConfig()` — middleware that loads config or shows user-friendly error

### File Operations
- `writeFilesWithRollback()` / `rollbackFiles()` — atomic file writes with full rollback on failure
- `installDepsWithRollback()` / `installDepsWithSpinner()` — npm install with progress

### Detection
- `detectPackageManager()` — npm/yarn/pnpm/bun detection
- `detectSourceDir()` — finds `@/*` path alias in tsconfig
- `readPackageJson()` — safe reader

### Logger
- `info()`, `success()`, `warn()`, `error()` — respects `--silent` flag
- `showBanner()` — figlet ASCII art
- `promptConfirm()`, `promptSelect()` — interactive prompts via @clack/prompts

## Structure

```
src/
├── index.ts              # barrel exports (~38 public exports)
├── cli.ts                # createCli, runCli
├── command-factories.ts  # createInitCommand, createAddCommand, createListCommand, createDiffCommand, createRemoveCommand
├── command-helpers.ts    # withErrorHandler, createItemAccessors, createInstallChecker, parseEnumOption
├── registry.ts           # types, loader, dependency resolution, accessors
├── config.ts             # JSON config I/O, createConfigModule
├── logger.ts             # output + prompts
├── detect.ts             # package manager, source dir
├── package-manager.ts    # npm install utilities
├── add-helpers.ts        # file writing with rollback
├── fs.ts                 # filesystem utilities
├── integrity.ts          # SHA-256 integrity computation
├── bundler/              # registry bundler
│   ├── index.ts          # createBundler entry point
│   ├── types.ts          # bundler types
│   ├── schemas.ts        # bundler schemas
│   └── detect-imports.ts # detectNpmImports
└── workflows/
    ├── init.ts           # generic init workflow
    ├── list.ts           # list items
    ├── add.ts            # add items
    ├── diff.ts           # show diffs
    ├── remove.ts         # remove items
    └── apply-install-plan.ts
```

## Commands

```bash
pnpm build          # tsc → dist/
pnpm type-check     # tsc --noEmit
```

## Conventions

- ESM only, `.js` extensions in imports
- Zod v4 for all schemas
- Workflow functions take accessor callbacks (generic, not domain-specific)
- All file operations are atomic with rollback
- `--silent` flag globally respected via `setSilent()`
- `CancelError` for user cancellation (clean exit)

## Adding a New Workflow

1. Create `src/workflows/your-workflow.ts`
2. Export a `runYourWorkflow(options)` function that takes generic callbacks
3. Add export to `src/index.ts`
4. Update consuming CLIs (keyscope, diff-ui) to use the workflow

## Consumers

- `keyscope` CLI — uses all workflows + bundler + config + registry
- `diff-ui` CLI — uses all workflows + bundler + config + registry
- Future CLIs — should follow the same pattern
