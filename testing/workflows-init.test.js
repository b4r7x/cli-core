import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runInitWorkflow } from "../dist/workflows/init.js";
import { setSilent } from "../dist/logger.js";

function createTmp() {
  return mkdtempSync(join(tmpdir(), "cli-core-init-"));
}

test("runInitWorkflow", async (t) => {
  await t.test("throws when no package.json exists", async () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      await assert.rejects(
        () => runInitWorkflow({
          cwd: tmp,
          configFileName: "test.json",
          yes: true,
          force: false,
          loadConfig: () => ({ ok: false, error: "not_found" }),
          detectProject: () => ({ display: [] }),
          createFiles: () => [],
          writeConfig: () => {},
          nextSteps: [],
        }),
        /package.json/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("skips when already initialized without --force", async () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), "{}");
      let writeConfigCalled = false;

      await runInitWorkflow({
        cwd: tmp,
        configFileName: "test.json",
        yes: true,
        force: false,
        loadConfig: () => ({ ok: true, config: {} }),
        detectProject: () => ({ display: [] }),
        createFiles: () => [],
        writeConfig: () => { writeConfigCalled = true; },
        nextSteps: [],
      });

      assert.equal(writeConfigCalled, false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("proceeds with --force when already initialized", async () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), "{}");
      let writeConfigCalled = false;

      await runInitWorkflow({
        cwd: tmp,
        configFileName: "test.json",
        yes: true,
        force: true,
        loadConfig: () => ({ ok: true, config: {} }),
        detectProject: () => ({ display: [["Framework", "React"]] }),
        createFiles: () => [{ action: "created", path: "theme.css" }],
        writeConfig: () => { writeConfigCalled = true; },
        nextSteps: ["Run add command"],
      });

      assert.equal(writeConfigCalled, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("throws on malformed config without --force", async () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), "{}");

      await assert.rejects(
        () => runInitWorkflow({
          cwd: tmp,
          configFileName: "test.json",
          yes: true,
          force: false,
          loadConfig: () => ({ ok: false, error: "parse_error", message: "bad JSON" }),
          detectProject: () => ({ display: [] }),
          createFiles: () => [],
          writeConfig: () => {},
          nextSteps: [],
        }),
        /malformed/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });
});
