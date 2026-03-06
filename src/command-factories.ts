import { resolve } from "node:path";
import { Command } from "commander";
import { withErrorHandler } from "./command-helpers.js";
import { runListWorkflow, type ListDisplayItem } from "./workflows/list.js";
import { runDiffWorkflow, renderDiffPatch, type DiffWorkflowFile } from "./workflows/diff.js";
import { runRemoveWorkflow, type RemoveWorkflowFile } from "./workflows/remove.js";

// ─── List ───────────────────────────────────────────────────────────────────

export interface ListCommandConfig<TItem extends { name: string }, TConfig> {
  itemPlural: string;
  getAllItems: () => TItem[];
  getPublicItems: () => TItem[];
  requireConfig: (cwd: string) => TConfig;
  createInstallChecker: (cwd: string, config: TConfig) => (name: string) => boolean;
  toDisplayItem: (item: TItem) => ListDisplayItem;
}

export function createListCommand<TItem extends { name: string }, TConfig>(
  config: ListCommandConfig<TItem, TConfig>,
): Command {
  return new Command("list")
    .description(`List available ${config.itemPlural}`)
    .option("--cwd <path>", "Working directory", ".")
    .option("--json", "Output as JSON")
    .option("--installed", `Show only installed ${config.itemPlural}`)
    .option("--all", "Include hidden/internal items")
    .action(withErrorHandler(async (opts) => {
      const cwd = resolve(opts.cwd);
      let checker: ((name: string) => boolean) | undefined;

      runListWorkflow({
        cwd,
        includeAll: Boolean(opts.all),
        installedOnly: Boolean(opts.installed),
        json: Boolean(opts.json),
        itemPlural: config.itemPlural,
        getAllItems: config.getAllItems,
        getPublicItems: config.getPublicItems,
        requireConfig: config.requireConfig,
        isInstalled: ({ cwd, config: cfg, item }) => {
          checker ??= config.createInstallChecker(cwd, cfg);
          return checker(item.name);
        },
        toDisplayItem: config.toDisplayItem,
      });
    }));
}

// ─── Diff ───────────────────────────────────────────────────────────────────

export interface DiffCommandConfig<TConfig> {
  itemPlural: string;
  requireConfig: (cwd: string) => TConfig;
  resolveDefaultNames: (ctx: { cwd: string; config: TConfig }) => string[];
  validateRequestedNames: (names: string[]) => void;
  resolveFilesForName: (ctx: { name: string; cwd: string; config: TConfig }) => DiffWorkflowFile[];
  noInstalledMessage: string;
  upToDateMessage: string;
}

export function createDiffCommand<TConfig>(
  config: DiffCommandConfig<TConfig>,
): Command {
  return new Command("diff")
    .description(`Compare local ${config.itemPlural} with registry versions`)
    .argument(`[${config.itemPlural}...]`, `${config.itemPlural} to diff`)
    .option("--cwd <path>", "Working directory", ".")
    .action(withErrorHandler(async (names: string[], opts) => {
      const cwd = resolve(opts.cwd);

      runDiffWorkflow({
        cwd,
        requestedNames: names,
        itemPlural: config.itemPlural,
        requireConfig: config.requireConfig,
        resolveDefaultNames: config.resolveDefaultNames,
        validateRequestedNames: config.validateRequestedNames,
        resolveFilesForName: config.resolveFilesForName,
        noInstalledMessage: config.noInstalledMessage,
        upToDateMessage: config.upToDateMessage,
        renderChangedFile: renderDiffPatch,
      });
    }));
}

// ─── Remove ─────────────────────────────────────────────────────────────────

export interface RemoveCommandConfig<TItem, TConfig> {
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
  findOrphanedDeps?: (ctx: { removedNames: string[]; cwd: string; config: TConfig }) => string[];
}

export function createRemoveCommand<TItem, TConfig>(
  config: RemoveCommandConfig<TItem, TConfig>,
): Command {
  return new Command("remove")
    .description(`Remove ${config.itemPlural} from your project`)
    .argument(`<${config.itemPlural}...>`, `${config.itemPlural} to remove`)
    .option("--cwd <path>", "Working directory", ".")
    .option("-y, --yes", "Skip confirmation prompts", false)
    .option("--dry-run", "Preview changes without removing files", false)
    .action(withErrorHandler(async (names: string[], opts) => {
      const cwd = resolve(opts.cwd);

      await runRemoveWorkflow({
        cwd,
        names,
        yes: Boolean(opts.yes),
        dryRun: Boolean(opts.dryRun),
        itemPlural: config.itemPlural,
        requireConfig: config.requireConfig,
        validateNames: config.validateNames,
        getAllItems: config.getAllItems,
        getItemOrThrow: config.getItemOrThrow,
        getItemName: config.getItemName,
        isInstalled: config.isInstalled,
        resolveFilesForItem: config.resolveFilesForItem,
        resolveAllowedBaseDirs: config.resolveAllowedBaseDirs,
        updateManifest: config.updateManifest,
        findOrphanedDeps: config.findOrphanedDeps,
      });
    }));
}
