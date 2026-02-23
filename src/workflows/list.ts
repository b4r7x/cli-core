import { info } from "../logger.js";

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

export function runListWorkflow<TItem, TConfig>(
  options: RunListWorkflowOptions<TItem, TConfig>,
): void {
  const {
    cwd,
    includeAll,
    installedOnly,
    json,
    itemPlural,
    getAllItems,
    getPublicItems,
    requireConfig,
    isInstalled,
    toDisplayItem,
  } = options;

  let items = includeAll ? getAllItems() : getPublicItems();
  if (installedOnly) {
    const config = requireConfig(cwd);
    items = items.filter((item) => isInstalled({ cwd, config, item }));
  }

  const displayItems = items
    .map(toDisplayItem)
    .sort((left, right) => left.name.localeCompare(right.name));

  if (json) {
    console.log(JSON.stringify(displayItems, null, 2));
    return;
  }

  if (displayItems.length === 0) {
    console.log();
    info(installedOnly ? `No installed ${itemPlural} found.` : `No ${itemPlural} available.`);
    console.log();
    return;
  }

  const label = installedOnly ? "Installed" : "Available";
  console.log();
  info(`${label} ${itemPlural} (${displayItems.length}):`);
  console.log();

  const maxLen = Math.max(...displayItems.map((item) => item.name.length)) + 2;
  for (const item of displayItems) {
    info(`  ${item.name.padEnd(maxLen)} ${item.description}`);
  }
  console.log();
}
