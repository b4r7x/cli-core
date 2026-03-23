import { Command } from "commander";
import pc from "picocolors";
import * as clack from "@clack/prompts";
import { showBanner, setSilent, toErrorMessage, CancelError, promptSelect } from "./logger.js";

export interface CliOptions {
  name: string;
  displayName: string;
  description: string;
  version: string;
  commands: Command[];
  menuItems?: Array<{ value: string; label: string; hint?: string }>;
}

function enforceNodeVersion(name: string): void {
  const major = parseInt(process.versions.node, 10);
  if (major < 18) {
    console.error(`${name} requires Node.js >= 18. Current: ${process.version}`);
    process.exit(1);
  }
}

function isHelpOrVersion(): boolean {
  return (
    process.argv.includes("--help") || process.argv.includes("-h") ||
    process.argv.includes("--version") || process.argv.includes("-V")
  );
}

function createPreActionHook(displayName: string) {
  return (thisCommand: Command) => {
    if (thisCommand.opts().silent) setSilent(true);
    if (!process.stdout.isTTY || isHelpOrVersion()) return;
    showBanner(displayName);
  };
}

function attachInteractiveMenu(program: Command, options: CliOptions): void {
  const menuItems = options.menuItems;
  if (!menuItems?.length) return;

  const commandMap = new Map(options.commands.map((cmd) => [cmd.name(), cmd]));
  program.action(async () => {
    showBanner(options.displayName);
    const value = await promptSelect("What would you like to do?", menuItems);
    if (commandMap.has(value)) {
      await program.parseAsync([process.argv[0], process.argv[1], value]);
    }
  });
}

export function createCli(options: CliOptions): Command {
  enforceNodeVersion(options.name);

  const program = new Command()
    .name(options.name)
    .description(options.description)
    .version(options.version)
    .option("-s, --silent", "Suppress all output except errors")
    .hook("preAction", createPreActionHook(options.displayName));

  for (const cmd of options.commands) program.addCommand(cmd);
  attachInteractiveMenu(program, options);

  return program;
}

export function runCli(program: Command): void {
  program.parseAsync().catch((err) => {
    if (err instanceof CancelError) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    console.error();
    console.error(`  ${pc.red("Error:")} ${toErrorMessage(err)}`);
    if (process.env.DEBUG) {
      console.error(err);
    }
    process.exit(1);
  });
}
