import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PackageManager } from "./detect.js";
import { warn, toErrorMessage } from "./logger.js";

const VALID_PKG_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const VERSION_SPEC_PATTERN = /^[a-zA-Z0-9._\-~/^*@:+]+$/;

/** Strips the version specifier from a dependency string (e.g. `foo@^1.0` → `foo`). */
export function depName(dep: string): string {
  if (!dep.includes("@")) return dep;
  const searchFrom = dep.startsWith("@") ? dep.indexOf("/") + 1 : 0;
  const versionAt = dep.indexOf("@", searchFrom);
  return versionAt > 0 ? dep.slice(0, versionAt) : dep;
}

/** Validates and normalises a version spec (semver, range, or dist tag). */
export function normalizeVersionSpec(raw: unknown, packageName = "package"): string {
  const spec = String(raw ?? "latest").trim();
  if (spec.length === 0) {
    throw new Error(`${packageName} version cannot be empty.`);
  }
  if (spec.startsWith("-")) {
    throw new Error(`Invalid ${packageName} version "${spec}".`);
  }
  if (!VERSION_SPEC_PATTERN.test(spec)) {
    throw new Error(
      `Invalid ${packageName} version "${spec}". Use a semver, range, or dist tag (for example: latest, 0.1.1, ^0.1.0).`,
    );
  }
  return spec;
}

export function validatePackageNames(deps: string[]): void {
  for (const dep of deps) {
    const searchFrom = dep.startsWith("@") ? dep.indexOf("/") + 1 : 0;
    const versionAt = dep.indexOf("@", searchFrom);
    const name = versionAt > 0 ? dep.slice(0, versionAt) : dep;
    if (!VALID_PKG_NAME.test(name)) {
      throw new Error(`Invalid package name: "${dep}"`);
    }
  }
}

export async function installDeps(pm: PackageManager, deps: string[], cwd: string): Promise<void> {
  if (deps.length === 0) return;
  validatePackageNames(deps);

  const args = pm === "npm" ? ["install", ...deps] : ["add", ...deps];
  return new Promise((res, reject) => {
    execFile(pm, args, { cwd, timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim();
        if (msg) reject(new Error(`${pm} install failed:\n${msg}`));
        else reject(err);
        return;
      }
      res();
    });
  });
}

export function getInstalledDeps(cwd: string): Set<string> {
  try {
    const pkg = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf-8"));
    return new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ]);
  } catch (e) {
    warn(`Could not read package.json dependencies: ${toErrorMessage(e)}`);
    return new Set();
  }
}
