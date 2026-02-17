import figlet from "figlet";
import bigFont from "figlet/importable-fonts/Big.js";
import pc from "picocolors";
import * as clack from "@clack/prompts";

export class CancelError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelError";
  }
}

let isSilent = false;

export function setSilent(value: boolean): void {
  isSilent = value;
}

export function showBanner(name: string): void {
  if (isSilent) return;
  figlet.parseFont("Big", bigFont);
  const banner = figlet.textSync(name, { font: "Big" as figlet.Fonts });
  console.log(pc.dim(banner));
  console.log();
}

export function info(msg: string): void {
  if (isSilent) return;
  console.log(`  ${msg}`);
}

export function success(msg: string): void {
  if (isSilent) return;
  console.log(`  ${pc.green(msg)}`);
}

export function warn(msg: string): void {
  if (isSilent) return;
  console.warn(`  ${pc.yellow(msg)}`);
}

export function error(msg: string): void {
  console.error(`  ${pc.red(msg)}`);
}

export function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function fileAction(action: string, filePath: string): void {
  if (isSilent) return;
  console.log(`  ${action} ${filePath}`);
}

export function heading(msg: string): void {
  if (isSilent) return;
  console.log();
  console.log(`  ${pc.bold(msg)}`);
}

export async function promptConfirm(message: string, initialValue = true): Promise<boolean> {
  if (isSilent) return initialValue;

  const result = await clack.confirm({ message, initialValue });
  if (clack.isCancel(result)) {
    throw new CancelError();
  }
  return result;
}

export async function promptSelect<T extends { value: string; label: string; hint?: string }>(
  message: string,
  options: T[],
): Promise<string> {
  if (isSilent) return options[0]?.value ?? "";

  const result = await clack.select({ message, options });
  if (clack.isCancel(result)) {
    throw new CancelError();
  }
  return result as string;
}

export async function promptText(message: string, opts?: {
  placeholder?: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string> {
  if (isSilent) return opts?.defaultValue ?? "";

  const result = await clack.text({
    message,
    placeholder: opts?.placeholder,
    defaultValue: opts?.defaultValue,
    validate: opts?.validate,
  });
  if (clack.isCancel(result)) {
    throw new CancelError();
  }
  return result;
}

export function isSilentMode(): boolean {
  return isSilent;
}
