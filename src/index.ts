export { createCli, runCli, type CliOptions } from "./cli.js";

export {
  createInitCommand, createAddCommand, createListCommand,
  createDiffCommand, createRemoveCommand,
  type ExtraOption,
} from "./command-factories.js";

export { createItemAccessors, createInstallChecker, parseEnumOption } from "./command-helpers.js";

export {
  createConfigModule,
  loadJsonConfig, writeJsonConfig, updateManifest,
  aliasPathSchema, resolveAliasedPaths,
  type ConfigLoadResult,
} from "./config.js";

export {
  REGISTRY_ORIGIN,
  RegistryItemSchema,
  BaseRegistryBundleSchema, RegistryContentFileSchema, RegistryContentItemSchema,
  createRegistryLoader, createRegistryAccessors,
  metaField, parseRegistryDependencyRef,
  type RegistryItem, type RegistryContentItem, type RegistryAccessors,
} from "./registry.js";

export { findOrphanedNpmDeps } from "./workflows/remove.js";

export type { FileOp } from "./add-helpers.js";

export { ensureWithinDir, readTsConfigPaths, writeFileSafe, copyGeneratedDir, atomicWriteFile, isEnoent } from "./fs.js";

export { depName, normalizeVersionSpec, getInstalledDeps, installDepsWithSpinner } from "./package-manager.js";

export { detectPackageManager, detectSourceDir, readPackageJson, readPackageVersion, type PackageManager, type PackageJson } from "./detect.js";

export { info, warn, heading, promptSelect } from "./logger.js";

export { createBundler } from "./bundler/index.js";

export type { BundleFile, BundleItem, BundlerConfig, BundleResult } from "./bundler/types.js";
