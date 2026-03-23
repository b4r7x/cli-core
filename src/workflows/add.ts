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

function resolveNames<TConfig>(options: RunAddWorkflowOptions<TConfig>, publicNames: string[]): string[] {
  if (options.all) {
    if (options.requestedNames.length > 0 && options.allIgnoresSpecifiedWarning) {
      warn(options.allIgnoresSpecifiedWarning);
    }
    return publicNames;
  }

  if (options.requestedNames.length === 0) {
    throw new Error(`${options.emptyRequestedMessage}\nRun \`${options.listCommand}\` to see available ${options.itemPlural}.`);
  }

  validateAgainstRegistry(options.requestedNames, new Set(publicNames), options);
  options.validateRequestedNames?.(options.requestedNames);
  return options.requestedNames;
}

function validateAgainstRegistry(
  names: string[],
  publicNameSet: Set<string>,
  ctx: Pick<RunAddWorkflowOptions<unknown>, "itemLabel" | "itemPlural" | "listCommand">,
): void {
  for (const name of names) {
    if (publicNameSet.has(name)) continue;
    throw new Error(
      `${ctx.itemLabel} "${name}" not found in public registry items. Run \`${ctx.listCommand}\` to see available ${ctx.itemPlural}.`,
    );
  }
}

function emitPlanWarnings(plan: AddWorkflowPlan, dryRun: boolean): void {
  if (plan.extraDependencies?.length) {
    info(`Also adding dependencies: ${plan.extraDependencies.join(", ")}`);
  }

  if (dryRun || !plan.warnBeforeApply) return;
  for (const message of plan.warnBeforeApply) {
    warn(message);
  }
}

function buildConfirmMessage(
  plan: AddWorkflowPlan,
  fileOps: FileOp[],
  all: boolean,
): string {
  if (plan.confirmMessage) return plan.confirmMessage;

  const count = plan.resolvedNames.length;
  const prefix = all ? `Add ALL ${count}` : `Add ${count}`;
  return `${prefix} item(s) (${fileOps.length} files)?`;
}

async function buildAndValidatePlan<TConfig>(
  options: RunAddWorkflowOptions<TConfig>,
  config: TConfig,
  names: string[],
): Promise<{ plan: AddWorkflowPlan; fileOps: FileOp[] }> {
  const plan = await options.buildPlan({ cwd: options.cwd, config, names, all: options.all });
  const fileOps = dedupeFileOpsStrict(plan.fileOps);
  emitPlanWarnings(plan, options.dryRun);
  return { plan, fileOps };
}

function applyPlan<TConfig>(
  options: RunAddWorkflowOptions<TConfig>,
  plan: AddWorkflowPlan,
  fileOps: FileOp[],
): Promise<void> {
  return applyInstallPlan({
    cwd: options.cwd,
    yes: options.yes,
    dryRun: options.dryRun,
    overwrite: options.overwrite,
    skipInstall: options.skipInstall ?? false,
    confirmMessage: buildConfirmMessage(plan, fileOps, options.all),
    headingMessage: plan.headingMessage,
    fileOps,
    missingDeps: plan.missingDeps,
    onDryRun: plan.onDryRun,
    onApplied: async (writeResult) => {
      await plan.onApplied?.({ resolvedNames: plan.resolvedNames, writeResult });
    },
  });
}

export async function runAddWorkflow<TConfig>(
  options: RunAddWorkflowOptions<TConfig>,
): Promise<void> {
  const config = options.requireConfig(options.cwd);
  const publicNames = options.getPublicNames({ cwd: options.cwd, config });
  const names = resolveNames(options, publicNames);
  const { plan, fileOps } = await buildAndValidatePlan(options, config, names);
  await applyPlan(options, plan, fileOps);
}
