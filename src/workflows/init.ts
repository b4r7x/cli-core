import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { info, success, warn, heading, fileAction, newline, promptConfirm } from "../logger.js";
import type { ConfigLoadResult } from "../config.js";
import pc from "picocolors";

export interface InitWorkflowOptions<TConfig> {
  /** Working directory */
  cwd: string;

  /** Config file name (e.g., "mylib.json") */
  configFileName: string;

  /** Skip confirmation prompts */
  yes: boolean;

  /** Overwrite existing configuration */
  force: boolean;

  /** Load existing config to check if already initialized */
  loadConfig: (cwd: string) => ConfigLoadResult<TConfig>;

  /** Detect project environment and return display lines */
  detectProject: (cwd: string) => { display: Array<[label: string, value: string]> };

  /** Create directories and additional files. Return created paths for display */
  createFiles: (cwd: string) => Array<{ action: "created" | "skipped"; path: string }>;

  /** Optional async step after file creation (e.g., installing deps) */
  afterFiles?: (cwd: string) => Promise<void>;

  /** Write the config file */
  writeConfig: (cwd: string) => void | Promise<void>;

  /** Message shown after success (e.g., "Add items with: npx mylib add <item>") */
  nextSteps: string[];
}

/**
 * Generic init workflow for registry-based CLIs.
 * Handles: package.json check, existing config detection, env display, confirmation, file creation, config writing.
 */
export async function runInitWorkflow<TConfig>(options: InitWorkflowOptions<TConfig>): Promise<void> {
  const { cwd, configFileName, yes, force, loadConfig, detectProject, createFiles, afterFiles, writeConfig, nextSteps } = options;

  if (!existsSync(resolve(cwd, "package.json"))) {
    throw new Error("No package.json found. Run `npm init` first.");
  }

  const existing = loadConfig(cwd);
  if (existing.ok && !force) {
    warn(`${configFileName.replace(/\.json$/, "")} is already initialized in this project.`);
    info(`Config: ${resolve(cwd, configFileName)}`);
    info("Use --force to re-initialize.");
    return;
  }

  if (
    !existing.ok
    && (existing.error === "parse_error" || existing.error === "validation_error")
    && !force
  ) {
    throw new Error(
      `${configFileName} is malformed: ${existing.message}\n`
      + `Fix the syntax error, delete ${configFileName}, or use --force to re-initialize.`,
    );
  }

  const project = detectProject(cwd);

  heading("Detected:");
  for (const [label, value] of project.display) {
    info(`${label}: ${value}`);
  }
  newline();

  if (!yes) {
    const proceed = await promptConfirm("Continue with initialization?");
    if (!proceed) {
      info("Cancelled.");
      return;
    }
  }

  heading("Creating files...");
  const fileResults = createFiles(cwd);
  for (const result of fileResults) {
    fileAction(
      result.action === "created" ? pc.green("+") : pc.dim("skip"),
      result.path,
    );
  }

  if (afterFiles) {
    await afterFiles(cwd);
  }

  await writeConfig(cwd);
  fileAction(pc.green("+"), configFileName);

  newline();
  success("Done!");
  for (const step of nextSteps) {
    info(step);
  }
  newline();
}
