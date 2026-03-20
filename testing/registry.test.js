import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

import {
  parseRegistryDependencyRef,
  resolveRegistryDeps,
  collectNpmDeps,
  createRegistryLoader,
  metaField,
  createRegistryAccessors,
  BaseRegistryBundleSchema,
} from "../dist/registry.js";

test("parseRegistryDependencyRef", async (t) => {
  await t.test("parses local ref", () => {
    const result = parseRegistryDependencyRef("button");
    assert.equal(result.kind, "local");
    assert.equal(result.name, "button");
  });

  await t.test("parses namespace ref", () => {
    const result = parseRegistryDependencyRef("@keyscope/navigation");
    assert.equal(result.kind, "namespace");
    if (result.kind === "namespace") {
      assert.equal(result.namespace, "@keyscope");
      assert.equal(result.name, "navigation");
    }
  });

  await t.test("throws on empty ref", () => {
    assert.throws(() => parseRegistryDependencyRef(""), /cannot be empty/);
  });

  await t.test("throws on URL ref", () => {
    assert.throws(() => parseRegistryDependencyRef("https://example.com/r/button.json"), /no longer supported/);
  });

  await t.test("trims whitespace", () => {
    const result = parseRegistryDependencyRef("  button  ");
    assert.equal(result.kind, "local");
    assert.equal(result.name, "button");
  });
});

test("resolveRegistryDeps", async (t) => {
  const items = new Map([
    ["button", { name: "button", type: "ui", title: "Button", description: "", dependencies: [], registryDependencies: [], files: [] }],
    ["card", { name: "card", type: "ui", title: "Card", description: "", dependencies: [], registryDependencies: ["button"], files: [] }],
    ["dialog", { name: "dialog", type: "ui", title: "Dialog", description: "", dependencies: [], registryDependencies: ["card"], files: [] }],
  ]);
  const getItem = (name) => items.get(name);

  await t.test("resolves single item with no deps", () => {
    const result = resolveRegistryDeps(["button"], getItem);
    assert.deepEqual(result, ["button"]);
  });

  await t.test("resolves transitive deps in correct order", () => {
    const result = resolveRegistryDeps(["dialog"], getItem);
    assert.deepEqual(result, ["button", "card", "dialog"]);
  });

  await t.test("deduplicates dependencies", () => {
    const result = resolveRegistryDeps(["button", "card"], getItem);
    assert.deepEqual(result, ["button", "card"]);
  });

  await t.test("throws on missing item", () => {
    assert.throws(() => resolveRegistryDeps(["nonexistent"], getItem), /not found/);
  });

  await t.test("throws on circular dependency", () => {
    const circular = new Map([
      ["a", { name: "a", type: "ui", title: "A", description: "", dependencies: [], registryDependencies: ["b"], files: [] }],
      ["b", { name: "b", type: "ui", title: "B", description: "", dependencies: [], registryDependencies: ["a"], files: [] }],
    ]);
    assert.throws(() => resolveRegistryDeps(["a"], (n) => circular.get(n)), /Circular/);
  });

  await t.test("skips namespace refs", () => {
    const withNamespace = new Map([
      ["menu", { name: "menu", type: "ui", title: "Menu", description: "", dependencies: [], registryDependencies: ["@keyscope/navigation"], files: [] }],
    ]);
    const result = resolveRegistryDeps(["menu"], (n) => withNamespace.get(n));
    assert.deepEqual(result, ["menu"]);
  });
});

test("collectNpmDeps", async (t) => {
  await t.test("gathers npm deps from items", () => {
    const items = new Map([
      ["button", { name: "button", type: "ui", title: "", description: "", dependencies: ["clsx", "cva"], registryDependencies: [], files: [] }],
      ["card", { name: "card", type: "ui", title: "", description: "", dependencies: ["clsx"], registryDependencies: [], files: [] }],
    ]);
    const result = collectNpmDeps(["button", "card"], (n) => items.get(n));
    assert.deepEqual(new Set(result), new Set(["clsx", "cva"]));
  });

  await t.test("returns empty for items with no deps", () => {
    const items = new Map([
      ["button", { name: "button", type: "ui", title: "", description: "", dependencies: [], registryDependencies: [], files: [] }],
    ]);
    const result = collectNpmDeps(["button"], (n) => items.get(n));
    assert.deepEqual(result, []);
  });
});

test("createRegistryLoader", async (t) => {
  await t.test("loads and caches a valid bundle", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-core-registry-"));
    try {
      const items = [{ name: "button", type: "ui", title: "Button", description: "", dependencies: [], registryDependencies: [], files: [{ path: "ui/button.tsx", content: "export default 1;" }] }];
      const content = JSON.stringify({ items });
      const integrity = "sha256-" + createHash("sha256").update(content).digest("hex");
      const bundle = { schemaVersion: 1, items, integrity };
      const bundlePath = join(tmp, "bundle.json");
      writeFileSync(bundlePath, JSON.stringify(bundle));

      const loader = createRegistryLoader(bundlePath, BaseRegistryBundleSchema, (b) => ({ items: b.items }));
      const result = loader();
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].name, "button");

      // Verify caching - same reference returned
      assert.equal(loader(), result);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("throws when bundle file is missing", () => {
    const loader = createRegistryLoader("/nonexistent/bundle.json", BaseRegistryBundleSchema, () => ({}));
    assert.throws(() => loader(), /not found/);
  });

  await t.test("throws on integrity mismatch", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-core-registry-"));
    try {
      const items = [{ name: "a", type: "ui", title: "", description: "", dependencies: [], registryDependencies: [], files: [{ path: "a.ts", content: "" }] }];
      const bundle = { schemaVersion: 1, items, integrity: "sha256-wrong" };
      const bundlePath = join(tmp, "bundle.json");
      writeFileSync(bundlePath, JSON.stringify(bundle));

      const loader = createRegistryLoader(bundlePath, BaseRegistryBundleSchema, (b) => ({ items: b.items }));
      assert.throws(() => loader(), /integrity mismatch/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("throws on unsupported schema version", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-core-registry-"));
    try {
      const items = [{ name: "a", type: "ui", title: "", description: "", dependencies: [], registryDependencies: [], files: [{ path: "a.ts", content: "" }] }];
      const bundle = { schemaVersion: 999, items };
      const bundlePath = join(tmp, "bundle.json");
      writeFileSync(bundlePath, JSON.stringify(bundle));

      const loader = createRegistryLoader(bundlePath, BaseRegistryBundleSchema, () => ({}));
      assert.throws(() => loader(), /newer than supported/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("metaField", async (t) => {
  await t.test("returns meta value when present", () => {
    assert.equal(metaField({ meta: { client: true } }, "client", false), true);
  });

  await t.test("returns fallback when meta missing", () => {
    assert.equal(metaField({}, "client", false), false);
  });

  await t.test("returns fallback when key missing", () => {
    assert.equal(metaField({ meta: {} }, "client", false), false);
  });
});

test("createRegistryAccessors", async (t) => {
  const items = [
    { name: "button", type: "ui", title: "Button", description: "A button", dependencies: ["clsx"], registryDependencies: [], files: [{ path: "registry/ui/button.tsx", content: "" }], meta: {} },
    { name: "internal", type: "ui", title: "Internal", description: "Hidden", dependencies: [], registryDependencies: [], files: [{ path: "registry/ui/internal.tsx", content: "" }], meta: { hidden: true } },
  ];

  const accessors = createRegistryAccessors({
    loader: () => ({ items }),
    itemLabel: "component",
    pathPrefixes: ["registry/"],
    itemTypeFilter: "ui",
  });

  await t.test("getItem finds by name", () => {
    assert.equal(accessors.getItem("button")?.name, "button");
    assert.equal(accessors.getItem("missing"), undefined);
  });

  await t.test("getPublicItems excludes hidden", () => {
    const pub = accessors.getPublicItems();
    assert.equal(pub.length, 1);
    assert.equal(pub[0].name, "button");
  });

  await t.test("getAllItems includes hidden", () => {
    assert.equal(accessors.getAllItems().length, 2);
  });

  await t.test("relativePath strips prefix", () => {
    assert.equal(accessors.relativePath({ path: "registry/ui/button.tsx" }), "ui/button.tsx");
  });

  await t.test("npmDeps collects deps", () => {
    const deps = accessors.npmDeps(["button"]);
    assert.deepEqual(deps, ["clsx"]);
  });
});
