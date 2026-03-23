// CLI entry
export { createCli, runCli, type CliOptions } from "./cli.js";

// Command factories
export {
  createInitCommand, createAddCommand, createListCommand,
  createDiffCommand, createRemoveCommand,
  type ExtraOption,
} from "./command-factories.js";

// Command helpers
export { createItemAccessors, createInstallChecker, parseEnumOption } from "./command-helpers.js";

// Config
export {
  createConfigModule,
  loadJsonConfig, writeJsonConfig, updateManifest,
  aliasPathSchema, resolveAliasedPaths,
  type ConfigLoadResult,
} from "./config.js";

// Registry
export {
  BaseRegistryBundleSchema, RegistryContentFileSchema, RegistryContentItemSchema,
  createRegistryLoader, createRegistryAccessors,
  metaField, parseRegistryDependencyRef,
  type RegistryItem, type RegistryContentItem, type RegistryAccessors,
} from "./registry.js";

// Workflows (only publicly-useful utilities)
export { findOrphanedNpmDeps } from "./workflows/remove.js";

// Add helpers (types only)
export type { FileOp } from "./add-helpers.js";

// Filesystem
export { ensureWithinDir, readTsConfigPaths, writeFileSafe, copyGeneratedDir } from "./fs.js";

// Package manager
export { depName, normalizeVersionSpec, getInstalledDeps, installDepsWithSpinner } from "./package-manager.js";

// Detection
export { detectPackageManager, detectSourceDir, readPackageJson, type PackageManager, type PackageJson } from "./detect.js";

// Logger
export { info, warn, heading, promptSelect } from "./logger.js";

// Bundler
export { createBundler } from "./bundler/index.js";


