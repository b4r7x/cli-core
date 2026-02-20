import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { toErrorMessage } from "./logger.js";

export const RegistryFileSchema = z.object({
  path: z.string().refine(
    (p) => !p.split("/").includes("..") && !p.split("\\").includes(".."),
    { message: "Registry file path must not contain '..' segments" },
  ),
  content: z.string().optional(),
  targetPath: z.string().optional(),
  type: z.string().optional(),
});

export const RegistryItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  dependencies: z.array(z.string()),
  registryDependencies: z.array(z.string()),
  files: z.array(RegistryFileSchema),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type RegistryFile = z.infer<typeof RegistryFileSchema>;
export type RegistryItem = z.infer<typeof RegistryItemSchema>;

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
      // Skip URL-based deps (cross-registry refs resolved by shadcn, not the custom CLI)
      if (dep.startsWith("http://") || dep.startsWith("https://")) continue;
      walk(dep);
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

/**
 * Factory that creates a cached, integrity-checked registry bundle loader.
 * Eliminates the boilerplate of loading → parsing → validating → integrity-checking.
 */
export function createRegistryLoader<TBundle extends { integrity?: string }>(
  bundlePath: string,
  bundleSchema: z.ZodType<TBundle>,
  integrityContent: (bundle: TBundle) => unknown,
): () => TBundle {
  let cached: TBundle | null = null;

  return (): TBundle => {
    if (cached) return cached;

    if (!existsSync(bundlePath)) {
      throw new Error(
        `Registry bundle not found at ${bundlePath}. ` +
        `This usually means the package was not built correctly — try reinstalling.`,
      );
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(bundlePath, "utf-8"));
    } catch (e) {
      throw new Error(
        `Failed to parse registry bundle at ${bundlePath}. (${toErrorMessage(e)})`,
      );
    }

    const bundle = bundleSchema.parse(raw);

    if (bundle.integrity) {
      const content = JSON.stringify(integrityContent(bundle));
      const expected = "sha256-" + createHash("sha256").update(content).digest("hex");
      if (bundle.integrity !== expected) {
        throw new Error(
          "Registry bundle integrity mismatch. The bundle may have been tampered with. " +
          "Reinstall the package or rebuild the registry bundle.",
        );
      }
    }

    cached = bundle;
    return cached;
  };
}

/**
 * Type-safe accessor for fields stored in a registry item's `meta` object.
 */
export function metaField<T>(item: { meta?: Record<string, unknown> }, key: string, fallback: T): T {
  const val = item.meta?.[key];
  return val !== undefined ? (val as T) : fallback;
}
