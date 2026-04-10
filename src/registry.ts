import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { toErrorMessage } from "./logger.js";
import { getRelativePath } from "./fs.js";
import { computeIntegrity } from "./integrity.js";

const RegistryFileSchema = z.object({
  path: z.string().refine(
    (p) => !p.split("/").includes("..") && !p.split("\\").includes(".."),
    { message: "Registry file path must not contain '..' segments" },
  ),
  content: z.string().optional(),
  targetPath: z.string().optional(),
  type: z.string().optional(),
});

// NOTE: Near-identical schema exists in registry-kit/src/registry-types.ts.
// This copy adds targetPath field and path traversal .refine().
// Intentionally duplicated: cli-core and registry-kit have no dependency relationship.
export const RegistryItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).default([]),
  registryDependencies: z.array(z.string()).default([]),
  files: z.array(RegistryFileSchema),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type RegistryItem = z.infer<typeof RegistryItemSchema>;

export const RegistryContentFileSchema = RegistryFileSchema.extend({
  content: z.string(),
});

export const RegistryContentItemSchema = RegistryItemSchema.extend({
  files: z.array(RegistryContentFileSchema),
});

export type RegistryContentItem = z.infer<typeof RegistryContentItemSchema>;

export const BaseRegistryBundleSchema = z.object({
  schemaVersion: z.number().optional(),
  items: z.array(RegistryContentItemSchema),
  integrity: z.string().optional(),
});

type BaseRegistryBundle = z.infer<typeof BaseRegistryBundleSchema>;

type ParsedRegistryDependencyRef =
  | { kind: "local"; raw: string; name: string }
  | { kind: "namespace"; raw: string; namespace: string; name: string };

export const REGISTRY_ORIGIN = "https://diffgazer.com";

const NAMESPACE_REF_RE = /^(@[a-z0-9][\w-]*)\/([a-z0-9][\w-]*)$/i;

export function parseRegistryDependencyRef(ref: string): ParsedRegistryDependencyRef {
  const raw = ref.trim();
  if (raw.length === 0) {
    throw new Error("Registry dependency ref cannot be empty.");
  }

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    throw new Error(
      `URL registry dependency refs are no longer supported: "${raw}". Use namespace refs (e.g. "@yourlib/item-name").`,
    );
  }

  const namespaceMatch = NAMESPACE_REF_RE.exec(raw);
  if (namespaceMatch) {
    return {
      kind: "namespace",
      raw,
      namespace: namespaceMatch[1],
      name: namespaceMatch[2],
    };
  }

  return { kind: "local", raw, name: raw };
}

export function resolveRegistryDeps(
  names: string[],
  getItem: (name: string) => RegistryItem | undefined,
  itemLabel = "item",
): string[] {
  const resolved = new Set<string>();
  const stack: string[] = [];

  function walk(name: string): void {
    if (resolved.has(name)) return;

    const cycleStart = stack.indexOf(name);
    if (cycleStart !== -1) {
      const cycle = [...stack.slice(cycleStart), name].join(" -> ");
      throw new Error(`Circular registryDependency detected: ${cycle}`);
    }

    const item = getItem(name);
    if (!item) {
      const requester = stack.length > 0 ? ` (required by "${stack[stack.length - 1]}")` : "";
      throw new Error(`${itemLabel} "${name}" not found in registry${requester}.`);
    }

    stack.push(name);
    for (const dep of item.registryDependencies) {
      const parsed = parseRegistryDependencyRef(dep);
      // Skip cross-registry namespace refs. They are resolved by shadcn/consumer config.
      if (parsed.kind !== "local") continue;
      walk(parsed.name);
    }
    stack.pop();
    resolved.add(name);
  }

  for (const name of names) {
    walk(name);
  }
  return [...resolved];
}

export function collectNpmDeps(
  names: string[],
  getItem: (name: string) => RegistryItem | undefined,
): string[] {
  const deps = new Set(names.flatMap((n) => getItem(n)?.dependencies ?? []));
  return [...deps];
}

const CURRENT_SCHEMA_VERSION = 1;

export function createRegistryLoader<TBundle extends { integrity?: string; schemaVersion?: number }>(
  bundlePath: string,
  bundleSchema: z.ZodType<TBundle>,
  integrityContent: (bundle: TBundle) => unknown,
): () => TBundle {
  let cached: TBundle | null = null;

  return (): TBundle => {
    if (cached) return cached;
    const bundle = loadAndValidateBundle(bundlePath, bundleSchema, integrityContent);
    cached = bundle;
    return bundle;
  };
}

function loadAndValidateBundle<TBundle extends { integrity?: string; schemaVersion?: number }>(
  bundlePath: string,
  bundleSchema: z.ZodType<TBundle>,
  integrityContent: (bundle: TBundle) => unknown,
): TBundle {
  if (!existsSync(bundlePath)) {
    throw new Error(
      `Registry bundle not found at ${bundlePath}. ` +
      `This usually means the package was not built correctly — try reinstalling.`,
    );
  }

  const bundle = bundleSchema.parse(readBundleJson(bundlePath));
  validateSchemaVersion(bundle);
  validateIntegrity(bundle, integrityContent);
  return bundle;
}

function readBundleJson(bundlePath: string): unknown {
  try {
    return JSON.parse(readFileSync(bundlePath, "utf-8"));
  } catch (e) {
    throw new Error(`Failed to parse registry bundle at ${bundlePath}. (${toErrorMessage(e)})`);
  }
}

function validateSchemaVersion(bundle: { schemaVersion?: number }): void {
  if (bundle.schemaVersion !== undefined && bundle.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Registry bundle schema version ${bundle.schemaVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}. ` +
      `Update this CLI to the latest version.`,
    );
  }
}

function validateIntegrity<TBundle extends { integrity?: string }>(
  bundle: TBundle,
  integrityContent: (bundle: TBundle) => unknown,
): void {
  if (!bundle.integrity) return;
  const content = JSON.stringify(integrityContent(bundle));
  const expected = computeIntegrity(content);
  if (bundle.integrity !== expected) {
    throw new Error(
      "Registry bundle integrity mismatch. The bundle may have been tampered with. " +
      "Reinstall the package or rebuild the registry bundle.",
    );
  }
}

export function metaField<T extends string | number | boolean | string[]>(
  item: { meta?: Record<string, unknown> },
  key: string,
  fallback: T,
): T {
  const val = item.meta?.[key];
  if (val === undefined) return fallback;
  if (Array.isArray(fallback)) {
    return Array.isArray(val) ? (val as T) : fallback;
  }
  switch (typeof fallback) {
    case "string":
      return typeof val === "string" ? (val as T) : fallback;
    case "number":
      return typeof val === "number" ? (val as T) : fallback;
    case "boolean":
      return typeof val === "boolean" ? (val as T) : fallback;
    default:
      return fallback;
  }
}

interface CreateRegistryAccessorsOptions {
  loader: () => { items: RegistryContentItem[] };
  itemLabel: string;
  pathPrefixes: string[];
  itemTypeFilter?: string;
}

export interface RegistryAccessors {
  getItem: (name: string) => RegistryContentItem | undefined;
  getPublicItems: () => RegistryContentItem[];
  getAllItems: () => RegistryContentItem[];
  resolveDeps: (names: string[]) => string[];
  relativePath: (file: { path: string; targetPath?: string }) => string;
  npmDeps: (names: string[]) => string[];
}

export function createRegistryAccessors(options: CreateRegistryAccessorsOptions): RegistryAccessors {
  const { loader, itemLabel, pathPrefixes, itemTypeFilter } = options;

  let itemMap: Map<string, RegistryContentItem> | null = null;
  function getItem(name: string): RegistryContentItem | undefined {
    if (!itemMap) {
      itemMap = new Map(loader().items.map((i) => [i.name, i]));
    }
    return itemMap.get(name);
  }

  function getAllItems(): RegistryContentItem[] {
    const items = loader().items;
    return itemTypeFilter ? items.filter((item) => item.type === itemTypeFilter) : items;
  }

  function getPublicItems(): RegistryContentItem[] {
    return getAllItems().filter((item) => !metaField(item, "hidden", false));
  }

  return {
    getItem,
    getPublicItems,
    getAllItems,
    resolveDeps: (names) => resolveRegistryDeps(names, getItem, itemLabel),
    relativePath: (file) => getRelativePath(file, pathPrefixes),
    npmDeps: (names) => collectNpmDeps(names, getItem),
  };
}
