import { z } from "zod";

const DEFAULT_PEER_DEPS = new Set<string>();
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
