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
  const {
    cwd,
    yes,
    dryRun,
    overwrite,
    skipInstall = false,
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
    newline();
    info("(dry run - no changes made)");
    return;
  }

  heading(headingMessage);
  const writeResult = writeFilesWithRollback(fileOps, overwrite);
  const skipInstallFromEnv = isTruthyFlag(process.env.CLI_SKIP_INSTALL);
  const shouldSkipInstall = skipInstall || skipInstallFromEnv;
  if (shouldSkipInstall) {
    if (missingDeps.length > 0) {
      heading("Dependency installation skipped");
      info(
        skipInstall
          ? "Skipped via --skip-install. Install these packages manually when ready:"
          : "Skipped via CLI_SKIP_INSTALL. Install these packages manually when ready:",
      );
      for (const dep of missingDeps) {
        info(`  ${dep}`);
      }
    }
  } else {
    await installDepsWithRollback(missingDeps, cwd, writeResult);
  }
  await onApplied?.(writeResult);

  newline();
  success(formatWriteSummary(writeResult));
  newline();
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}
