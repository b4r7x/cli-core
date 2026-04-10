import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runInitWorkflow } from "../dist/workflows/init.js";
import { createTmp, withSilentAsync } from "./helpers.js";

test("runInitWorkflow", async (t) => {
  await t.test("throws when no package.json exists", async () => {
    const tmp = createTmp();
    await withSilentAsync(async () => {
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
      }
    });
  });

  await t.test("skips when already initialized without --force", async () => {
    const tmp = createTmp();
    await withSilentAsync(async () => {
      try {
        writeFileSync(join(tmp, "package.json"), "{}");

        await runInitWorkflow({
          cwd: tmp,
          configFileName: "test.json",
          yes: true,
          force: false,
          loadConfig: () => ({ ok: true, config: {} }),
          detectProject: () => ({ display: [] }),
          createFiles: () => [],
          writeConfig: (dir) => { writeFileSync(join(dir, "test.json"), "{}"); },
          nextSteps: [],
        });

        assert.equal(existsSync(join(tmp, "test.json")), false);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  await t.test("proceeds with --force when already initialized", async () => {
    const tmp = createTmp();
    await withSilentAsync(async () => {
      try {
        writeFileSync(join(tmp, "package.json"), "{}");

        await runInitWorkflow({
          cwd: tmp,
          configFileName: "test.json",
          yes: true,
          force: true,
          loadConfig: () => ({ ok: true, config: {} }),
          detectProject: () => ({ display: [["Framework", "React"]] }),
          createFiles: () => [{ action: "created", path: "theme.css" }],
          writeConfig: (dir) => { writeFileSync(join(dir, "test.json"), "{}"); },
          nextSteps: ["Run add command"],
        });

        assert.equal(existsSync(join(tmp, "test.json")), true);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  await t.test("throws on malformed config without --force", async () => {
    const tmp = createTmp();
    await withSilentAsync(async () => {
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
      }
    });
  });
});
