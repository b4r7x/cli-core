import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readTsConfigPaths, isEnoent } from "./fs.js";
import { warn, toErrorMessage } from "./logger.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageJson {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export function readPackageJson(cwd: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf-8"));
  } catch (e) {
    if (!isEnoent(e)) warn(`Could not read package.json: ${toErrorMessage(e)}`);
    return null;
  }
}

function fromPackageManagerField(pkg: PackageJson | null): PackageManager | null {
  const field = pkg?.packageManager;
  if (field?.startsWith("pnpm")) return "pnpm";
  if (field?.startsWith("yarn")) return "yarn";
  if (field?.startsWith("bun")) return "bun";
  return null;
}

function fromUserAgent(): PackageManager | null {
  const agent = process.env.npm_config_user_agent;
  if (agent?.includes("pnpm")) return "pnpm";
  if (agent?.includes("yarn")) return "yarn";
  if (agent?.includes("bun")) return "bun";
  return null;
}

const LOCKFILES: Array<{ file: string; pm: PackageManager }> = [
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "bun.lockb", pm: "bun" },
  { file: "bun.lock", pm: "bun" },
  { file: "package-lock.json", pm: "npm" },
];

function fromLockfile(cwd: string): PackageManager | null {
  const found = LOCKFILES
    .map(({ file, pm }) => ({ path: resolve(cwd, file), pm }))
    .filter(({ path }) => existsSync(path));

  if (found.length <= 1) return found[0]?.pm ?? null;

  const uniquePms = [...new Set(found.map(f => f.pm))];
  if (uniquePms.length > 1) {
    warn(`Multiple lockfiles detected (${uniquePms.join(", ")}). Using the most recently modified.`);
  }
  const mtimes = new Map(found.map(f => [f.path, statSync(f.path).mtimeMs]));
  found.sort((a, b) => (mtimes.get(b.path) ?? 0) - (mtimes.get(a.path) ?? 0));
  return found[0]?.pm ?? null;
}

export function detectPackageManager(cwd: string, pkg?: PackageJson | null): PackageManager {
  const pkgJson = pkg ?? readPackageJson(cwd);
  return fromPackageManagerField(pkgJson) ?? fromUserAgent() ?? fromLockfile(cwd) ?? "npm";
}

export function readPackageVersion(importMetaUrl: string, relativePath: string): string {
  const req = createRequire(importMetaUrl);
  return (req(relativePath) as { version: string }).version;
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
