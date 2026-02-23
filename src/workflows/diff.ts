import { existsSync, readFileSync } from "node:fs";
import pc from "picocolors";
import { createTwoFilesPatch } from "diff";
import { heading, info } from "../logger.js";

export interface DiffWorkflowFile {
  itemName: string;
  relativePath: string;
  localPath: string;
  registryContent: string;
}

/**
 * Renders a colorized unified diff patch to stdout.
 */
export function renderDiffPatch(ctx: {
  file: DiffWorkflowFile;
  localContent: string;
  registryContent: string;
}): void {
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
