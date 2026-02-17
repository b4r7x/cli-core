import { error, toErrorMessage } from "./logger.js";
import type { ConfigLoadResult } from "./config.js";
import type { RegistryItem } from "./registry.js";

export function withErrorHandler<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<void>) {
  return async (...args: TArgs) => {
    try {
      await fn(...args);
    } catch (e) {
      error(toErrorMessage(e));
      process.exit(1);
    }
  };
}

/**
 * Factory that creates a `requireConfig(cwd)` function for a CLI.
 * Throws user-friendly errors when config is missing or malformed.
 */
export function createRequireConfig<TRaw, TResolved>(options: {
  configFileName: string;
  initCommand: string;
  loadResolved: (cwd: string) => ConfigLoadResult<TResolved>;
}): (cwd: string) => TResolved {
  return (cwd: string): TResolved => {
    const result = options.loadResolved(cwd);
    if (!result.ok) {
      if (result.error === "parse_error" || result.error === "validation_error" || result.error === "unknown_error") {
        throw new Error(`${options.configFileName} is malformed: ${result.message}\nFix the config and try again.`);
      }
      throw new Error(`No ${options.configFileName} found. Run \`${options.initCommand}\` first.`);
    }
    return result.config;
  };
}

/**
 * Returns the registry item or throws a user-friendly error.
 */
export function getItemOrThrow<T extends RegistryItem>(
  name: string,
  getItem: (name: string) => T | undefined,
  itemLabel: string,
  listCommand: string,
): T {
  const item = getItem(name);
  if (!item) {
    throw new Error(`${itemLabel} "${name}" not found in registry. Run \`${listCommand}\` to see available ${itemLabel.toLowerCase()}s.`);
  }
  return item;
}

/**
 * Validates that all names exist in the registry. Collects all missing items and reports them at once.
 */
export function validateItems<T extends RegistryItem>(
  names: string[],
  getItem: (name: string) => T | undefined,
  itemLabel: string,
  listCommand: string,
): void {
  const missing = names.filter((name) => !getItem(name));
  if (missing.length > 0) {
    throw new Error(
      `${itemLabel}(s) not found in registry: ${missing.map((n) => `"${n}"`).join(", ")}. Run \`${listCommand}\` to see available ${itemLabel.toLowerCase()}s.`,
    );
  }
}

/**
 * Strips known path prefixes from a registry file path.
 * Tries each prefix in order and returns the path with the first match removed.
 */
export function getRelativePath(
  file: { path: string; targetPath?: string },
  prefixes: string[],
): string {
  if (file.targetPath) {
    return file.targetPath;
  }
  for (const prefix of prefixes) {
    if (file.path.startsWith(prefix)) {
      return file.path.slice(prefix.length);
    }
  }
  throw new Error(
    `Unsupported registry file path "${file.path}". Expected path to start with one of: ${prefixes.map(p => `"${p}"`).join(", ")}.`,
  );
}
