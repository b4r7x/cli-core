import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { toErrorMessage, warn } from "./logger.js";
import { detectSourceDir } from "./detect.js";
import { atomicWriteFile } from "./fs.js";

const ALIAS_PATTERN = /^(@\/|\.\.?\/)/;

export const aliasPathSchema = z.string().regex(ALIAS_PATTERN, 'Must start with "@/" or a relative path').optional();

function aliasToFsPath(alias: string, sourceDir?: string): string {
  const stripped = alias.replace(/^@\//, "");
  return sourceDir && sourceDir !== "." ? `${sourceDir}/${stripped}` : stripped;
}

export type ConfigLoadResult<T> =
  | { ok: true; config: T }
  | { ok: false; error: "not_found" | "parse_error" | "validation_error" | "unknown_error"; message?: string };

export function loadJsonConfig<T>(
  configFileName: string,
  schema: z.ZodType<T>,
  cwd: string,
): ConfigLoadResult<T> {
  const configPath = resolve(cwd, configFileName);
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return { ok: false, error: "not_found" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: "parse_error", message: toErrorMessage(e) };
  }

  return validateParsed(configFileName, schema, parsed);
}

function validateParsed<T>(
  configFileName: string,
  schema: z.ZodType<T>,
  parsed: unknown,
): ConfigLoadResult<T> {
  try {
    return { ok: true, config: schema.parse(parsed) };
  } catch (e) {
    if (e instanceof z.ZodError) {
      const details = e.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
      return { ok: false, error: "validation_error", message: `Invalid ${configFileName}:\n${details}` };
    }
    return { ok: false, error: "unknown_error", message: toErrorMessage(e) };
  }
}

export function writeJsonConfig(configFileName: string, data: unknown, cwd: string): void {
  const configPath = resolve(cwd, configFileName);
  try {
    atomicWriteFile(configPath, JSON.stringify(data, null, 2) + "\n");
  } catch (e) {
    throw new Error(`Failed to write config to ${configPath}: ${toErrorMessage(e)}`);
  }
}

export function resolveAliasedPaths<K extends string>(
  rawPaths: Record<K, string | undefined>,
  aliases: Record<K, string>,
  cwd?: string,
): Record<K, string> {
  const sourceDir = cwd ? detectSourceDir(cwd) : ".";
  const entries = (Object.keys(rawPaths) as K[]).map(
    (key) => [key, rawPaths[key] ?? aliasToFsPath(aliases[key], sourceDir)] as const,
  );
  return Object.fromEntries(entries) as Record<K, string>;
}

export function updateManifest<T extends Record<string, unknown>>(opts: {
  configFileName: string;
  schema: z.ZodType<T>;
  manifestKey: string;
  cwd: string;
  add?: string[];
  remove?: string[];
  metadata?: Record<string, unknown>;
}): void {
  const result = loadJsonConfig(opts.configFileName, opts.schema, opts.cwd);
  if (!result.ok) {
    warn(`Could not update manifest: config not found or invalid.`);
    return;
  }

  // Spread into a mutable record for manifest mutation — safe since T extends Record<string, unknown>
  // and this is only used for JSON serialization, not returned as T.
  const config: Record<string, unknown> = { ...result.config };
  const existing = config[opts.manifestKey];
  const manifest = mutateManifest(
    { ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {}) },
    opts.add, opts.remove, opts.metadata,
  );

  if (Object.keys(manifest).length > 0) {
    config[opts.manifestKey] = manifest;
  } else {
    delete config[opts.manifestKey];
  }
  writeJsonConfig(opts.configFileName, config, opts.cwd);
}

export function createConfigModule<
  TRaw extends Record<string, unknown>,
  TResolved,
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
>(opts: {
  configFileName: string;
  schema: z.ZodType<TRaw>;
  resolveConfig: (raw: TRaw, cwd: string) => TResolved;
  manifestKey: string;
}) {
  const { configFileName, schema, resolveConfig: resolve, manifestKey } = opts;

  function load(cwd: string): ConfigLoadResult<TRaw> {
    return loadJsonConfig(configFileName, schema, cwd);
  }

  function loadResolved(cwd: string): ConfigLoadResult<TResolved> {
    const result = load(cwd);
    if (!result.ok) return result;
    return { ok: true, config: resolve(result.config, cwd) };
  }

  function write(cwd: string, config: TRaw): void {
    writeJsonConfig(configFileName, config, cwd);
  }

  function update(
    cwd: string,
    add?: string[],
    remove?: string[],
    metadata?: TMetadata,
  ): void {
    updateManifest({ configFileName, schema, manifestKey, cwd, add, remove, metadata });
  }

  function getItems(cwd: string): Record<string, unknown> | undefined {
    const result = load(cwd);
    if (!result.ok) return undefined;
    const val = result.config[manifestKey];
    return val && typeof val === "object" && !Array.isArray(val)
      ? val as Record<string, unknown>
      : undefined;
  }

  return {
    loadConfig: load,
    loadResolvedConfig: loadResolved,
    writeConfig: write,
    updateManifest: update,
    getManifestItems: getItems,
  };
}

function mutateManifest(
  manifest: Record<string, unknown>,
  add?: string[],
  remove?: string[],
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  if (add) {
    const now = new Date().toISOString();
    for (const name of add) manifest[name] = { installedAt: now, ...(metadata ?? {}) };
  }
  if (remove) {
    for (const name of remove) delete manifest[name];
  }
  return manifest;
}
