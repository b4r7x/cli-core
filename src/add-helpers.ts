import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import pc from "picocolors";
import * as clack from "@clack/prompts";
import { writeFileSafe, cleanEmptyDirs } from "./fs.js";
import { info, warn, heading, fileAction, error, toErrorMessage, isSilentMode } from "./logger.js";
import { detectPackageManager } from "./detect.js";
import type { PackageManager } from "./detect.js";
import { installDeps } from "./package-manager.js";

export interface FileOp {
  targetPath: string;
  content: string;
  relativePath: string;
  installDir: string;
}

export function rollbackFiles(
  newFiles: string[],
  backups: Array<{ path: string; content: string }>,
  createdDirs: string[],
): void {
  let rollbackFailed = false;

  for (const backup of backups) {
    try {
      writeFileSafe(backup.path, backup.content, true);
    } catch (rollbackErr) {
      rollbackFailed = true;
      warn(`Failed to restore ${backup.path}: ${toErrorMessage(rollbackErr)}`);
    }
  }

  for (const file of newFiles) {
    try {
      rmSync(file);
    } catch (rollbackErr) {
      rollbackFailed = true;
      warn(`Failed to rollback ${file}: ${toErrorMessage(rollbackErr)}`);
    }
  }

  cleanEmptyDirs(createdDirs.reverse());

  if (rollbackFailed) {
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

export function writeFilesWithRollback(
  fileOps: FileOp[],
  overwrite: boolean,
): WriteFilesResult {
  let written = 0;
  let skipped = 0;
  let overwritten = 0;
  const newFiles: string[] = [];
  const backups: Array<{ path: string; content: string }> = [];
  const existingDirs = new Set(
    fileOps.map((op) => dirname(op.targetPath)).filter((dir) => existsSync(dir)),
  );
  const createdDirs: string[] = [];

  try {
    for (const op of fileOps) {
      const dir = dirname(op.targetPath);
      if (!existingDirs.has(dir) && !createdDirs.includes(dir)) {
        createdDirs.push(dir);
      }

      if (existsSync(op.targetPath) && overwrite) {
        backups.push({ path: op.targetPath, content: readFileSync(op.targetPath, "utf-8") });
      }

      const result = writeFileSafe(op.targetPath, op.content, overwrite);

      switch (result) {
        case "written":
          newFiles.push(op.targetPath);
          fileAction(pc.green("+"), `${op.installDir}/${op.relativePath}`);
          written++;
          break;
        case "skipped":
          fileAction(pc.dim("skip"), `${op.installDir}/${op.relativePath}`);
          skipped++;
          break;
        case "overwritten":
          fileAction(pc.yellow("~"), `${op.installDir}/${op.relativePath}`);
          overwritten++;
          break;
      }
    }
  } catch (e) {
    if (newFiles.length > 0 || backups.length > 0) {
      warn("Rolling back changes...");
      rollbackFiles(newFiles, backups, createdDirs);
    }
    throw new Error(`Failed to write files: ${toErrorMessage(e)}`);
  }

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

/**
 * Installs missing npm dependencies with a spinner, rolling back written files on failure.
 */
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

export async function installDepsWithSpinner(
  pm: PackageManager,
  deps: string[],
  cwd: string,
): Promise<boolean> {
  if (isSilentMode()) {
    try {
      await installDeps(pm, deps, cwd);
      return true;
    } catch {
      return false;
    }
  }

  const s = clack.spinner();
  s.start("Installing dependencies...");
  try {
    await installDeps(pm, deps, cwd);
    s.stop(`Installed ${deps.length} package(s)`);
    return true;
  } catch (e) {
    s.stop("Failed to install dependencies");
    if (e instanceof Error) {
      const lines = e.message.split("\n").filter(Boolean);
      const maxLines = process.env.DEBUG ? lines.length : 3;
      for (const line of lines.slice(0, maxLines)) {
        error(line);
      }
      if (!process.env.DEBUG && lines.length > maxLines) {
        error(`  ... ${lines.length - maxLines} more lines (set DEBUG=1 for full output)`);
      }
    }
    error(`Try manually: ${pm} add ${deps.join(" ")}`);
    return false;
  }
}
