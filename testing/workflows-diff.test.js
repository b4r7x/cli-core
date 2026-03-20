import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runDiffWorkflow } from "../dist/workflows/diff.js";
import { setSilent } from "../dist/logger.js";

function createTmp() {
  return mkdtempSync(join(tmpdir(), "cli-core-diff-"));
}

test("runDiffWorkflow", async (t) => {
  await t.test("detects changed files", () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      mkdirSync(join(tmp, "components"), { recursive: true });
      writeFileSync(join(tmp, "components", "button.tsx"), "local content");

      const rendered = [];
      runDiffWorkflow({
        cwd: tmp,
        requestedNames: ["button"],
        itemPlural: "components",
        requireConfig: () => ({}),
        resolveDefaultNames: () => [],
        validateRequestedNames: () => {},
        resolveFilesForName: ({ name }) => [{
          itemName: name,
          relativePath: "button.tsx",
          localPath: join(tmp, "components", "button.tsx"),
          registryContent: "registry content",
        }],
        noInstalledMessage: "none",
        upToDateMessage: "up to date",
        renderChangedFile: (ctx) => rendered.push(ctx.file.itemName),
      });

      assert.equal(rendered.length, 1);
      assert.equal(rendered[0], "button");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("reports up-to-date when content matches", () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      mkdirSync(join(tmp, "components"), { recursive: true });
      writeFileSync(join(tmp, "components", "button.tsx"), "same content");

      const rendered = [];
      runDiffWorkflow({
        cwd: tmp,
        requestedNames: ["button"],
        itemPlural: "components",
        requireConfig: () => ({}),
        resolveDefaultNames: () => [],
        validateRequestedNames: () => {},
        resolveFilesForName: ({ name }) => [{
          itemName: name,
          relativePath: "button.tsx",
          localPath: join(tmp, "components", "button.tsx"),
          registryContent: "same content",
        }],
        noInstalledMessage: "none",
        upToDateMessage: "up to date",
        renderChangedFile: (ctx) => rendered.push(ctx),
      });

      assert.equal(rendered.length, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("uses default names when none requested", () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      const rendered = [];
      runDiffWorkflow({
        cwd: tmp,
        requestedNames: [],
        itemPlural: "components",
        requireConfig: () => ({}),
        resolveDefaultNames: () => [],
        validateRequestedNames: () => {},
        resolveFilesForName: () => [],
        noInstalledMessage: "nothing installed",
        upToDateMessage: "up to date",
        renderChangedFile: (ctx) => rendered.push(ctx),
      });
      // Should not throw, outputs "nothing installed"
      assert.equal(rendered.length, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });
});
