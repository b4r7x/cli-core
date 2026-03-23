import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import pc from "picocolors";
import { writeFileSafe, cleanEmptyDirs, type WriteResult } from "./fs.js";
import { info, warn, heading, fileAction, toErrorMessage } from "./logger.js";
import { detectPackageManager } from "./detect.js";
import { installDepsWithSpinner } from "./package-manager.js";

export interface FileOp {
  targetPath: string;
  content: string;
  relativePath: string;
  installDir: string;
}

function tryQuietly(fn: () => void, label: string): boolean {
  try {
    fn();
    return true;
  } catch (err) {
    warn(`Failed to ${label}: ${toErrorMessage(err)}`);
    return false;
  }
}

function rollbackFiles(
  newFiles: string[],
  backups: Array<{ path: string; content: string }>,
  createdDirs: string[],
): void {
  const results = [
    ...backups.map((b) => tryQuietly(() => writeFileSafe(b.path, b.content, true), `restore ${b.path}`)),
    ...newFiles.map((f) => tryQuietly(() => rmSync(f), `rollback ${f}`)),
  ];
  cleanEmptyDirs(createdDirs.reverse());

  if (results.includes(false)) {
    warn("Some files could not be rolled back. Check the paths above and restore them manually.");
  }
}

export interface WriteFilesResult {
  written: number;
  skipped: number;
  overwritten: number;
  newFiles: string[];
  backups: Array<{ path: string; content: string }>;
  createdDirs: string[];
}

function trackNewDir(dir: string, existingDirs: Set<string>, createdDirs: string[]): void {
  if (existingDirs.has(dir) || createdDirs.includes(dir)) return;
  createdDirs.push(dir);
}

function backupIfOverwriting(targetPath: string, overwrite: boolean, backups: Array<{ path: string; content: string }>): void {
  if (!existsSync(targetPath) || !overwrite) return;
  backups.push({ path: targetPath, content: readFileSync(targetPath, "utf-8") });
}

function logWriteResult(result: WriteResult, op: FileOp, newFiles: string[]): void {
  const label = `${op.installDir}/${op.relativePath}`;
  if (result === "written") {
    newFiles.push(op.targetPath);
    fileAction(pc.green("+"), label);
  } else if (result === "skipped") {
    fileAction(pc.dim("skip"), label);
  } else if (result === "overwritten") {
    fileAction(pc.yellow("~"), label);
  }
}

function countResults(results: WriteResult[]): { written: number; skipped: number; overwritten: number } {
  let written = 0;
  let skipped = 0;
  let overwritten = 0;
  for (const r of results) {
    if (r === "written") written++;
    else if (r === "skipped") skipped++;
    else if (r === "overwritten") overwritten++;
  }
  return { written, skipped, overwritten };
}

export function writeFilesWithRollback(
  fileOps: FileOp[],
  overwrite: boolean,
): WriteFilesResult {
  const newFiles: string[] = [];
  const backups: Array<{ path: string; content: string }> = [];
  const existingDirs = new Set(
    fileOps.map((op) => dirname(op.targetPath)).filter((dir) => existsSync(dir)),
  );
  const createdDirs: string[] = [];
  const results: WriteResult[] = [];

  try {
    for (const op of fileOps) {
      trackNewDir(dirname(op.targetPath), existingDirs, createdDirs);
      backupIfOverwriting(op.targetPath, overwrite, backups);
      const result = writeFileSafe(op.targetPath, op.content, overwrite);
      logWriteResult(result, op, newFiles);
      results.push(result);
    }
  } catch (e) {
    if (newFiles.length > 0 || backups.length > 0) {
      warn("Rolling back changes...");
      rollbackFiles(newFiles, backups, createdDirs);
    }
    throw new Error(`Failed to write files: ${toErrorMessage(e)}`);
  }

  const { written, skipped, overwritten } = countResults(results);
  return { written, skipped, overwritten, newFiles, backups, createdDirs };
}

export function showDryRunPreview(fileOps: FileOp[], overwrite: boolean): void {
  heading("Files that would be written:");
  for (const op of fileOps) {
    const exists = existsSync(op.targetPath);
    if (exists && !overwrite) {
      fileAction(pc.dim("skip"), `${op.installDir}/${op.relativePath}`);
    } else {
      fileAction(pc.green(exists ? "~" : "+"), `${op.installDir}/${op.relativePath}`);
    }
  }
}

export function showDryRunDeps(missing: string[]): void {
  if (missing.length > 0) {
    heading("Packages that would be installed:");
    for (const dep of missing) info(`  ${dep}`);
  }
}

export function formatWriteSummary(result: WriteFilesResult): string {
  const parts: string[] = [];
  if (result.written > 0) parts.push(`${result.written} written`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  if (result.overwritten > 0) parts.push(`${result.overwritten} overwritten`);
  return `Done. ${parts.join(", ")}.`;
}

export async function installDepsWithRollback(
  deps: string[],
  cwd: string,
  writeResult: WriteFilesResult,
): Promise<void> {
  if (deps.length === 0) return;

  heading("Installing dependencies...");
  const pm = detectPackageManager(cwd);
  const ok = await installDepsWithSpinner(pm, deps, cwd);
  if (!ok) {
    warn("Rolling back written files due to dependency install failure...");
    rollbackFiles(writeResult.newFiles, writeResult.backups, writeResult.createdDirs);
    throw new Error("Dependency installation failed.");
  }
}
