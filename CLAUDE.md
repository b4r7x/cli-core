# cli-core

Shared CLI framework for building registry-based CLIs (shadcn-style). Published as `@b4r7/cli-core`.

## What This Package Provides

### CLI Framework
- `createCli(options)` / `runCli(program)` — entry point with banner, interactive menu, error handling
- `Command` (re-exported from `commander`) — command definitions
- `z` (re-exported from `zod`) — schema validation
- `pc` (re-exported from `picocolors`) — terminal colors

### Generic Workflows
Standardized, reusable workflows that both `keyscope` and `diff-ui` CLIs delegate to:
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
├── index.ts              # barrel exports
├── cli.ts                # createCli, runCli
├── registry.ts           # types, loader, dependency resolution
├── config.ts             # JSON config I/O
├── command-helpers.ts    # withErrorHandler, createRequireConfig, getItemOrThrow
├── logger.ts             # output + prompts
├── detect.ts             # package manager, source dir
├── package-manager.ts    # npm install utilities
├── add-helpers.ts        # file writing with rollback
├── bundler/              # registry bundler
│   ├── index.ts          # createBundler entry point
│   ├── types.ts          # bundler types
│   ├── schemas.ts        # bundler schemas
│   └── detect-imports.ts # detectNpmImports
├── fs.ts                 # filesystem utilities
└── workflows/
    ├── init.ts           # (planned) generic init workflow
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
