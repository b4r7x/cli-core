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

export function findOrphanedNpmDeps<TItem>(opts: {
  removedNames: string[];
  getAllItems: () => TItem[];
  getItemName: (item: TItem) => string;
  getItemDeps: (item: TItem) => string[];
  isInstalled: (item: TItem) => boolean;
}): string[] {
  const allItems = opts.getAllItems();
  const removedSet = new Set(opts.removedNames);
  const removedDeps = new Set(
    opts.removedNames.flatMap((n) => {
      const item = allItems.find((i) => opts.getItemName(i) === n);
      return item ? opts.getItemDeps(item) : [];
    }),
  );
  if (removedDeps.size === 0) return [];

  const remainingDeps = new Set(
    allItems
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

interface ResolveCtx<TItem, TConfig> {
  cwd: string;
  config: TConfig;
  resolveFilesForItem: (ctx: { cwd: string; config: TConfig; item: TItem }) => RemoveWorkflowFile[];
}

function collectRetainedFiles<TItem, TConfig>(
  ctx: ResolveCtx<TItem, TConfig>,
  items: TItem[],
): Set<string> {
  const retained = new Set<string>();
  for (const item of items) {
    for (const file of ctx.resolveFilesForItem({ cwd: ctx.cwd, config: ctx.config, item })) {
      retained.add(file.absolutePath);
    }
  }
  return retained;
}

function collectFilesToRemove<TItem, TConfig>(
  ctx: ResolveCtx<TItem, TConfig> & { getItemOrThrow: (name: string) => TItem },
  names: string[],
  retainedFiles: Set<string>,
): { files: Set<string>; dirs: Set<string> } {
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const name of names) {
    const item = ctx.getItemOrThrow(name);
    for (const file of ctx.resolveFilesForItem({ cwd: ctx.cwd, config: ctx.config, item })) {
      if (!existsSync(file.absolutePath) || retainedFiles.has(file.absolutePath)) continue;
      files.add(file.absolutePath);
      dirs.add(dirname(file.absolutePath));
    }
  }
  return { files, dirs };
}

function showRemovePreview(cwd: string, files: Set<string>): void {
  heading("Files to remove:");
  for (const file of files) {
    fileAction(pc.red("-"), relative(cwd, file));
  }
  newline();
}

function deleteFiles(cwd: string, files: Set<string>, allowedBaseDirs: string[]): number {
  for (const file of files) {
    ensureWithinAnyDir(file, allowedBaseDirs);
  }

  let removed = 0;
  for (const file of files) {
    try {
      rmSync(file);
      removed++;
    } catch (e) {
      error(`Failed to remove ${relative(cwd, file)}: ${toErrorMessage(e)}`);
    }
  }
  return removed;
}

async function confirmRemoval(files: Set<string>, yes: boolean, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    info("(dry run - no changes made)");
    return false;
  }
  if (yes) return true;

  const proceed = await promptConfirm(`Remove ${files.size} file(s)?`, false);
  if (!proceed) {
    info("Cancelled.");
    return false;
  }
  return true;
}

function finalizeRemoval<TConfig>(opts: {
  cwd: string;
  names: string[];
  removed: number;
  dirs: Set<string>;
  config: TConfig;
  updateManifest: (ctx: { cwd: string; removedNames: string[] }) => void;
  findOrphanedDeps?: (ctx: { removedNames: string[]; cwd: string; config: TConfig }) => string[];
}): void {
  cleanEmptyDirs([...opts.dirs]);
  opts.updateManifest({ cwd: opts.cwd, removedNames: opts.names });

  const orphaned = opts.findOrphanedDeps?.({ removedNames: opts.names, cwd: opts.cwd, config: opts.config }) ?? [];
  if (orphaned.length > 0) {
    info(`Note: You may want to remove unused packages: ${orphaned.join(", ")}`);
  }

  newline();
  success(`Removed ${opts.removed} file(s) (${opts.names.join(", ")}).`);
  newline();
}

function collectRemovalTargets<TItem, TConfig>(
  options: RunRemoveWorkflowOptions<TItem, TConfig>,
  config: TConfig,
): { files: Set<string>; dirs: Set<string> } {
  const { cwd, names } = options;
  const removedSet = new Set(names);
  const ctx = { cwd, config, resolveFilesForItem: options.resolveFilesForItem };
  const retainedItems = options.getAllItems().filter(
    (i) => !removedSet.has(options.getItemName(i)) && options.isInstalled({ cwd, config, item: i }),
  );
  const retainedFiles = collectRetainedFiles(ctx, retainedItems);
  return collectFilesToRemove({ ...ctx, getItemOrThrow: options.getItemOrThrow }, names, retainedFiles);
}

async function executeRemoval<TItem, TConfig>(
  options: RunRemoveWorkflowOptions<TItem, TConfig>,
  config: TConfig,
  files: Set<string>,
  dirs: Set<string>,
): Promise<void> {
  const { cwd, names, yes, dryRun } = options;
  showRemovePreview(cwd, files);
  const shouldProceed = await confirmRemoval(files, yes, dryRun);
  if (!shouldProceed) return;

  const allowedBaseDirs = options.resolveAllowedBaseDirs({ cwd, config });
  const removed = deleteFiles(cwd, files, allowedBaseDirs);
  finalizeRemoval({
    cwd, names, removed, dirs, config,
    updateManifest: options.updateManifest,
    findOrphanedDeps: options.findOrphanedDeps,
  });
}

export async function runRemoveWorkflow<TItem, TConfig>(
  options: RunRemoveWorkflowOptions<TItem, TConfig>,
): Promise<void> {
  const config = options.requireConfig(options.cwd);
  options.validateNames(options.names);

  const { files, dirs } = collectRemovalTargets(options, config);
  if (files.size === 0) {
    info(`No installed files found for the specified ${options.itemPlural}.`);
    return;
  }

  await executeRemoval(options, config, files, dirs);
}
