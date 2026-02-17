import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { toErrorMessage, warn } from "./logger.js";
import { detectSourceDir } from "./detect.js";

export { detectSourceDir as detectSourceDirFromTsconfig };

export const ALIAS_PATTERN = /^(@\/|\.\.?\/)/;

export function aliasToFsPath(alias: string, sourceDir?: string): string {
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

  try {
    const config = schema.parse(parsed) as T;
    return { ok: true, config };
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
  const tmpPath = join(cwd, `.tmp-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n");
    renameSync(tmpPath, configPath);
  } catch (e) {
    try { rmSync(tmpPath); } catch {}
    throw new Error(`Failed to write config to ${configPath}: ${toErrorMessage(e)}`);
  }
}

export function updateManifest<T extends Record<string, unknown>>(
  configFileName: string,
  schema: z.ZodType<T>,
  manifestKey: string,
  cwd: string,
  add?: string[],
  remove?: string[],
  metadata?: Record<string, unknown>,
): void {
  const result = loadJsonConfig(configFileName, schema, cwd);
  if (!result.ok) {
    warn(`Could not update manifest: config not found or invalid.`);
    return;
  }

  const config = { ...result.config } as Record<string, unknown>;
  const manifest = { ...(config[manifestKey] as Record<string, unknown> | undefined) };

  if (add) {
    const now = new Date().toISOString();
    for (const name of add) {
      manifest[name] = {
        installedAt: now,
        ...(metadata ?? {}),
      };
    }
  }

  if (remove) {
    for (const name of remove) {
      delete manifest[name];
    }
  }

  if (Object.keys(manifest).length > 0) {
    config[manifestKey] = manifest;
  } else {
    delete config[manifestKey];
  }
  writeJsonConfig(configFileName, config, cwd);
}
