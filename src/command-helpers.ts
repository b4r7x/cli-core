import { existsSync } from "node:fs";
import { resolve } from "node:path";
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

function createRequireConfig<TResolved>(options: {
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

function getItemOrThrow<T extends RegistryItem>(
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

function validateItems<T extends RegistryItem>(
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

export function parseEnumOption<T extends string>(
  value: string,
  validValues: readonly T[],
  optionName: string,
): T {
  if (!validValues.includes(value as T)) {
    throw new Error(
      `Invalid ${optionName}: "${value}". Must be one of: ${validValues.join(", ")}`,
    );
  }
  return value as T;
}

function fileExistsWithExtensions(base: string, exts: string[]): boolean {
  if (existsSync(base)) return true;
  return exts.some((ext) => existsSync(base + ext) || existsSync(resolve(base, `index${ext}`)));
}

export function createInstallChecker(options: {
  getManifest: () => Record<string, unknown> | undefined;
  getItem: (name: string) => RegistryItem | undefined;
  getRelativePath: (file: { path: string; targetPath?: string }) => string;
  installDir: string;
  extensions?: string[];
}): (name: string) => boolean {
  const exts = options.extensions ?? [".tsx", ".ts", ".jsx", ".js"];

  return (name: string): boolean => {
    const manifest = options.getManifest();
    if (manifest && name in manifest) return true;

    const item = options.getItem(name);
    if (!item) return false;

    return item.files.some((file) => {
      const base = resolve(options.installDir, options.getRelativePath(file));
      return fileExistsWithExtensions(base, exts);
    });
  };
}

export interface CreateItemAccessorsOptions<TConfig, TItem extends RegistryItem = RegistryItem> {
  configFileName: string;
  initCommand: string;
  itemLabel: string;
  listCommand: string;
  loadResolved: (cwd: string) => ConfigLoadResult<TConfig>;
  getItem: (name: string) => TItem | undefined;
}

export function createItemAccessors<TConfig, TItem extends RegistryItem = RegistryItem>(options: CreateItemAccessorsOptions<TConfig, TItem>) {
  const requireConfig = createRequireConfig({
    configFileName: options.configFileName,
    initCommand: options.initCommand,
    loadResolved: options.loadResolved,
  });

  function getOrThrow(name: string): TItem {
    return getItemOrThrow(name, options.getItem, options.itemLabel, options.listCommand);
  }

  function validate(names: string[]): void {
    validateItems(names, options.getItem, options.itemLabel, options.listCommand);
  }

  return { requireConfig, getOrThrow, validate };
}
