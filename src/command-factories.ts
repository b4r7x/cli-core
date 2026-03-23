import { resolve } from "node:path";
import { Command } from "commander";
import { withErrorHandler } from "./command-helpers.js";
import { runInitWorkflow } from "./workflows/init.js";
import { runAddWorkflow } from "./workflows/add.js";
import { runListWorkflow, type ListDisplayItem } from "./workflows/list.js";
import { runDiffWorkflow, renderDiffPatch, type DiffWorkflowFile } from "./workflows/diff.js";
import { runRemoveWorkflow, type RemoveWorkflowFile } from "./workflows/remove.js";

export interface ExtraOption {
  flags: string;
  description: string;
  default?: string;
}

type ParsedOpts = Record<string, unknown>;

const resolveCwd = (opts: ParsedOpts) => resolve(String(opts.cwd));

function addExtraOptions(cmd: Command, extras: ExtraOption[] | undefined): void {
  for (const opt of extras ?? []) {
    cmd.option(opt.flags, opt.description, opt.default);
  }
}

interface RegistryLikeItem {
  name: string;
  title: string;
  description: string;
  dependencies: string[];
  files: Array<{ path: string; targetPath?: string }>;
}

export interface ListCommandConfig<TItem extends RegistryLikeItem, TConfig> {
  itemPlural: string;
  getAllItems: () => TItem[];
  getPublicItems: () => TItem[];
  requireConfig: (cwd: string) => TConfig;
  createInstallChecker: (cwd: string, config: TConfig) => (name: string) => boolean;
  getRelativePath: (file: { path: string; targetPath?: string }) => string;
  toDisplayItem?: (item: TItem) => ListDisplayItem;
}

function buildListAction<TItem extends RegistryLikeItem, TConfig>(
  config: ListCommandConfig<TItem, TConfig>,
) {
  const toDisplay = config.toDisplayItem ?? ((item: TItem): ListDisplayItem => ({
    name: item.name,
    title: item.title,
    description: item.description,
    dependencies: item.dependencies,
    files: item.files.map((file) => config.getRelativePath(file)),
  }));

  return withErrorHandler(async (opts: ParsedOpts) => {
    const cwd = resolveCwd(opts);
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
      toDisplayItem: toDisplay,
    });
  });
}

export function createListCommand<TItem extends RegistryLikeItem, TConfig>(
  config: ListCommandConfig<TItem, TConfig>,
): Command {
  return new Command("list")
    .description(`List available ${config.itemPlural}`)
    .option("--cwd <path>", "Working directory", ".")
    .option("--json", "Output as JSON")
    .option("--installed", `Show only installed ${config.itemPlural}`)
    .option("--all", "Include hidden/internal items")
    .action(buildListAction(config));
}

export interface DiffCommandConfig<TConfig> {
  itemPlural: string;
  requireConfig: (cwd: string) => TConfig;
  resolveDefaultNames: (ctx: { cwd: string; config: TConfig }) => string[];
  validateRequestedNames: (names: string[]) => void;
  resolveFilesForName: (ctx: { name: string; cwd: string; config: TConfig }) => DiffWorkflowFile[];
  noInstalledMessage: string;
  upToDateMessage: string;
}

function buildDiffAction<TConfig>(config: DiffCommandConfig<TConfig>) {
  return withErrorHandler(async (names: string[], opts: ParsedOpts) => {
    const cwd = resolveCwd(opts);

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
  });
}

export function createDiffCommand<TConfig>(
  config: DiffCommandConfig<TConfig>,
): Command {
  return new Command("diff")
    .description(`Compare local ${config.itemPlural} with registry versions`)
    .argument(`[${config.itemPlural}...]`, `${config.itemPlural} to diff`)
    .option("--cwd <path>", "Working directory", ".")
    .action(buildDiffAction(config));
}

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

function buildRemoveAction<TItem, TConfig>(
  config: RemoveCommandConfig<TItem, TConfig>,
) {
  return withErrorHandler(async (names: string[], opts: ParsedOpts) => {
    const cwd = resolveCwd(opts);

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
  });
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
    .action(buildRemoveAction(config));
}

export interface InitCommandConfig<TConfig> {
  configFileName: string;
  loadConfig: (cwd: string) => import("./config.js").ConfigLoadResult<TConfig>;
  detectProject: (cwd: string, opts: ParsedOpts) => { display: Array<[label: string, value: string]> };
  createFiles: (cwd: string, opts: ParsedOpts) => Array<{ action: "created" | "skipped"; path: string }>;
  afterFiles?: (cwd: string) => Promise<void>;
  writeConfig: (cwd: string, opts: ParsedOpts) => void | Promise<void>;
  nextSteps: string[];
  extraOptions?: ExtraOption[];
}

function buildInitAction<TConfig>(config: InitCommandConfig<TConfig>) {
  return withErrorHandler(async (opts: ParsedOpts) => {
    const cwd = resolveCwd(opts);
    await runInitWorkflow({
      cwd,
      yes: Boolean(opts.yes),
      force: Boolean(opts.force),
      configFileName: config.configFileName,
      loadConfig: config.loadConfig,
      detectProject: (cwd) => config.detectProject(cwd, opts),
      createFiles: (cwd) => config.createFiles(cwd, opts),
      afterFiles: config.afterFiles,
      writeConfig: (cwd) => config.writeConfig(cwd, opts),
      nextSteps: config.nextSteps,
    });
  });
}

export function createInitCommand<TConfig>(
  config: InitCommandConfig<TConfig>,
): Command {
  const cmd = new Command("init")
    .description("Initialize project configuration")
    .option("--cwd <path>", "Working directory", ".")
    .option("-y, --yes", "Skip confirmation prompts", false)
    .option("--force", "Overwrite existing configuration", false);

  addExtraOptions(cmd, config.extraOptions);
  cmd.action(buildInitAction(config));
  return cmd;
}

export interface AddCommandConfig<TConfig> {
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
    opts: ParsedOpts;
  }) => Promise<import("./workflows/add.js").AddWorkflowPlan> | import("./workflows/add.js").AddWorkflowPlan;
  extraOptions?: ExtraOption[];
}

function buildAddAction<TConfig>(config: AddCommandConfig<TConfig>) {
  return withErrorHandler(async (names: string[], opts: ParsedOpts) => {
    const cwd = resolveCwd(opts);
    await runAddWorkflow({
      cwd,
      requestedNames: names,
      all: Boolean(opts.all),
      yes: Boolean(opts.yes),
      dryRun: Boolean(opts.dryRun),
      overwrite: Boolean(opts.overwrite),
      skipInstall: Boolean(opts.skipInstall),
      itemLabel: config.itemLabel,
      itemPlural: config.itemPlural,
      listCommand: config.listCommand,
      emptyRequestedMessage: config.emptyRequestedMessage,
      allIgnoresSpecifiedWarning: config.allIgnoresSpecifiedWarning,
      requireConfig: config.requireConfig,
      getPublicNames: config.getPublicNames,
      validateRequestedNames: config.validateRequestedNames,
      buildPlan: (ctx) => config.buildPlan({ ...ctx, opts }),
    });
  });
}

export function createAddCommand<TConfig>(
  config: AddCommandConfig<TConfig>,
): Command {
  const cmd = new Command("add")
    .description(`Add ${config.itemPlural} to your project`)
    .argument(`[${config.itemPlural}...]`, `${config.itemLabel} names to add`)
    .option("--cwd <path>", "Working directory", ".")
    .option("--all", `Add all ${config.itemPlural}`, false)
    .option("--overwrite", "Overwrite existing files", false)
    .option("--dry-run", "Preview changes without writing files", false)
    .option("--skip-install", "Write files without installing npm dependencies", false)
    .option("-y, --yes", "Skip confirmation prompts", false);

  addExtraOptions(cmd, config.extraOptions);
  cmd.action(buildAddAction(config));
  return cmd;
}
