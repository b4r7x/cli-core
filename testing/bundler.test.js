import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createBundler } from "../dist/bundler/index.js";

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cli-core-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function setupRegistry(dir, items = []) {
  mkdirSync(join(dir, "registry"), { recursive: true });
  writeFileSync(join(dir, "registry", "registry.json"), JSON.stringify({ items }));
}

function makeItem(name, files = []) {
  return {
    name,
    type: "registry:ui",
    title: name,
    description: `${name} component`,
    files,
  };
}

describe("createBundler", () => {
  test("bundles an empty registry", () => {
    withTmpDir((dir) => {
      const outputPath = join(dir, "out", "bundle.json");
      setupRegistry(dir, []);
      const bundle = createBundler({ rootDir: dir, outputPath })();
      assert.deepEqual(bundle.items, []);
      assert.ok(bundle.integrity.startsWith("sha256-"));
      assert.ok(existsSync(outputPath));
    });
  });

  test("bundles items with file content", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, "registry", "ui", "button"), { recursive: true });
      writeFileSync(join(dir, "registry", "ui", "button", "button.tsx"), "export function Button() {}");
      setupRegistry(dir, [
        makeItem("button", [{ path: "registry/ui/button/button.tsx" }]),
      ]);
      const outputPath = join(dir, "bundle.json");
      const bundle = createBundler({ rootDir: dir, outputPath })();
      assert.equal(bundle.items.length, 1);
      assert.equal(bundle.items[0].name, "button");
      assert.equal(bundle.items[0].files[0].content, "export function Button() {}");
    });
  });

  test("writes bundle JSON to outputPath", () => {
    withTmpDir((dir) => {
      const outputPath = join(dir, "dist", "bundle.json");
      setupRegistry(dir, []);
      createBundler({ rootDir: dir, outputPath })();
      const written = JSON.parse(readFileSync(outputPath, "utf-8"));
      assert.equal(written.schemaVersion, 1);
      assert.ok(written.integrity.startsWith("sha256-"));
    });
  });

  test("integrity matches items content hash", () => {
    withTmpDir((dir) => {
      const outputPath = join(dir, "bundle.json");
      setupRegistry(dir, []);
      const result = createBundler({ rootDir: dir, outputPath })();
      const expectedHash = "sha256-" + createHash("sha256").update(JSON.stringify({ items: result.items })).digest("hex");
      assert.equal(result.integrity, expectedHash);
    });
  });

  test("throws on missing registry.json", () => {
    withTmpDir((dir) => {
      const outputPath = join(dir, "bundle.json");
      assert.throws(() => createBundler({ rootDir: dir, outputPath })(), /registry\.json not found/);
    });
  });

  test("throws on duplicate item names", () => {
    withTmpDir((dir) => {
      setupRegistry(dir, [makeItem("btn"), makeItem("btn")]);
      assert.throws(() => createBundler({ rootDir: dir, outputPath: join(dir, "b.json") })(), /Duplicate/);
    });
  });

  test("throws on missing file reference", () => {
    withTmpDir((dir) => {
      setupRegistry(dir, [makeItem("btn", [{ path: "registry/ui/btn/btn.tsx" }])]);
      assert.throws(() => createBundler({ rootDir: dir, outputPath: join(dir, "b.json") })(), /File not found/);
    });
  });

  test("detects npm imports from file content", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, "registry", "ui", "card"), { recursive: true });
      writeFileSync(
        join(dir, "registry", "ui", "card", "card.tsx"),
        `import { clsx } from "clsx";\nimport { cn } from "@/lib/utils";\nexport function Card() {}`,
      );
      setupRegistry(dir, [makeItem("card", [{ path: "registry/ui/card/card.tsx" }])]);
      const bundle = createBundler({ rootDir: dir, outputPath: join(dir, "b.json") })();
      assert.ok(bundle.items[0].dependencies.includes("clsx"));
      assert.ok(!bundle.items[0].dependencies.includes("@/lib/utils"));
    });
  });

  test("coreDeps are excluded from detected dependencies", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, "registry", "ui", "btn"), { recursive: true });
      writeFileSync(
        join(dir, "registry", "ui", "btn", "btn.tsx"),
        `import { cva } from "class-variance-authority";\nexport function Btn() {}`,
      );
      setupRegistry(dir, [makeItem("btn", [{ path: "registry/ui/btn/btn.tsx" }])]);
      const bundle = createBundler({
        rootDir: dir,
        outputPath: join(dir, "b.json"),
        coreDeps: new Set(["class-variance-authority"]),
      })();
      assert.ok(!bundle.items[0].dependencies.includes("class-variance-authority"));
    });
  });

  test("transformPath renames file paths in bundle", () => {
    withTmpDir((dir) => {
      mkdirSync(join(dir, "registry", "ui", "x"), { recursive: true });
      writeFileSync(join(dir, "registry", "ui", "x", "x.tsx"), "export function X() {}");
      setupRegistry(dir, [makeItem("x", [{ path: "registry/ui/x/x.tsx" }])]);
      const bundle = createBundler({
        rootDir: dir,
        outputPath: join(dir, "b.json"),
        transformPath: (p) => p.replace("registry/ui/", "components/"),
      })();
      assert.equal(bundle.items[0].files[0].path, "components/x/x.tsx");
    });
  });
});
