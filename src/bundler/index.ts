import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { metaField, parseRegistryDependencyRef } from "../registry.js";
import { info, heading } from "../logger.js";
import { detectNpmImports } from "./detect-imports.js";
import type { DetectNpmImportsOptions } from "./detect-imports.js";
import { RegistrySourceSchema } from "./schemas.js";
import type { BundleFile, BundleItem, BundlerConfig, BundleResult } from "./types.js";

export { detectNpmImports } from "./detect-imports.js";
export type { DetectNpmImportsOptions } from "./detect-imports.js";
export type { RegistrySourceItem } from "./schemas.js";
export * from "./types.js";

export function createBundler(config: BundlerConfig): () => BundleResult {
  return (): BundleResult => {
    const {
      rootDir,
      outputPath,
      peerDeps,
      coreDeps,
      aliasPrefixes,
      transformPath,
      extraContent,
      clientDefault = false,
      itemLabel = "item",
    } = config;

    const detectOpts: DetectNpmImportsOptions = { peerDeps, aliasPrefixes };

    info("Bundling registry...");

    // Load and validate registry.json
    const registryPath = resolve(rootDir, "registry/registry.json");
    if (!existsSync(registryPath)) {
      throw new Error(`registry.json not found at ${registryPath}.`);
    }

    let registryRaw: unknown;
    try {
      registryRaw = JSON.parse(readFileSync(registryPath, "utf-8"));
    } catch (e) {
      throw new Error(`Failed to parse registry.json: ${e instanceof Error ? e.message : e}`);
    }

    const parsed = RegistrySourceSchema.safeParse(registryRaw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
      throw new Error(`Invalid registry.json schema:\n${issues}`);
    }

    const { items: sourceItems } = parsed.data;

    // Check for duplicate names
    const names = new Set<string>();
    for (const item of sourceItems) {
      if (names.has(item.name)) {
        throw new Error(`Duplicate ${itemLabel} name: "${item.name}"`);
      }
      names.add(item.name);
    }

    // Validate local registry dependencies exist (namespace refs are cross-registry)
    for (const item of sourceItems) {
      for (const dep of item.registryDependencies) {
        const parsed = parseRegistryDependencyRef(dep);
        if (parsed.kind !== "local") continue;
        if (!names.has(parsed.name)) {
          throw new Error(`"${item.name}" has registryDependency "${dep}" which doesn't exist`);
        }
      }
    }

    // Build bundle items
    const items: BundleItem[] = [];

    for (const item of sourceItems) {
      const files: BundleFile[] = [];
      const allDetectedDeps = new Set<string>(item.dependencies);

      for (const file of item.files) {
        const filePath = resolve(rootDir, file.path);
        if (!existsSync(filePath)) {
          throw new Error(`File not found for ${itemLabel} "${item.name}": ${file.path}\n  Expected at: ${filePath}`);
        }

        const content = readFileSync(filePath, "utf-8");
        const bundlePath = transformPath ? transformPath(file.path) : file.path;
        files.push({ path: bundlePath, content });

        for (const dep of detectNpmImports(content, detectOpts)) {
          allDetectedDeps.add(dep);
        }
      }

      if (coreDeps) {
        for (const d of coreDeps) allDetectedDeps.delete(d);
      }

      items.push({
        name: item.name,
        type: item.type,
        title: item.title,
        description: item.description,
        dependencies: [...allDetectedDeps],
        registryDependencies: item.registryDependencies,
        files,
        meta: {
          client: metaField(item, "client", clientDefault),
          hidden: metaField(item, "hidden", false),
          optionalIntegrations: metaField<string[]>(item, "optionalIntegrations", []),
        },
      });
    }

    // Extra content (theme, styles, etc.)
    const extra = extraContent ? extraContent(rootDir) : {};

    // Compute integrity hash
    const contentForHash = JSON.stringify({ items, ...extra });
    const integrity = "sha256-" + createHash("sha256").update(contentForHash).digest("hex");

    // Write bundle atomically
    const bundle = { schemaVersion: 1, items, ...extra, integrity };
    const bundleJson = JSON.stringify(bundle);

    mkdirSync(dirname(outputPath), { recursive: true });
    const tmpPath = outputPath + ".tmp";
    writeFileSync(tmpPath, bundleJson);
    renameSync(tmpPath, outputPath);

    // Summary
    const totalFiles = items.reduce((acc, i) => acc + i.files.length, 0);
    const sizeKb = (Buffer.byteLength(bundleJson) / 1024).toFixed(1);

    heading("Bundle summary:");
    info(`Bundled ${items.length} ${itemLabel}s (${totalFiles} files)`);
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

    return { items, integrity, extra };
  };
}
