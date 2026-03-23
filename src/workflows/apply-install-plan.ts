import {
  formatWriteSummary,
  installDepsWithRollback,
  showDryRunDeps,
  showDryRunPreview,
  type FileOp,
  type WriteFilesResult,
  writeFilesWithRollback,
} from "../add-helpers.js";
import { heading, info, newline, promptConfirm, success } from "../logger.js";

export interface ApplyInstallPlanOptions {
  cwd: string;
  yes: boolean;
  dryRun: boolean;
  overwrite: boolean;
  skipInstall?: boolean;
  confirmMessage: string;
  headingMessage: string;
  fileOps: FileOp[];
  missingDeps: string[];
  onDryRun?: () => void;
  onApplied?: (result: WriteFilesResult) => Promise<void> | void;
}

export async function applyInstallPlan(
  options: ApplyInstallPlanOptions,
): Promise<void> {
  if (options.dryRun) {
    handleDryRun(options);
    return;
  }

  if (!options.yes) {
    const proceed = await promptConfirm(options.confirmMessage);
    if (!proceed) return info("Cancelled.");
  }

  await writeAndInstall(options);
}

function handleDryRun(options: ApplyInstallPlanOptions): void {
  showDryRunPreview(options.fileOps, options.overwrite);
  showDryRunDeps(options.missingDeps);
  options.onDryRun?.();
  newline();
  info("(dry run - no changes made)");
}

async function writeAndInstall(options: ApplyInstallPlanOptions): Promise<void> {
  const { cwd, overwrite, skipInstall = false, fileOps, missingDeps } = options;

  heading(options.headingMessage);
  const writeResult = writeFilesWithRollback(fileOps, overwrite);
  await installOrSkip(missingDeps, cwd, writeResult, skipInstall);
  await options.onApplied?.(writeResult);

  newline();
  success(formatWriteSummary(writeResult));
  newline();
}

async function installOrSkip(
  missingDeps: string[],
  cwd: string,
  writeResult: WriteFilesResult,
  skipInstall: boolean,
): Promise<void> {
  const skip = skipInstall || isTruthyFlag(process.env.CLI_SKIP_INSTALL);
  if (!skip) {
    await installDepsWithRollback(missingDeps, cwd, writeResult);
    return;
  }
  if (missingDeps.length > 0) showSkippedDeps(missingDeps, skipInstall);
}

function showSkippedDeps(missingDeps: string[], fromFlag: boolean): void {
  heading("Dependency installation skipped");
  const reason = fromFlag ? "--skip-install" : "CLI_SKIP_INSTALL";
  info(`Skipped via ${reason}. Install these packages manually when ready:`);
  for (const dep of missingDeps) info(`  ${dep}`);
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}
