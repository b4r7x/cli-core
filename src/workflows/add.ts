import { type FileOp, type WriteFilesResult } from "../add-helpers.js";
import { info, warn } from "../logger.js";
import { applyInstallPlan } from "./apply-install-plan.js";

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
  skipInstall?: boolean;
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
    skipInstall = false,
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
    skipInstall,
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
