import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_REGISTRY_ORIGIN = "https://diffgazer.com";

export function ensureExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at "${path}"`);
  }
}

export function resetDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

export function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function normalizeOrigin(raw, options = {}) {
  const defaultOrigin = options.defaultOrigin ?? DEFAULT_REGISTRY_ORIGIN;
  const value = (raw ?? defaultOrigin).trim();
  if (!/^https?:\/\//.test(value)) {
    throw new Error(`REGISTRY_ORIGIN must start with http:// or https:// (received "${value}")`);
  }
  return value.replace(/\/+$/, "");
}

export function collectAllFiles(rootDir, out = []) {
  for (const entry of readdirSync(rootDir)) {
    const fullPath = resolve(rootDir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectAllFiles(fullPath, out);
      continue;
    }
    out.push(fullPath);
  }
  return out;
}

export function collectJsonFiles(rootDir, out = []) {
  for (const entry of readdirSync(rootDir)) {
    const fullPath = resolve(rootDir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectJsonFiles(fullPath, out);
      continue;
    }
    if (fullPath.endsWith(".json")) {
      out.push(fullPath);
    }
  }
  return out;
}

export function relativePath(base, filePath) {
  return filePath.startsWith(`${base}/`) ? filePath.slice(base.length + 1) : filePath;
}

export function computeInputsFingerprint(rootDir, inputs) {
  const hash = createHash("sha256");

  for (const inputRel of inputs) {
    const inputAbs = resolve(rootDir, inputRel);
    if (!existsSync(inputAbs)) continue;
    const stats = statSync(inputAbs);

    if (stats.isDirectory()) {
      const files = collectAllFiles(inputAbs).sort((a, b) => a.localeCompare(b));
      for (const filePath of files) {
        hash.update(relativePath(rootDir, filePath));
        hash.update("\n");
        hash.update(readFileSync(filePath));
        hash.update("\n");
      }
      continue;
    }

    hash.update(inputRel);
    hash.update("\n");
    hash.update(readFileSync(inputAbs));
    hash.update("\n");
  }

  return hash.digest("hex");
}

export function rewriteOriginValue(value, options = {}) {
  const fromOrigin = options.fromOrigin ?? DEFAULT_REGISTRY_ORIGIN;
  const toOrigin = options.toOrigin ?? DEFAULT_REGISTRY_ORIGIN;

  if (typeof value === "string") {
    return value.replaceAll(fromOrigin, toOrigin);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteOriginValue(item, { fromOrigin, toOrigin }));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rewriteOriginValue(item, { fromOrigin, toOrigin }),
      ]),
    );
  }
  return value;
}

export function rewriteOriginsInDir(dir, options = {}) {
  const fromOrigin = options.fromOrigin ?? DEFAULT_REGISTRY_ORIGIN;
  const toOrigin = options.toOrigin ?? DEFAULT_REGISTRY_ORIGIN;
  let changed = 0;
  const files = collectJsonFiles(dir);

  for (const jsonFile of files) {
    const raw = readFileSync(jsonFile, "utf-8");
    const parsed = JSON.parse(raw);
    const rewritten = rewriteOriginValue(parsed, { fromOrigin, toOrigin });
    const next = `${JSON.stringify(rewritten, null, 2)}\n`;
    if (next !== raw) {
      writeFileSync(jsonFile, next);
      changed += 1;
    }
  }

  return {
    changed,
    total: files.length,
  };
}

function ensureSameStringArray(label, a, b, itemName, fixCommand) {
  const left = JSON.stringify(a ?? []);
  const right = JSON.stringify(b ?? []);
  if (left !== right) {
    throw new Error(
      [
        `Public registry is stale for "${itemName}" (${label} mismatch).`,
        `Run: ${fixCommand}`,
      ].join("\n"),
    );
  }
}

export function validatePublicRegistryFresh(options) {
  const {
    rootDir,
    fixCommand,
    sourceRegistryPath = "registry/registry.json",
    publicRegistryDir = "public/r",
  } = options;

  const sourceRegistry = readJson(resolve(rootDir, sourceRegistryPath));
  const publicRegistry = readJson(resolve(rootDir, publicRegistryDir, "registry.json"));
  const sourceItems = sourceRegistry.items ?? [];
  const publicItems = publicRegistry.items ?? [];
  const publicByName = new Map(publicItems.map((item) => [item.name, item]));

  if (sourceItems.length !== publicItems.length) {
    throw new Error(
      [
        "Public registry item count does not match source registry.",
        `Run: ${fixCommand}`,
      ].join("\n"),
    );
  }

  for (const sourceItem of sourceItems) {
    const publicItem = publicByName.get(sourceItem.name);
    if (!publicItem) {
      throw new Error(
        [
          `Public registry missing item "${sourceItem.name}".`,
          `Run: ${fixCommand}`,
        ].join("\n"),
      );
    }

    ensureSameStringArray(
      "dependencies",
      sourceItem.dependencies,
      publicItem.dependencies,
      sourceItem.name,
      fixCommand,
    );
    ensureSameStringArray(
      "registryDependencies",
      sourceItem.registryDependencies,
      publicItem.registryDependencies,
      sourceItem.name,
      fixCommand,
    );

    const publicItemPath = resolve(rootDir, publicRegistryDir, `${sourceItem.name}.json`);
    ensureExists(publicItemPath, `public registry item JSON (${sourceItem.name})`);

    const publicItemJson = readJson(publicItemPath);
    const publicFilesByPath = new Map((publicItemJson.files ?? []).map((file) => [file.path, file]));

    for (const sourceFile of sourceItem.files ?? []) {
      const sourcePath = resolve(rootDir, sourceFile.path);
      ensureExists(sourcePath, `source registry file (${sourceItem.name})`);

      const sourceContent = readFileSync(sourcePath, "utf-8");
      const publicFile = publicFilesByPath.get(sourceFile.path);

      if (!publicFile || typeof publicFile.content !== "string") {
        throw new Error(
          [
            `Public registry file "${sourceFile.path}" missing for "${sourceItem.name}".`,
            `Run: ${fixCommand}`,
          ].join("\n"),
        );
      }

      if (publicFile.content !== sourceContent) {
        throw new Error(
          [
            `Public registry file content is stale for "${sourceFile.path}" (${sourceItem.name}).`,
            `Run: ${fixCommand}`,
          ].join("\n"),
        );
      }
    }
  }
}

export function ensurePublicRegistryReady(options) {
  const {
    rootDir,
    fixCommand,
    sourceRegistryPath = "registry/registry.json",
    publicRegistryDir = "public/r",
    registryPath = sourceRegistryPath,
    outputDir = publicRegistryDir,
    label = "public registry index",
  } = options;

  const publicRegistryIndex = resolve(rootDir, publicRegistryDir, "registry.json");
  const hasLocalShadcn = Boolean(resolveLocalShadcnBin(rootDir));

  if (!existsSync(publicRegistryIndex)) {
    if (!hasLocalShadcn) {
      throw new Error(
        [
          `${label} is missing and local shadcn binary is unavailable.`,
          `Expected: ${publicRegistryIndex}`,
          `Run: ${fixCommand}`,
        ].join("\n"),
      );
    }

    runShadcnRegistryBuild({
      rootDir,
      registryPath,
      outputDir,
    });
  }

  try {
    validatePublicRegistryFresh({
      rootDir,
      fixCommand,
      sourceRegistryPath,
      publicRegistryDir,
    });
  } catch (error) {
    if (!hasLocalShadcn) throw error;

    runShadcnRegistryBuild({
      rootDir,
      registryPath,
      outputDir,
    });
    validatePublicRegistryFresh({
      rootDir,
      fixCommand,
      sourceRegistryPath,
      publicRegistryDir,
    });
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

export function resolveLocalShadcnBin(rootDir) {
  const candidates = [
    resolve(rootDir, "node_modules/.bin/shadcn"),
    resolve(rootDir, "../node_modules/.bin/shadcn"),
    resolve(rootDir, "../../node_modules/.bin/shadcn"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function runShadcnRegistryBuild(options = {}) {
  const {
    rootDir,
    registryPath = "registry/registry.json",
    outputDir = "public/r",
  } = options;

  const localBin = resolveLocalShadcnBin(rootDir);
  const args = ["build", registryPath, "--output", outputDir];
  if (!localBin) {
    throw new Error(
      [
        "Local shadcn CLI binary not found.",
        "Install dependencies so node_modules/.bin/shadcn exists.",
      ].join("\n"),
    );
  }

  resetDir(resolve(rootDir, outputDir));
  run(localBin, args, rootDir);
}

/**
 * Builds shadcn registry output and applies origin rewrite in one step.
 * Optional beforeBuild hook allows library-specific pre-sync work.
 */
export function buildShadcnRegistryWithOrigin(options = {}) {
  const {
    rootDir,
    registryPath = "registry/registry.json",
    outputDir = "public/r",
    originRaw = process.env.REGISTRY_ORIGIN,
    defaultOrigin = DEFAULT_REGISTRY_ORIGIN,
    fromOrigin = defaultOrigin,
    beforeBuild,
  } = options;

  if (!rootDir) {
    throw new Error("buildShadcnRegistryWithOrigin requires `rootDir`.");
  }

  if (typeof beforeBuild === "function") {
    beforeBuild();
  }

  runShadcnRegistryBuild({
    rootDir,
    registryPath,
    outputDir,
  });

  const origin = normalizeOrigin(originRaw, { defaultOrigin });
  rewriteOriginsInDir(resolve(rootDir, outputDir), {
    fromOrigin,
    toOrigin: origin,
  });

  return {
    origin,
    outputDir: resolve(rootDir, outputDir),
  };
}

/**
 * Shared artifact pipeline for shadcn-compatible library registries.
 * Library-specific scripts provide only configuration and optional hooks.
 */
export function buildRegistryArtifacts(options = {}) {
  const {
    rootDir,
    artifactRoot = "dist/artifacts",
    inputs = [],
    manifest,
    manifestFile = "artifact-manifest.json",
    fingerprintFile = "fingerprint.sha256",
    ensurePublicRegistry,
    requiredPaths = [],
    copyDirs = [],
    rewriteDirs = [],
    originRaw = process.env.REGISTRY_ORIGIN,
    defaultOrigin = DEFAULT_REGISTRY_ORIGIN,
    fromOrigin = defaultOrigin,
    beforeBuild,
    afterCopy,
  } = options;

  if (!rootDir) {
    throw new Error("buildRegistryArtifacts requires `rootDir`.");
  }
  if (!manifest || typeof manifest !== "object") {
    throw new Error("buildRegistryArtifacts requires `manifest` object.");
  }

  if (typeof beforeBuild === "function") {
    beforeBuild();
  }

  if (ensurePublicRegistry) {
    ensurePublicRegistryReady({
      rootDir,
      ...ensurePublicRegistry,
    });
  }

  for (const required of requiredPaths) {
    if (typeof required === "string") {
      ensureExists(resolve(rootDir, required), required);
      continue;
    }

    if (!required || typeof required !== "object" || !required.path) {
      throw new Error("Invalid required path entry in buildRegistryArtifacts options.");
    }
    ensureExists(resolve(rootDir, required.path), required.label ?? required.path);
  }

  const origin = normalizeOrigin(originRaw, { defaultOrigin });
  const artifactRootPath = resolve(rootDir, artifactRoot);
  resetDir(artifactRootPath);

  for (const copyEntry of copyDirs) {
    if (!copyEntry || typeof copyEntry !== "object") {
      throw new Error("Invalid copy entry in buildRegistryArtifacts options.");
    }
    const from = resolve(rootDir, copyEntry.from);
    const to = resolve(artifactRootPath, copyEntry.to);
    cpSync(from, to, { recursive: true, force: true });
  }

  for (const relativeDir of rewriteDirs) {
    rewriteOriginsInDir(resolve(artifactRootPath, relativeDir), {
      fromOrigin,
      toOrigin: origin,
    });
  }

  if (typeof afterCopy === "function") {
    afterCopy({
      rootDir,
      artifactRoot: artifactRootPath,
      origin,
    });
  }

  const fingerprint = computeInputsFingerprint(rootDir, inputs);
  const manifestPath = resolve(artifactRootPath, manifestFile);
  const fingerprintPath = resolve(artifactRootPath, fingerprintFile);

  writeJson(manifestPath, manifest);
  writeFileSync(fingerprintPath, `${fingerprint}\n`);

  return {
    origin,
    fingerprint,
    artifactRoot: artifactRootPath,
    manifestPath,
    fingerprintPath,
  };
}
