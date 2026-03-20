import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  createRegistryLoader,
  BaseRegistryBundleSchema,
  parseRegistryDependencyRef,
  resolveRegistryDeps,
  collectNpmDeps,
  metaField,
} from "../dist/registry.js";

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cli-core-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeBundle(items, extra = {}) {
  const contentForHash = JSON.stringify({ items, ...extra });
  const integrity = "sha256-" + createHash("sha256").update(contentForHash).digest("hex");
  return { schemaVersion: 1, items, integrity, ...extra };
}

const itemSchema = z.object({
  name: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});

const bundleSchema = BaseRegistryBundleSchema;

describe("createRegistryLoader", () => {
  test("loads and parses a valid bundle", () => {
    withTmpDir((dir) => {
      const bundle = makeBundle([]);
      writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle));
      const load = createRegistryLoader(join(dir, "bundle.json"), bundleSchema, (b) => ({ items: b.items }));
      const result = load();
      assert.equal(result.schemaVersion, 1);
      assert.deepEqual(result.items, []);
    });
  });

  test("caches the result on repeated calls", () => {
    withTmpDir((dir) => {
      const bundle = makeBundle([]);
      const p = join(dir, "bundle.json");
      writeFileSync(p, JSON.stringify(bundle));
      const load = createRegistryLoader(p, bundleSchema, (b) => ({ items: b.items }));
      const first = load();
      const second = load();
      assert.equal(first, second);
    });
  });

  test("throws when bundle file is missing", () => {
    withTmpDir((dir) => {
      const load = createRegistryLoader(join(dir, "missing.json"), bundleSchema, (b) => ({ items: b.items }));
      assert.throws(() => load(), /Registry bundle not found/);
    });
  });

  test("throws on invalid JSON", () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, "bundle.json"), "not json");
      const load = createRegistryLoader(join(dir, "bundle.json"), bundleSchema, (b) => ({ items: b.items }));
      assert.throws(() => load(), /Failed to parse registry bundle/);
    });
  });

  test("throws on integrity mismatch", () => {
    withTmpDir((dir) => {
      const bundle = { schemaVersion: 1, items: [], integrity: "sha256-badhash" };
      writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle));
      const load = createRegistryLoader(join(dir, "bundle.json"), bundleSchema, (b) => ({ items: b.items }));
      assert.throws(() => load(), /integrity mismatch/);
    });
  });

  test("throws on schema version newer than supported", () => {
    withTmpDir((dir) => {
      const bundle = { schemaVersion: 999, items: [] };
      writeFileSync(join(dir, "bundle.json"), JSON.stringify(bundle));
      const load = createRegistryLoader(join(dir, "bundle.json"), bundleSchema, (b) => ({ items: b.items }));
      assert.throws(() => load(), /newer than supported/);
    });
  });
});

describe("parseRegistryDependencyRef", () => {
  test("parses local ref", () => {
    const result = parseRegistryDependencyRef("button");
    assert.deepEqual(result, { kind: "local", raw: "button", name: "button" });
  });

  test("parses namespace ref", () => {
    const result = parseRegistryDependencyRef("@keyscope/navigation");
    assert.deepEqual(result, { kind: "namespace", raw: "@keyscope/navigation", namespace: "@keyscope", name: "navigation" });
  });

  test("throws on URL ref", () => {
    assert.throws(() => parseRegistryDependencyRef("https://example.com/item"), /no longer supported/);
  });

  test("throws on empty ref", () => {
    assert.throws(() => parseRegistryDependencyRef("  "), /cannot be empty/);
  });
});

describe("resolveRegistryDeps", () => {
  const items = {
    a: { name: "a", type: "t", title: "A", description: "", dependencies: [], registryDependencies: ["b"], files: [] },
    b: { name: "b", type: "t", title: "B", description: "", dependencies: [], registryDependencies: [], files: [] },
    c: { name: "c", type: "t", title: "C", description: "", dependencies: [], registryDependencies: ["a"], files: [] },
  };
  const getItem = (name) => items[name];

  test("resolves single item with no deps", () => {
    assert.deepEqual(resolveRegistryDeps(["b"], getItem), ["b"]);
  });

  test("resolves transitive dependencies in order", () => {
    const result = resolveRegistryDeps(["a"], getItem);
    assert.ok(result.indexOf("b") < result.indexOf("a"));
  });

  test("deduplicates shared deps", () => {
    const result = resolveRegistryDeps(["a", "b"], getItem);
    assert.equal(result.filter((n) => n === "b").length, 1);
  });

  test("throws on unknown dep", () => {
    assert.throws(() => resolveRegistryDeps(["x"], getItem), /"x" not found in registry/);
  });

  test("throws on circular deps", () => {
    const circular = {
      x: { name: "x", type: "t", title: "X", description: "", dependencies: [], registryDependencies: ["y"], files: [] },
      y: { name: "y", type: "t", title: "Y", description: "", dependencies: [], registryDependencies: ["x"], files: [] },
    };
    assert.throws(() => resolveRegistryDeps(["x"], (n) => circular[n]), /Circular/);
  });

  test("skips namespace refs", () => {
    const withNs = {
      a: { name: "a", type: "t", title: "A", description: "", dependencies: [], registryDependencies: ["@ns/external"], files: [] },
    };
    assert.doesNotThrow(() => resolveRegistryDeps(["a"], (n) => withNs[n]));
  });
});

describe("collectNpmDeps", () => {
  test("collects all npm dependencies from items", () => {
    const items = {
      a: { name: "a", type: "t", title: "", description: "", dependencies: ["react", "clsx"], registryDependencies: [], files: [] },
      b: { name: "b", type: "t", title: "", description: "", dependencies: ["clsx"], registryDependencies: [], files: [] },
    };
    const result = collectNpmDeps(["a", "b"], (n) => items[n]);
    assert.ok(result.includes("react"));
    assert.ok(result.includes("clsx"));
    assert.equal(result.filter((d) => d === "clsx").length, 1);
  });

  test("returns empty array when items have no deps", () => {
    const items = {
      a: { name: "a", type: "t", title: "", description: "", dependencies: [], registryDependencies: [], files: [] },
    };
    assert.deepEqual(collectNpmDeps(["a"], (n) => items[n]), []);
  });
});

describe("metaField", () => {
  test("returns meta value when present", () => {
    const item = { meta: { client: true } };
    assert.equal(metaField(item, "client", false), true);
  });

  test("returns fallback when meta key is absent", () => {
    const item = { meta: {} };
    assert.equal(metaField(item, "client", false), false);
  });

  test("returns fallback when meta is undefined", () => {
    const item = {};
    assert.equal(metaField(item, "client", "default"), "default");
  });
});
