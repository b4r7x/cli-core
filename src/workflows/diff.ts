import { existsSync, readFileSync } from "node:fs";
import pc from "picocolors";
import { createTwoFilesPatch } from "diff";
import { heading, info, isSilentMode, newline } from "../logger.js";

export interface DiffWorkflowFile {
  itemName: string;
  relativePath: string;
  localPath: string;
  registryContent: string;
}

export function renderDiffPatch(ctx: {
  file: DiffWorkflowFile;
  localContent: string;
  registryContent: string;
}): void {
  if (isSilentMode()) return;
  const { file, localContent, registryContent } = ctx;
  heading(`${file.itemName}/${file.relativePath}`);
  const patch = createTwoFilesPatch(
    `upstream/${file.relativePath}`,
    `local/${file.relativePath}`,
    registryContent,
    localContent,
    "upstream",
    "local",
  );

  const diffColors: Record<string, (value: string) => string> = {
    "+": pc.green,
    "-": pc.red,
    "@": pc.cyan,
  };
  for (const line of patch.split("\n")) {
    const prefix = line[0];
    const color = prefix && diffColors[prefix];
    const isHeader = line.startsWith("+++") || line.startsWith("---");
    console.log(color && !isHeader ? color(line) : line);
  }
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

interface DiffCounts {
  changed: number;
  unchanged: number;
  notInstalled: number;
}

function resolveNames<TConfig>(
  options: RunDiffWorkflowOptions<TConfig>,
  config: TConfig,
): string[] | null {
  if (options.requestedNames.length > 0) {
    options.validateRequestedNames(options.requestedNames);
    return options.requestedNames;
  }

  const names = options.resolveDefaultNames({ cwd: options.cwd, config });
  if (names.length === 0) {
    info(options.noInstalledMessage);
    return null;
  }
  return names;
}

function diffFile(
  file: DiffWorkflowFile,
  renderChangedFile: RunDiffWorkflowOptions<unknown>["renderChangedFile"],
): "not-installed" | "unchanged" | "changed" {
  if (!existsSync(file.localPath)) {
    info(`${pc.dim(`${file.itemName}/`)}${file.relativePath}: ${pc.yellow("not installed")}`);
    return "not-installed";
  }

  const localContent = readFileSync(file.localPath, "utf-8");
  if (localContent === file.registryContent) return "unchanged";

  renderChangedFile({ file, localContent, registryContent: file.registryContent });
  return "changed";
}

function printSummary(counts: DiffCounts, options: Pick<RunDiffWorkflowOptions<unknown>, "itemPlural" | "upToDateMessage">): void {
  newline();
  if (counts.changed === 0 && counts.notInstalled === 0) {
    info(options.upToDateMessage);
    return;
  }

  const parts: string[] = [];
  if (counts.changed > 0) parts.push(`${counts.changed} changed`);
  if (counts.unchanged > 0) parts.push(`${counts.unchanged} unchanged`);
  if (counts.notInstalled > 0) parts.push(`${counts.notInstalled} not installed`);
  info(`Summary: ${parts.join(", ")} ${options.itemPlural}.`);
}

export function runDiffWorkflow<TConfig>(
  options: RunDiffWorkflowOptions<TConfig>,
): void {
  const config = options.requireConfig(options.cwd);

  const names = resolveNames(options, config);
  if (!names) return;

  const counts: DiffCounts = { changed: 0, unchanged: 0, notInstalled: 0 };

  for (const name of names) {
    const files = options.resolveFilesForName({ name, cwd: options.cwd, config });
    for (const file of files) {
      const result = diffFile(file, options.renderChangedFile);
      counts[result === "not-installed" ? "notInstalled" : result]++;
    }
  }

  printSummary(counts, options);
}
