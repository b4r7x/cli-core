import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runAddWorkflow } from "../dist/workflows/add.js";
import { setSilent } from "../dist/logger.js";

function createTmp() {
  return mkdtempSync(join(tmpdir(), "cli-core-add-"));
}

test("runAddWorkflow", async (t) => {
  await t.test("throws when no names given and not --all", async () => {
    setSilent(true);
    try {
      await assert.rejects(
        () => runAddWorkflow({
          cwd: "/tmp",
          requestedNames: [],
          all: false,
          yes: true,
          dryRun: false,
          overwrite: false,
          skipInstall: true,
          itemLabel: "component",
          itemPlural: "components",
          listCommand: "test list",
          emptyRequestedMessage: "No components specified.",
          requireConfig: () => ({}),
          getPublicNames: () => ["button", "card"],
          buildPlan: () => ({ resolvedNames: [], fileOps: [], missingDeps: [], headingMessage: "" }),
        }),
        /No components specified/,
      );
    } finally {
      setSilent(false);
    }
  });

  await t.test("throws when requested name not in public registry", async () => {
    setSilent(true);
    try {
      await assert.rejects(
        () => runAddWorkflow({
          cwd: "/tmp",
          requestedNames: ["nonexistent"],
          all: false,
          yes: true,
          dryRun: false,
          overwrite: false,
          skipInstall: true,
          itemLabel: "component",
          itemPlural: "components",
          listCommand: "test list",
          emptyRequestedMessage: "No components specified.",
          requireConfig: () => ({}),
          getPublicNames: () => ["button", "card"],
          buildPlan: () => ({ resolvedNames: [], fileOps: [], missingDeps: [], headingMessage: "" }),
        }),
        /not found in public/,
      );
    } finally {
      setSilent(false);
    }
  });

  await t.test("writes files in non-dry-run mode", async () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "test", packageManager: "npm@10.0.0" }));
      const targetPath = join(tmp, "components", "button.tsx");

      await runAddWorkflow({
        cwd: tmp,
        requestedNames: ["button"],
        all: false,
        yes: true,
        dryRun: false,
        overwrite: false,
        skipInstall: true,
        itemLabel: "component",
        itemPlural: "components",
        listCommand: "test list",
        emptyRequestedMessage: "No components specified.",
        requireConfig: () => ({}),
        getPublicNames: () => ["button"],
        buildPlan: () => ({
          resolvedNames: ["button"],
          fileOps: [{ targetPath, content: "export const Button = () => {};", relativePath: "button.tsx", installDir: join(tmp, "components") }],
          missingDeps: [],
          headingMessage: "Adding components...",
        }),
      });

      assert.equal(readFileSync(targetPath, "utf-8"), "export const Button = () => {};");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("--all uses public names", async () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "test", packageManager: "npm@10.0.0" }));
      let receivedNames = [];

      await runAddWorkflow({
        cwd: tmp,
        requestedNames: [],
        all: true,
        yes: true,
        dryRun: true,
        overwrite: false,
        skipInstall: true,
        itemLabel: "component",
        itemPlural: "components",
        listCommand: "test list",
        emptyRequestedMessage: "No components specified.",
        requireConfig: () => ({}),
        getPublicNames: () => ["button", "card"],
        buildPlan: ({ names }) => {
          receivedNames = names;
          return { resolvedNames: names, fileOps: [], missingDeps: [], headingMessage: "Adding..." };
        },
      });

      assert.deepEqual(receivedNames, ["button", "card"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("throws on conflicting file ops", async () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "test" }));
      const targetPath = join(tmp, "conflict.tsx");

      await assert.rejects(
        () => runAddWorkflow({
          cwd: tmp,
          requestedNames: ["button"],
          all: false,
          yes: true,
          dryRun: false,
          overwrite: false,
          skipInstall: true,
          itemLabel: "component",
          itemPlural: "components",
          listCommand: "test list",
          emptyRequestedMessage: "No components specified.",
          requireConfig: () => ({}),
          getPublicNames: () => ["button"],
          buildPlan: () => ({
            resolvedNames: ["button"],
            fileOps: [
              { targetPath, content: "version A", relativePath: "conflict.tsx", installDir: tmp },
              { targetPath, content: "version B", relativePath: "conflict.tsx", installDir: tmp },
            ],
            missingDeps: [],
            headingMessage: "Adding...",
          }),
        }),
        /Conflicting writes/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });
});
