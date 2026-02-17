import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readTsConfigPaths } from "./fs.js";
import { warn, toErrorMessage } from "./logger.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageJson {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export function readPackageJson(cwd: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf-8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      warn(`Could not read package.json: ${toErrorMessage(e)}`);
    }
    return null;
  }
}

export function detectPackageManager(cwd: string, pkg?: PackageJson | null): PackageManager {
  const pkgJson = pkg ?? readPackageJson(cwd);
  if (pkgJson) {
    if (pkgJson.packageManager?.startsWith("pnpm")) return "pnpm";
    if (pkgJson.packageManager?.startsWith("yarn")) return "yarn";
    if (pkgJson.packageManager?.startsWith("bun")) return "bun";
  }

  const agent = process.env.npm_config_user_agent;
  if (agent?.includes("pnpm")) return "pnpm";
  if (agent?.includes("yarn")) return "yarn";
  if (agent?.includes("bun")) return "bun";

  const lockfiles: Array<{ file: string; pm: PackageManager }> = [
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "bun.lockb", pm: "bun" },
    { file: "bun.lock", pm: "bun" },
    { file: "package-lock.json", pm: "npm" },
  ];

  const found = lockfiles
    .map(({ file, pm }) => ({ path: resolve(cwd, file), pm }))
    .filter(({ path }) => existsSync(path));

  if (found.length > 1) {
    const uniquePms = [...new Set(found.map(f => f.pm))];
    if (uniquePms.length > 1) {
      warn(`Multiple lockfiles detected (${uniquePms.join(", ")}). Using the most recently modified.`);
    }
    const mtimes = new Map(found.map(f => [f.path, statSync(f.path).mtimeMs]));
    found.sort((a, b) => mtimes.get(b.path)! - mtimes.get(a.path)!);
  }

  return found[0]?.pm ?? "npm";
}

export function detectSourceDir(cwd: string): string {
  const paths = readTsConfigPaths(cwd);
  const mapping = paths?.["@/*"];
  if (Array.isArray(mapping)) {
    for (const entry of mapping) {
      const match = entry.match(/^\.\/([^*]+)\*/);
      if (match?.[1]) {
        return match[1].replace(/\/$/, "");
      }
    }
  }

  return existsSync(resolve(cwd, "src")) ? "src" : ".";
}
