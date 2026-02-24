import { existsSync, rmSync } from "node:fs";
import { dirname, relative } from "node:path";
import pc from "picocolors";
import { cleanEmptyDirs, ensureWithinAnyDir } from "../fs.js";
import {
  error,
  fileAction,
  heading,
  info,
  newline,
  promptConfirm,
  success,
  toErrorMessage,
} from "../logger.js";

export interface RemoveWorkflowFile {
  absolutePath: string;
}

/**
 * Finds npm dependencies that are no longer needed after removing registry items.
 * Generic helper — pass item accessors for the specific registry type.
 */
export function findOrphanedNpmDeps<TItem>(opts: {
  removedNames: string[];
  getAllItems: () => TItem[];
  getItemName: (item: TItem) => string;
  getItemDeps: (item: TItem) => string[];
  isInstalled: (item: TItem) => boolean;
}): string[] {
  const removedDeps = new Set(
    opts.removedNames.flatMap((n) => {
      const item = opts.getAllItems().find((i) => opts.getItemName(i) === n);
      return item ? opts.getItemDeps(item) : [];
    }),
  );
  if (removedDeps.size === 0) return [];

  const removedSet = new Set(opts.removedNames);
  const remainingDeps = new Set(
    opts.getAllItems()
      .filter((i) => !removedSet.has(opts.getItemName(i)) && opts.isInstalled(i))
      .flatMap((i) => opts.getItemDeps(i)),
  );
  return [...removedDeps].filter((d) => !remainingDeps.has(d));
}

export interface RunRemoveWorkflowOptions<TItem, TConfig> {
  cwd: string;
  names: string[];
  yes: boolean;
  dryRun: boolean;
  itemPlural: string;
  requireConfig: (cwd: string) => TConfig;
  validateNames: (names: string[]) => void;
  getAllItems: () => TItem[];
  getItemOrThrow: (name: string) => TItem;
  getItemName: (item: TItem) => string;
  isInstalled: (ctx: { cwd: string; config: TConfig; item: TItem }) => boolean;
  resolveFilesForItem: (ctx: { cwd: string; config: TConfig; item: TItem }) => RemoveWorkflowFile[];
  resolveAllowedBaseDirs: (ctx: { cwd: string; config: TConfig }) => string[];
  updateManifest: (ctx: { cwd: string; removedNames: string[] }) => void;
  findOrphanedDeps?: (ctx: {
    removedNames: string[];
    cwd: string;
    config: TConfig;
  }) => string[];
}

export async function runRemoveWorkflow<TItem, TConfig>(
  options: RunRemoveWorkflowOptions<TItem, TConfig>,
): Promise<void> {
  const {
    cwd,
    names,
    yes,
    dryRun,
    itemPlural,
    requireConfig,
    validateNames,
    getAllItems,
    getItemOrThrow,
    getItemName,
    isInstalled,
    resolveFilesForItem,
    resolveAllowedBaseDirs,
    updateManifest,
    findOrphanedDeps,
  } = options;

  const config = requireConfig(cwd);
  validateNames(names);

  const removedSet = new Set(names);
  const retainedFiles = new Set<string>();
  for (const item of getAllItems()) {
    if (removedSet.has(getItemName(item))) continue;
    if (!isInstalled({ cwd, config, item })) continue;
    for (const file of resolveFilesForItem({ cwd, config, item })) {
      retainedFiles.add(file.absolutePath);
    }
  }

  const filesToRemove = new Set<string>();
  const dirsToCheck = new Set<string>();
  for (const name of names) {
    const item = getItemOrThrow(name);
    for (const file of resolveFilesForItem({ cwd, config, item })) {
      if (!existsSync(file.absolutePath) || retainedFiles.has(file.absolutePath)) continue;
      filesToRemove.add(file.absolutePath);
      dirsToCheck.add(dirname(file.absolutePath));
    }
  }

  if (filesToRemove.size === 0) {
    info(`No installed files found for the specified ${itemPlural}.`);
    return;
  }

  heading("Files to remove:");
  for (const file of filesToRemove) {
    fileAction(pc.red("-"), relative(cwd, file));
  }
  newline();

  if (dryRun) {
    info("(dry run - no changes made)");
    return;
  }

  if (!yes) {
    const proceed = await promptConfirm(`Remove ${filesToRemove.size} file(s)?`, false);
    if (!proceed) {
      info("Cancelled.");
      return;
    }
  }

  const allowedBaseDirs = resolveAllowedBaseDirs({ cwd, config });
  for (const file of filesToRemove) {
    ensureWithinAnyDir(file, allowedBaseDirs);
  }

  let removed = 0;
  for (const file of filesToRemove) {
    try {
      rmSync(file);
      removed++;
    } catch (e) {
      error(`Failed to remove ${relative(cwd, file)}: ${toErrorMessage(e)}`);
    }
  }

  cleanEmptyDirs([...dirsToCheck]);
  updateManifest({ cwd, removedNames: names });

  const orphaned = findOrphanedDeps?.({ removedNames: names, cwd, config }) ?? [];
  if (orphaned.length > 0) {
    info(`Note: You may want to remove unused packages: ${orphaned.join(", ")}`);
  }

  newline();
  success(`Removed ${removed} file(s) (${names.join(", ")}).`);
  newline();
}
