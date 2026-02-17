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
  /** Menu items shown when CLI runs without subcommand */
  menuItems?: Array<{ value: string; label: string; hint?: string }>;
}

export function createCli(options: CliOptions): Command {
  const major = parseInt(process.versions.node, 10);
  if (major < 18) {
    console.error(`${options.name} requires Node.js >= 18. Current: ${process.version}`);
    process.exit(1);
  }

  const program = new Command()
    .name(options.name)
    .description(options.description)
    .version(options.version)
    .option("-s, --silent", "Suppress all output except errors")
    .hook("preAction", (thisCommand) => {
      if (thisCommand.opts().silent) {
        setSilent(true);
      }
      if (!process.stdout.isTTY) return;
      if (
        process.argv.includes("--help") || process.argv.includes("-h") ||
        process.argv.includes("--version") || process.argv.includes("-V")
      ) {
        return;
      }
      showBanner(options.displayName);
    });

  for (const cmd of options.commands) {
    program.addCommand(cmd);
  }

  // Interactive menu when no subcommand is provided
  if (options.menuItems && options.menuItems.length > 0) {
    const menuItems = options.menuItems;
    const commandMap = new Map(options.commands.map((cmd) => [cmd.name(), cmd]));

    program.action(async () => {
      showBanner(options.displayName);

      const value = await promptSelect("What would you like to do?", menuItems);
      const cmd = commandMap.get(value);
      if (cmd) {
        const argv0 = process.argv[0] ?? "node";
        const argv1 = process.argv[1] ?? "";
        await program.parseAsync([argv0, argv1, value]);
      }
    });
  }

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
