import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runRemoveWorkflow, findOrphanedNpmDeps } from "../dist/workflows/remove.js";
import { createTmp, withSilentAsync } from "./helpers.js";

test("findOrphanedNpmDeps", async (t) => {
  const allItems = [
    { name: "button", deps: ["clsx", "cva"] },
    { name: "card", deps: ["clsx"] },
    { name: "dialog", deps: ["@radix-ui/dialog"] },
  ];

  await t.test("finds deps used only by removed items", () => {
    const orphaned = findOrphanedNpmDeps({
      removedNames: ["dialog"],
      getAllItems: () => allItems,
      getItemName: (i) => i.name,
      getItemDeps: (i) => i.deps,
      isInstalled: (i) => i.name !== "dialog",
    });
    assert.deepEqual(orphaned, ["@radix-ui/dialog"]);
  });

  await t.test("keeps deps still used by other installed items", () => {
    const orphaned = findOrphanedNpmDeps({
      removedNames: ["button"],
      getAllItems: () => allItems,
      getItemName: (i) => i.name,
      getItemDeps: (i) => i.deps,
      isInstalled: (i) => i.name === "card",
    });
    // clsx is still used by card, cva is orphaned
    assert.deepEqual(orphaned, ["cva"]);
  });

  await t.test("returns empty when no deps become orphaned", () => {
    const orphaned = findOrphanedNpmDeps({
      removedNames: ["card"],
      getAllItems: () => allItems,
      getItemName: (i) => i.name,
      getItemDeps: (i) => i.deps,
      isInstalled: (i) => i.name === "button",
    });
    // clsx is still used by button
    assert.deepEqual(orphaned, []);
  });
});

test("runRemoveWorkflow", async (t) => {
  await t.test("removes files and calls updateManifest", async () => {
    const tmp = createTmp();
    await withSilentAsync(async () => {
      try {
        mkdirSync(join(tmp, "components"), { recursive: true });
        writeFileSync(join(tmp, "components", "button.tsx"), "content");

        let manifestUpdated = false;
        await runRemoveWorkflow({
          cwd: tmp,
          names: ["button"],
          yes: true,
          dryRun: false,
          itemPlural: "components",
          requireConfig: () => ({}),
          validateNames: () => {},
          getAllItems: () => [{ name: "button" }],
          getItemOrThrow: () => ({ name: "button" }),
          getItemName: (i) => i.name,
          isInstalled: () => false,
          resolveFilesForItem: () => [{ absolutePath: join(tmp, "components", "button.tsx") }],
          resolveAllowedBaseDirs: () => [tmp],
          updateManifest: () => { manifestUpdated = true; },
        });

        assert.equal(existsSync(join(tmp, "components", "button.tsx")), false);
        assert.equal(manifestUpdated, true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  await t.test("dry run does not remove files", async () => {
    const tmp = createTmp();
    await withSilentAsync(async () => {
      try {
        mkdirSync(join(tmp, "components"), { recursive: true });
        writeFileSync(join(tmp, "components", "button.tsx"), "content");

        await runRemoveWorkflow({
          cwd: tmp,
          names: ["button"],
          yes: true,
          dryRun: true,
          itemPlural: "components",
          requireConfig: () => ({}),
          validateNames: () => {},
          getAllItems: () => [{ name: "button" }],
          getItemOrThrow: () => ({ name: "button" }),
          getItemName: (i) => i.name,
          isInstalled: () => false,
          resolveFilesForItem: () => [{ absolutePath: join(tmp, "components", "button.tsx") }],
          resolveAllowedBaseDirs: () => [tmp],
          updateManifest: () => {},
        });

        assert.equal(existsSync(join(tmp, "components", "button.tsx")), true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  await t.test("reports nothing when no files found", async () => {
    const tmp = createTmp();
    await withSilentAsync(async () => {
      try {
        await runRemoveWorkflow({
          cwd: tmp,
          names: ["button"],
          yes: true,
          dryRun: false,
          itemPlural: "components",
          requireConfig: () => ({}),
          validateNames: () => {},
          getAllItems: () => [{ name: "button" }],
          getItemOrThrow: () => ({ name: "button" }),
          getItemName: (i) => i.name,
          isInstalled: () => false,
          resolveFilesForItem: () => [{ absolutePath: join(tmp, "nonexistent.tsx") }],
          resolveAllowedBaseDirs: () => [tmp],
          updateManifest: () => {},
        });
        // Should not throw
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
