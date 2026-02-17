import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, renameSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export function stripJsonComments(json: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  const len = json.length;
  while (i < len) {
    const ch = json[i];
    if (inString) {
      if (ch === "\\" && i + 1 < len) {
        result += ch + json[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      result += ch;
      i++;
    } else if (ch === '"') {
      inString = true;
      result += ch;
      i++;
    } else if (ch === "/" && json[i + 1] === "/") {
      while (i < len && json[i] !== "\n") i++;
    } else if (ch === "/" && json[i + 1] === "*") {
      i += 2;
      while (i + 1 < len && !(json[i] === "*" && json[i + 1] === "/")) i++;
      i += 2;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

export function ensureWithinDir(targetPath: string, baseDir: string): void {
  const resolvedTarget = resolve(targetPath);
  const resolvedBase = resolve(baseDir);
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `Path traversal detected: "${targetPath}" escapes "${baseDir}"`,
    );
  }
}

export function ensureWithinAnyDir(targetPath: string, baseDirs: string[]): void {
  const resolvedTarget = resolve(targetPath);
  for (const dir of baseDirs) {
    const resolvedBase = resolve(dir);
    const rel = relative(resolvedBase, resolvedTarget);
    if (!rel.startsWith("..") && !isAbsolute(rel)) return;
  }
  throw new Error(
    `Path traversal detected: "${targetPath}" escapes all allowed directories: ${baseDirs.map(d => `"${d}"`).join(", ")}`,
  );
}

export function cleanEmptyDirs(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      if (existsSync(dir) && readdirSync(dir).length === 0) {
        rmSync(dir, { recursive: true });
      }
    } catch {
      // May already be cleaned up
    }
  }
}

/** Reads tsconfig.json or jsconfig.json and returns the `compilerOptions.paths` record, or null. */
export function readTsConfigPaths(cwd: string): Record<string, string[]> | null {
  for (const configFile of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const raw = readFileSync(resolve(cwd, configFile), "utf-8");
      const config = JSON.parse(stripJsonComments(raw));
      const paths = config.compilerOptions?.paths;
      if (paths && typeof paths === "object") return paths;
    } catch {
      // Ignore missing/unreadable config files
    }
  }
  return null;
}

export type WriteResult = "written" | "skipped" | "overwritten";

export function writeFileSafe(
  filePath: string,
  content: string,
  overwrite: boolean = false,
): WriteResult {
  const exists = existsSync(filePath);

  if (exists && !overwrite) {
    return "skipped";
  }

  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const tmpPath = join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } catch (e) {
    try { rmSync(tmpPath); } catch {}
    throw e;
  }

  return exists ? "overwritten" : "written";
}
