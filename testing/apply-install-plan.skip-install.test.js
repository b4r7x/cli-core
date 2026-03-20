import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { setSilent } from "../dist/logger.js";
import { applyInstallPlan } from "../dist/workflows/apply-install-plan.js";

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function setEnvVar(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "cli-core-apply-install-plan-"));
  const binDir = join(root, "bin");
  const markerPath = join(root, "npm-args.txt");
  const projectDir = join(root, "project");
  const targetPath = join(projectDir, "src", "generated.txt");

  mkdirSync(binDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, "package.json"), JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    packageManager: "npm@10.0.0",
  }, null, 2));

  const fakeNpmPath = join(binDir, "npm");
  writeFileSync(
    fakeNpmPath,
    `#!/bin/sh
printf '%s\\n' "$@" > ${quoteShell(markerPath)}
exit 0
`,
  );
  chmodSync(fakeNpmPath, 0o755);

  return {
    root,
    markerPath,
    targetPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
    async runApplyInstallPlan({ skipInstall = false, cliSkipInstallEnv, missingDeps = ["left-pad"], onApplied } = {}) {
      const original = {
        PATH: process.env.PATH,
        CLI_SKIP_INSTALL: process.env.CLI_SKIP_INSTALL,
        npm_config_user_agent: process.env.npm_config_user_agent,
      };

      try {
        setSilent(true);
        process.env.PATH = `${binDir}${process.env.PATH ? `:${process.env.PATH}` : ""}`;
        setEnvVar("CLI_SKIP_INSTALL", cliSkipInstallEnv);
        setEnvVar("npm_config_user_agent", "");

        await applyInstallPlan({
          cwd: projectDir,
          yes: true,
          dryRun: false,
          overwrite: false,
          skipInstall,
          confirmMessage: "unused",
          headingMessage: "Applying fixture plan",
          fileOps: [{
            targetPath,
            content: "generated content\n",
            relativePath: "src/generated.txt",
            installDir: ".",
          }],
          missingDeps,
          onApplied,
        });
      } finally {
        setSilent(false);
        setEnvVar("PATH", original.PATH);
        setEnvVar("CLI_SKIP_INSTALL", original.CLI_SKIP_INSTALL);
        setEnvVar("npm_config_user_agent", original.npm_config_user_agent);
      }
    },
  };
}

test("applyInstallPlan skip-install behavior", async (t) => {
  await t.test("skips dependency installation when skipInstall=true", async () => {
    const harness = createHarness();
    let onAppliedCalls = 0;

    try {
      await harness.runApplyInstallPlan({
        skipInstall: true,
        onApplied() {
          onAppliedCalls += 1;
        },
      });

      assert.equal(readFileSync(harness.targetPath, "utf8"), "generated content\n");
      assert.equal(existsSync(harness.markerPath), false);
      assert.equal(onAppliedCalls, 1);
    } finally {
      harness.cleanup();
    }
  });

  await t.test("skips dependency installation when CLI_SKIP_INSTALL is truthy", async () => {
    const harness = createHarness();

    try {
      await harness.runApplyInstallPlan({
        cliSkipInstallEnv: "true",
      });

      assert.equal(readFileSync(harness.targetPath, "utf8"), "generated content\n");
      assert.equal(existsSync(harness.markerPath), false);
    } finally {
      harness.cleanup();
    }
  });

  await t.test("installs dependencies when no skip flags are set", async () => {
    const harness = createHarness();

    try {
      await harness.runApplyInstallPlan();

      assert.equal(readFileSync(harness.targetPath, "utf8"), "generated content\n");
      assert.equal(existsSync(harness.markerPath), true);
      assert.equal(readFileSync(harness.markerPath, "utf8"), "install\nleft-pad\n");
    } finally {
      harness.cleanup();
    }
  });
});
