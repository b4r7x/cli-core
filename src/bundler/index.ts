import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { metaField, parseRegistryDependencyRef } from "../registry.js";
import { info, heading, toErrorMessage } from "../logger.js";
import { atomicWriteFile } from "../fs.js";
import { computeIntegrity } from "../integrity.js";
import { detectNpmImports, type DetectNpmImportsOptions } from "./detect-imports.js";
import { RegistrySourceSchema, type RegistrySourceItem } from "./schemas.js";
import type { BundleFile, BundleItem, BundlerConfig, BundleResult } from "./types.js";


interface BundleContext {
  rootDir: string;
  itemLabel: string;
  detectOpts: DetectNpmImportsOptions;
  transformPath: BundlerConfig["transformPath"];
  coreDeps: Set<string> | undefined;
  clientDefault: boolean;
}

interface BundleSummary {
  itemCount: number;
  fileCount: number;
  bundleJson: string;
  integrity: string;
  outputPath: string;
  itemLabel: string;
}

function readRegistryJson(registryPath: string): unknown {
  if (!existsSync(registryPath)) {
    throw new Error(`registry.json not found at ${registryPath}.`);
  }

  try {
    return JSON.parse(readFileSync(registryPath, "utf-8"));
  } catch (e) {
    throw new Error(`Failed to parse registry.json: ${toErrorMessage(e)}`);
  }
}

function parseRegistrySource(raw: unknown): RegistrySourceItem[] {
  const parsed = RegistrySourceSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid registry.json schema:\n${issues}`);
  }
  return parsed.data.items;
}

function validateNoDuplicates(items: RegistrySourceItem[], itemLabel: string): Set<string> {
  const names = new Set<string>();
  for (const item of items) {
    if (names.has(item.name)) throw new Error(`Duplicate ${itemLabel} name: "${item.name}"`);
    names.add(item.name);
  }
  return names;
}

function validateRegistryDeps(items: RegistrySourceItem[], names: Set<string>): void {
  for (const item of items) {
    validateItemDeps(item, names);
  }
}

function validateItemDeps(item: RegistrySourceItem, names: Set<string>): void {
  for (const dep of item.registryDependencies) {
    const depRef = parseRegistryDependencyRef(dep);
    if (depRef.kind === "local" && !names.has(depRef.name)) {
      throw new Error(`"${item.name}" has registryDependency "${dep}" which doesn't exist`);
    }
  }
}

function loadAndValidateRegistry(registryPath: string, itemLabel: string): RegistrySourceItem[] {
  const raw = readRegistryJson(registryPath);
  const items = parseRegistrySource(raw);
  const names = validateNoDuplicates(items, itemLabel);
  validateRegistryDeps(items, names);
  return items;
}

function readAndBundleFiles(
  sourceItem: RegistrySourceItem,
  ctx: BundleContext,
): { files: BundleFile[]; detectedDeps: Set<string> } {
  const { rootDir, itemLabel, detectOpts, transformPath } = ctx;
  const files: BundleFile[] = [];
  const detectedDeps = new Set<string>(sourceItem.dependencies);

  for (const file of sourceItem.files) {
    const filePath = resolve(rootDir, file.path);
    if (!existsSync(filePath)) {
      throw new Error(`File not found for ${itemLabel} "${sourceItem.name}": ${file.path}\n  Expected at: ${filePath}`);
    }

    const content = readFileSync(filePath, "utf-8");
    const bundlePath = transformPath ? transformPath(file.path) : file.path;
    files.push({ path: bundlePath, content });
    detectNpmImports(content, detectOpts).forEach((dep) => detectedDeps.add(dep));
  }

  return { files, detectedDeps };
}

function bundleItem(
  sourceItem: RegistrySourceItem,
  ctx: BundleContext,
): BundleItem {
  const { files, detectedDeps } = readAndBundleFiles(sourceItem, ctx);

  if (ctx.coreDeps) {
    for (const d of ctx.coreDeps) detectedDeps.delete(d);
  }

  return {
    name: sourceItem.name,
    type: sourceItem.type,
    title: sourceItem.title ?? sourceItem.name,
    description: sourceItem.description ?? "",
    dependencies: [...detectedDeps],
    registryDependencies: sourceItem.registryDependencies,
    files,
    meta: {
      client: metaField(sourceItem, "client", ctx.clientDefault),
      hidden: metaField(sourceItem, "hidden", false),
      optionalIntegrations: metaField<string[]>(sourceItem, "optionalIntegrations", []),
    },
  };
}

function reportBundleSummary(summary: BundleSummary, items: BundleItem[]): void {
  const { itemCount, fileCount, bundleJson, integrity, outputPath, itemLabel } = summary;
  const sizeKb = (Buffer.byteLength(bundleJson) / 1024).toFixed(1);

  heading("Bundle summary:");
  info(`Bundled ${itemCount} ${itemLabel}s (${fileCount} files)`);
  info(`Bundle size: ${sizeKb} KB`);
  info(`Integrity: ${integrity}`);
  info(`Output: ${outputPath}`);

  const itemsWithDeps = items.filter(i => i.dependencies.length > 0);
  if (itemsWithDeps.length > 0) {
    heading("Dependencies:");
    for (const item of itemsWithDeps) {
      info(`  ${item.name}: ${item.dependencies.join(", ")}`);
    }
  }
}

export function createBundler(config: BundlerConfig): () => BundleResult {
  return (): BundleResult => {
    const { rootDir, outputPath, extraContent, clientDefault = false, itemLabel = "item" } = config;

    info("Bundling registry...");

    const registryPath = resolve(rootDir, "registry/registry.json");
    const sourceItems = loadAndValidateRegistry(registryPath, itemLabel);

    const ctx: BundleContext = {
      rootDir,
      itemLabel,
      detectOpts: { peerDeps: config.peerDeps, aliasPrefixes: config.aliasPrefixes },
      transformPath: config.transformPath,
      coreDeps: config.coreDeps,
      clientDefault,
    };
    const items = sourceItems.map((item) => bundleItem(item, ctx));

    const extra = extraContent ? extraContent(rootDir) : {};
    const integrity = computeIntegrity(JSON.stringify({ items, ...extra }));
    const bundleJson = JSON.stringify({ schemaVersion: 1, items, ...extra, integrity });

    atomicWriteFile(outputPath, bundleJson);
    const totalFiles = items.reduce((acc, i) => acc + i.files.length, 0);
    reportBundleSummary({ itemCount: items.length, fileCount: totalFiles, bundleJson, integrity, outputPath, itemLabel }, items);

    return { items, integrity, extra };
  };
}
