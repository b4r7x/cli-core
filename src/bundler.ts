import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { metaField, parseRegistryDependencyRef } from "./registry.js";

// ---------------------------------------------------------------------------
// detectNpmImports — shared import detection for bundle-registry scripts
// ---------------------------------------------------------------------------

const DEFAULT_PEER_DEPS = new Set(["react", "react-dom"]);
const DEFAULT_ALIAS_PREFIXES = ["@/", "./", "../", "node:"];

export interface DetectNpmImportsOptions {
  peerDeps?: Set<string>;
  aliasPrefixes?: string[];
}

export function detectNpmImports(
  content: string,
  options?: DetectNpmImportsOptions,
): string[] {
  const peerDeps = options?.peerDeps ?? DEFAULT_PEER_DEPS;
  const aliasPrefixes = options?.aliasPrefixes ?? DEFAULT_ALIAS_PREFIXES;
  const imports: string[] = [];

  for (const line of content.split("\n")) {
    if (/^\s*import\s+type\s/.test(line)) continue;
    if (/^\s*export\s+type\s/.test(line)) continue;

    const match = /from\s+["']([^"']+)["']/.exec(line);
    if (!match) continue;

    const pkg = match[1]!;
    if (aliasPrefixes.some((p) => pkg.startsWith(p))) continue;

    const parts = pkg.split("/");
    const pkgName = pkg.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!;
    if (!peerDeps.has(pkgName)) imports.push(pkgName);
  }

  return [...new Set(imports)];
}

// ---------------------------------------------------------------------------
// createBundler — factory for registry bundle scripts
// ---------------------------------------------------------------------------

const RegistrySourceFileSchema = z.object({
  path: z.string(),
  type: z.string().optional(),
});

const RegistrySourceItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  dependencies: z.array(z.string()).optional().default([]),
  registryDependencies: z.array(z.string()).optional().default([]),
  files: z.array(RegistrySourceFileSchema),
  meta: z.record(z.string(), z.unknown()).optional(),
});

const RegistrySourceSchema = z.object({
  items: z.array(RegistrySourceItemSchema),
});

type RegistrySourceItem = z.infer<typeof RegistrySourceItemSchema>;

export interface BundleFile {
  path: string;
  content: string;
  targetPath?: string;
  type?: string;
}

export interface BundleItem {
  name: string;
  type: string;
  title: string;
  description: string;
  dependencies: string[];
  registryDependencies: string[];
  files: BundleFile[];
  meta?: Record<string, unknown>;
}

export interface BundlerConfig {
  /** Absolute path to the project root (where registry/ lives). */
  rootDir: string;
  /** Absolute path to output the bundle JSON. */
  outputPath: string;
  /** Peer deps to exclude from npm import detection. */
  peerDeps?: Set<string>;
  /** Core deps to strip from detected dependencies (e.g. cva, clsx). */
  coreDeps?: Set<string>;
  /** Import path prefixes to skip during npm import detection. */
  aliasPrefixes?: string[];
  /** Optional path rewriting for bundle file paths. */
  transformPath?: (path: string) => string;
  /** Return extra top-level fields to include in the bundle (e.g. theme, styles). */
  extraContent?: (rootDir: string) => Record<string, unknown>;
  /** Default value for the `client` field when not specified. */
  clientDefault?: boolean;
  /** Label for items in error messages (e.g. "hook", "component"). */
  itemLabel?: string;
}

export interface BundleResult {
  items: BundleItem[];
  integrity: string;
  extra: Record<string, unknown>;
}

export function createBundler(config: BundlerConfig): () => BundleResult {
  return (): BundleResult => {
    const {
      rootDir,
      outputPath,
      peerDeps = DEFAULT_PEER_DEPS,
      coreDeps,
      aliasPrefixes = DEFAULT_ALIAS_PREFIXES,
      transformPath,
      extraContent,
      clientDefault = false,
      itemLabel = "item",
    } = config;

    const detectOpts: DetectNpmImportsOptions = { peerDeps, aliasPrefixes };

    console.log("Bundling registry...");

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
    const bundle = { items, ...extra, integrity };
    const bundleJson = JSON.stringify(bundle);

    mkdirSync(dirname(outputPath), { recursive: true });
    const tmpPath = outputPath + ".tmp";
    writeFileSync(tmpPath, bundleJson);
    renameSync(tmpPath, outputPath);

    // Summary
    const totalFiles = items.reduce((acc, i) => acc + i.files.length, 0);
    const sizeKb = (Buffer.byteLength(bundleJson) / 1024).toFixed(1);
    console.log(`  Bundled ${items.length} ${itemLabel}s (${totalFiles} files)`);
    console.log(`  Bundle size: ${sizeKb} KB`);
    console.log(`  Integrity: ${integrity}`);
    console.log(`  Output: ${outputPath}`);

    console.log("\n  Dependencies:");
    for (const item of items) {
      if (item.dependencies.length > 0) {
        console.log(`    ${item.name}: ${item.dependencies.join(", ")}`);
      }
    }

    return { items, integrity, extra };
  };
}
