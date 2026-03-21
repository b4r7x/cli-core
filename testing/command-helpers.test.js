import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createRequireConfig,
  getItemOrThrow,
  validateItems,
  getRelativePath,
  parseEnumOption,
  createInstallChecker,
} from "../dist/command-helpers.js";

test("createRequireConfig", async (t) => {
  await t.test("returns config when loadResolved succeeds", () => {
    const require = createRequireConfig({
      configFileName: "test.json",
      initCommand: "test init",
      loadResolved: () => ({ ok: true, config: { name: "hello" } }),
    });
    assert.deepEqual(require("/any"), { name: "hello" });
  });

  await t.test("throws with init message when config not found", () => {
    const require = createRequireConfig({
      configFileName: "test.json",
      initCommand: "test init",
      loadResolved: () => ({ ok: false, error: "not_found" }),
    });
    assert.throws(() => require("/any"), /Run `test init` first/);
  });

  await t.test("throws with malformed message on parse_error", () => {
    const require = createRequireConfig({
      configFileName: "test.json",
      initCommand: "test init",
      loadResolved: () => ({ ok: false, error: "parse_error", message: "bad JSON" }),
    });
    assert.throws(() => require("/any"), /malformed/);
  });
});

test("getItemOrThrow", async (t) => {
  const items = new Map([["button", { name: "button", type: "ui", title: "Button", description: "", dependencies: [], registryDependencies: [], files: [] }]]);

  await t.test("returns item when found", () => {
    const item = getItemOrThrow("button", (n) => items.get(n), "component", "list");
    assert.equal(item.name, "button");
  });

  await t.test("throws when not found", () => {
    assert.throws(() => getItemOrThrow("missing", (n) => items.get(n), "component", "list"), /not found/);
  });
});

test("validateItems", async (t) => {
  const items = new Map([["button", {}], ["card", {}]]);

  await t.test("does not throw when all items exist", () => {
    assert.doesNotThrow(() => validateItems(["button", "card"], (n) => items.get(n), "component", "list"));
  });

  await t.test("throws listing all missing items", () => {
    assert.throws(
      () => validateItems(["button", "missing1", "missing2"], (n) => items.get(n), "component", "list"),
      /missing1.*missing2/,
    );
  });
});

test("getRelativePath", async (t) => {
  await t.test("returns targetPath when present", () => {
    assert.equal(getRelativePath({ path: "registry/ui/button.tsx", targetPath: "custom/button.tsx" }, ["registry/"]), "custom/button.tsx");
  });

  await t.test("strips matching prefix", () => {
    assert.equal(getRelativePath({ path: "registry/ui/button.tsx" }, ["registry/"]), "ui/button.tsx");
  });

  await t.test("tries multiple prefixes", () => {
    assert.equal(getRelativePath({ path: "hooks/use-state.ts" }, ["registry/", "hooks/"]), "use-state.ts");
  });

  await t.test("throws when no prefix matches", () => {
    assert.throws(() => getRelativePath({ path: "other/file.ts" }, ["registry/"]), /Unsupported/);
  });
});

test("parseEnumOption", async (t) => {
  await t.test("returns value when valid", () => {
    assert.equal(parseEnumOption("copy", ["copy", "package", "none"], "integration"), "copy");
  });

  await t.test("throws on invalid value", () => {
    assert.throws(() => parseEnumOption("invalid", ["copy", "package"], "integration"), /Invalid integration/);
  });
});

test("createInstallChecker", async (t) => {
  await t.test("returns true when item is in manifest", () => {
    const checker = createInstallChecker({
      getManifest: () => ({ button: { installedAt: "x" } }),
      getItem: () => undefined,
      getRelativePath: () => "",
      installDir: "/tmp",
    });
    assert.equal(checker("button"), true);
  });

  await t.test("returns true when file exists on disk", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-core-checker-"));
    try {
      mkdirSync(join(tmp, "ui"), { recursive: true });
      writeFileSync(join(tmp, "ui", "button.tsx"), "");
      const checker = createInstallChecker({
        getManifest: () => undefined,
        getItem: (name) => name === "button" ? {
          name: "button", type: "ui", title: "", description: "",
          dependencies: [], registryDependencies: [],
          files: [{ path: "registry/ui/button.tsx" }],
        } : undefined,
        getRelativePath: (file) => file.path.replace("registry/", ""),
        installDir: tmp,
      });
      assert.equal(checker("button"), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns false when item not found", () => {
    const checker = createInstallChecker({
      getManifest: () => undefined,
      getItem: () => undefined,
      getRelativePath: () => "",
      installDir: "/tmp",
    });
    assert.equal(checker("missing"), false);
  });
});

