import assert from "node:assert/strict";
import test from "node:test";

// isTruthyFlag is not exported but is tested via applyInstallPlan behavior
// in apply-install-plan.skip-install.test.js.
// This file tests the applyInstallPlan dry-run and confirmation logic.

import { applyInstallPlan } from "../dist/workflows/apply-install-plan.js";
import { withSilentAsync } from "./helpers.js";

test("applyInstallPlan dry-run mode", async (t) => {
  await t.test("calls onDryRun and does not write files", async () => {
    await withSilentAsync(async () => {
      let dryRunCalled = false;
      let appliedCalled = false;

      await applyInstallPlan({
        cwd: "/tmp",
        yes: true,
        dryRun: true,
        overwrite: false,
        confirmMessage: "Proceed?",
        headingMessage: "Adding...",
        fileOps: [],
        missingDeps: [],
        onDryRun: () => { dryRunCalled = true; },
        onApplied: async () => { appliedCalled = true; },
      });

      assert.equal(dryRunCalled, true);
      assert.equal(appliedCalled, false);
    });
  });
});
