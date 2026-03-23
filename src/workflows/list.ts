import { info, newline } from "../logger.js";

export interface ListDisplayItem {
  name: string;
  title: string;
  description: string;
  dependencies: string[];
  files: string[];
}

export interface RunListWorkflowOptions<TItem, TConfig> {
  cwd: string;
  includeAll: boolean;
  installedOnly: boolean;
  json: boolean;
  itemPlural: string;
  getAllItems: () => TItem[];
  getPublicItems: () => TItem[];
  requireConfig: (cwd: string) => TConfig;
  isInstalled: (ctx: { cwd: string; config: TConfig; item: TItem }) => boolean;
  toDisplayItem: (item: TItem) => ListDisplayItem;
}

function resolveItems<TItem, TConfig>(options: RunListWorkflowOptions<TItem, TConfig>): TItem[] {
  const { cwd, includeAll, installedOnly, getAllItems, getPublicItems, requireConfig, isInstalled } = options;

  const items = includeAll ? getAllItems() : getPublicItems();
  if (!installedOnly) return items;

  const config = requireConfig(cwd);
  return items.filter((item) => isInstalled({ cwd, config, item }));
}

function printEmptyMessage(installedOnly: boolean, itemPlural: string): void {
  newline();
  info(installedOnly ? `No installed ${itemPlural} found.` : `No ${itemPlural} available.`);
  newline();
}

function printTable(displayItems: ListDisplayItem[], installedOnly: boolean, itemPlural: string): void {
  const label = installedOnly ? "Installed" : "Available";
  newline();
  info(`${label} ${itemPlural} (${displayItems.length}):`);
  newline();

  const maxLen = Math.max(...displayItems.map((item) => item.name.length)) + 2;
  for (const item of displayItems) {
    info(`  ${item.name.padEnd(maxLen)} ${item.description}`);
  }
  newline();
}

export function runListWorkflow<TItem, TConfig>(
  options: RunListWorkflowOptions<TItem, TConfig>,
): void {
  const { json, installedOnly, itemPlural, toDisplayItem } = options;

  const displayItems = resolveItems(options)
    .map(toDisplayItem)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (json) {
    console.log(JSON.stringify(displayItems, null, 2));
    return;
  }

  if (displayItems.length === 0) return printEmptyMessage(installedOnly, itemPlural);

  printTable(displayItems, installedOnly, itemPlural);
}
