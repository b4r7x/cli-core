import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, renameSync, cpSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";

function stripJsonComments(json: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  const len = json.length;
  while (i < len) {
    const ch = json[i];

    if (inString) {
      [result, i, inString] = consumeStringChar(json, result, i, len);
      continue;
    }

    if (ch === '"') { inString = true; result += ch; i++; continue; }
    if (ch === "/" && json[i + 1] === "/") { i = skipLineComment(json, i, len); continue; }
    if (ch === "/" && json[i + 1] === "*") { i = skipBlockComment(json, i, len); continue; }

    result += ch;
    i++;
  }
  return result;
}

function consumeStringChar(json: string, result: string, i: number, len: number): [string, number, boolean] {
  const ch = json[i];
  if (ch === "\\" && i + 1 < len) return [result + ch + json[i + 1], i + 2, true];
  return [result + ch, i + 1, ch !== '"'];
}

function skipLineComment(json: string, i: number, len: number): number {
  while (i < len && json[i] !== "\n") i++;
  return i;
}

function skipBlockComment(json: string, i: number, len: number): number {
  i += 2;
  while (i + 1 < len && !(json[i] === "*" && json[i + 1] === "/")) i++;
  return i + 2;
}

export function isEnoent(e: unknown): boolean {
  if (!(e instanceof Error) || !("code" in e)) return false;
  const err: Error & { code: unknown } = e;
  return err.code === "ENOENT";
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
    tryRemoveIfEmpty(dir);
  }
}

function tryRemoveIfEmpty(dir: string): void {
  try {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true });
  } catch { /* Best-effort cleanup of empty dirs */ }
}

export function readTsConfigPaths(cwd: string): Record<string, string[]> | null {
  for (const configFile of ["tsconfig.json", "jsconfig.json"]) {
    const paths = tryReadPaths(resolve(cwd, configFile));
    if (paths) return paths;
  }
  return null;
}

function tryReadPaths(configPath: string): Record<string, string[]> | null {
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(stripJsonComments(raw));
    const paths = config.compilerOptions?.paths;
    if (paths && typeof paths === "object") return paths;
  } catch { /* Optional tsconfig reading; missing file is OK */ }
  return null;
}

export function atomicWriteFile(targetPath: string, content: string, opts?: { ensureDir?: boolean }): void {
  if (opts?.ensureDir !== false) {
    mkdirSync(dirname(targetPath), { recursive: true });
  }
  const tmpPath = join(dirname(targetPath), `.tmp-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, targetPath);
  } catch (e) {
    try { rmSync(tmpPath); } catch { /* Best-effort temp file cleanup; original error is re-thrown */ }
    throw e;
  }
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

  atomicWriteFile(filePath, content);

  return exists ? "overwritten" : "written";
}

export function copyGeneratedDir(
  pkgRoot: string,
  srcRelative: string,
  distRelative: string,
): void {
  const src = resolve(pkgRoot, srcRelative);
  if (!existsSync(src)) {
    throw new Error(`${srcRelative}/ not found. Run prebuild first.`);
  }
  cpSync(src, resolve(pkgRoot, distRelative), { recursive: true, force: true });
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
