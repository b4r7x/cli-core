import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, relative } from "node:path";
import pc from "picocolors";
import { cleanEmptyDirs, ensureWithinAnyDir } from "./fs.js";
import {
  fileAction,
  heading,
  info,
  warn,
  promptConfirm,
  error,
  success,
  toErrorMessage,
} from "./logger.js";
import {
  formatWriteSummary,
  installDepsWithRollback,
  showDryRunDeps,
  showDryRunPreview,
  type FileOp,
  type WriteFilesResult,
  writeFilesWithRollback,
} from "./add-helpers.js";

export interface ListDisplayItem {
  name: string;
  title: string;
  description: string;
  dependencies: string[];
  files: string[];
}

export interface RunListWorkflowOptions<TItem, TConfig> {
  cwd: string;
  includeAll: boolean;
  installedOnly: boolean;
  json: boolean;
  itemPlural: string;
  getAllItems: () => TItem[];
  getPublicItems: () => TItem[];
  requireConfig: (cwd: string) => TConfig;
  isInstalled: (ctx: { cwd: string; config: TConfig; item: TItem }) => boolean;
  toDisplayItem: (item: TItem) => ListDisplayItem;
}

export function runListWorkflow<TItem, TConfig>(
  options: RunListWorkflowOptions<TItem, TConfig>,
): void {
  const {
    cwd,
    includeAll,
    installedOnly,
    json,
    itemPlural,
    getAllItems,
    getPublicItems,
    requireConfig,
    isInstalled,
    toDisplayItem,
  } = options;

  let items = includeAll ? getAllItems() : getPublicItems();
  if (installedOnly) {
    const config = requireConfig(cwd);
    items = items.filter((item) => isInstalled({ cwd, config, item }));
  }

  const displayItems = items
    .map(toDisplayItem)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (json) {
    console.log(JSON.stringify(displayItems, null, 2));
    return;
  }

  if (displayItems.length === 0) {
    console.log();
    info(installedOnly ? `No installed ${itemPlural} found.` : `No ${itemPlural} available.`);
    console.log();
    return;
  }

  const label = installedOnly ? "Installed" : "Available";
  console.log();
  info(`${label} ${itemPlural} (${displayItems.length}):`);
  console.log();

  const maxLen = Math.max(...displayItems.map((item) => item.name.length)) + 2;
  for (const item of displayItems) {
    info(`  ${item.name.padEnd(maxLen)} ${item.description}`);
  }
  console.log();
}

export interface DiffWorkflowFile {
  itemName: string;
  relativePath: string;
  localPath: string;
  registryContent: string;
}

export interface RunDiffWorkflowOptions<TConfig> {
  cwd: string;
  requestedNames: string[];
  itemPlural: string;
  requireConfig: (cwd: string) => TConfig;
  resolveDefaultNames: (ctx: { cwd: string; config: TConfig }) => string[];
  validateRequestedNames: (names: string[]) => void;
  resolveFilesForName: (ctx: {
    name: string;
    cwd: string;
    config: TConfig;
  }) => DiffWorkflowFile[];
  noInstalledMessage: string;
  upToDateMessage: string;
  renderChangedFile: (ctx: {
    file: DiffWorkflowFile;
    localContent: string;
    registryContent: string;
  }) => void;
}

export function runDiffWorkflow<TConfig>(
  options: RunDiffWorkflowOptions<TConfig>,
): void {
  const {
    cwd,
    requestedNames,
    itemPlural,
    requireConfig,
    resolveDefaultNames,
    validateRequestedNames,
    resolveFilesForName,
    noInstalledMessage,
    upToDateMessage,
    renderChangedFile,
  } = options;

  const config = requireConfig(cwd);

  let names = requestedNames;
  if (names.length === 0) {
    names = resolveDefaultNames({ cwd, config });
    if (names.length === 0) {
      info(noInstalledMessage);
      return;
    }
  } else {
    validateRequestedNames(names);
  }

  let changed = 0;
  let unchanged = 0;
  let notInstalled = 0;

  for (const name of names) {
    const files = resolveFilesForName({ name, cwd, config });

    for (const file of files) {
      if (!existsSync(file.localPath)) {
        info(`${pc.dim(`${file.itemName}/`)}${file.relativePath}: ${pc.yellow("not installed")}`);
        notInstalled++;
        continue;
      }

      const localContent = readFileSync(file.localPath, "utf-8");
      if (localContent === file.registryContent) {
        unchanged++;
        continue;
      }

      changed++;
      renderChangedFile({
        file,
        localContent,
        registryContent: file.registryContent,
      });
    }
  }

  console.log();
  if (changed === 0 && notInstalled === 0) {
    info(upToDateMessage);
    return;
  }

  const parts: string[] = [];
  if (changed > 0) parts.push(`${changed} changed`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (notInstalled > 0) parts.push(`${notInstalled} not installed`);
  info(`Summary: ${parts.join(", ")} ${itemPlural}.`);
}

export interface RemoveWorkflowFile {
  absolutePath: string;
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
  console.log();

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

  console.log();
  success(`Removed ${removed} file(s) (${names.join(", ")}).`);
  console.log();
}

export interface ApplyInstallPlanOptions {
  cwd: string;
  yes: boolean;
  dryRun: boolean;
  overwrite: boolean;
  confirmMessage: string;
  headingMessage: string;
  fileOps: FileOp[];
  missingDeps: string[];
  onDryRun?: () => void;
  onApplied?: (result: WriteFilesResult) => Promise<void> | void;
}

function dedupeFileOpsStrict(fileOps: FileOp[]): FileOp[] {
  const byTargetPath = new Map<string, FileOp>();
  for (const op of fileOps) {
    const existing = byTargetPath.get(op.targetPath);
    if (!existing) {
      byTargetPath.set(op.targetPath, op);
      continue;
    }

    if (existing.content !== op.content) {
      throw new Error(
        `Conflicting writes detected for "${op.targetPath}". Resolve overlapping integration sources before continuing.`,
      );
    }
  }
  return [...byTargetPath.values()];
}

export interface AddWorkflowPlan {
  resolvedNames: string[];
  fileOps: FileOp[];
  missingDeps: string[];
  extraDependencies?: string[];
  headingMessage: string;
  confirmMessage?: string;
  warnBeforeApply?: string[];
  onDryRun?: () => void;
  onApplied?: (ctx: {
    resolvedNames: string[];
    writeResult: WriteFilesResult;
  }) => Promise<void> | void;
}

export interface RunAddWorkflowOptions<TConfig> {
  cwd: string;
  requestedNames: string[];
  all: boolean;
  yes: boolean;
  dryRun: boolean;
  overwrite: boolean;
  itemLabel: string;
  itemPlural: string;
  listCommand: string;
  emptyRequestedMessage: string;
  allIgnoresSpecifiedWarning?: string;
  requireConfig: (cwd: string) => TConfig;
  getPublicNames: (ctx: { cwd: string; config: TConfig }) => string[];
  validateRequestedNames?: (names: string[]) => void;
  buildPlan: (ctx: {
    cwd: string;
    config: TConfig;
    names: string[];
    all: boolean;
  }) => Promise<AddWorkflowPlan> | AddWorkflowPlan;
}

export async function runAddWorkflow<TConfig>(
  options: RunAddWorkflowOptions<TConfig>,
): Promise<void> {
  const {
    cwd,
    requestedNames,
    all,
    yes,
    dryRun,
    overwrite,
    itemLabel,
    itemPlural,
    listCommand,
    emptyRequestedMessage,
    allIgnoresSpecifiedWarning,
    requireConfig,
    getPublicNames,
    validateRequestedNames,
    buildPlan,
  } = options;

  const config = requireConfig(cwd);
  const publicNames = getPublicNames({ cwd, config });
  const publicNameSet = new Set(publicNames);

  let names: string[];
  if (all) {
    if (requestedNames.length > 0 && allIgnoresSpecifiedWarning) {
      warn(allIgnoresSpecifiedWarning);
    }
    names = publicNames;
  } else {
    if (requestedNames.length === 0) {
      throw new Error(`${emptyRequestedMessage}\nRun \`${listCommand}\` to see available ${itemPlural}.`);
    }

    for (const name of requestedNames) {
      if (!publicNameSet.has(name)) {
        throw new Error(
          `${itemLabel} "${name}" not found in public registry items. Run \`${listCommand}\` to see available ${itemPlural}.`,
        );
      }
    }

    validateRequestedNames?.(requestedNames);
    names = requestedNames;
  }

  const plan = await buildPlan({ cwd, config, names, all });
  const fileOps = dedupeFileOpsStrict(plan.fileOps);

  if (plan.extraDependencies && plan.extraDependencies.length > 0) {
    info(`Also adding dependencies: ${plan.extraDependencies.join(", ")}`);
  }

  if (!dryRun && plan.warnBeforeApply) {
    for (const message of plan.warnBeforeApply) {
      warn(message);
    }
  }

  const confirmMessage = plan.confirmMessage
    ?? (
      all
        ? `Add ALL ${plan.resolvedNames.length} item(s) (${fileOps.length} files)?`
        : `Add ${plan.resolvedNames.length} item(s) (${fileOps.length} files)?`
    );

  await applyInstallPlan({
    cwd,
    yes,
    dryRun,
    overwrite,
    confirmMessage,
    headingMessage: plan.headingMessage,
    fileOps,
    missingDeps: plan.missingDeps,
    onDryRun: plan.onDryRun,
    onApplied: async (writeResult) => {
      await plan.onApplied?.({
        resolvedNames: plan.resolvedNames,
        writeResult,
      });
    },
  });
}

export async function applyInstallPlan(
  options: ApplyInstallPlanOptions,
): Promise<void> {
  const {
    cwd,
    yes,
    dryRun,
    overwrite,
    confirmMessage,
    headingMessage,
    fileOps,
    missingDeps,
    onDryRun,
    onApplied,
  } = options;

  if (!yes) {
    const proceed = await promptConfirm(confirmMessage);
    if (!proceed) {
      info("Cancelled.");
      return;
    }
  }

  if (dryRun) {
    showDryRunPreview(fileOps, overwrite);
    showDryRunDeps(missingDeps);
    onDryRun?.();
    console.log();
    info("(dry run - no changes made)");
    return;
  }

  heading(headingMessage);
  const writeResult = writeFilesWithRollback(fileOps, overwrite);
  await installDepsWithRollback(missingDeps, cwd, writeResult);
  await onApplied?.(writeResult);

  console.log();
  success(formatWriteSummary(writeResult));
  console.log();
}
