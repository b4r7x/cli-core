import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { depName, normalizeVersionSpec, getInstalledDeps } from "../dist/package-manager.js";
import { setSilent } from "../dist/logger.js";

test("depName", async (t) => {
  await t.test("returns name without version spec", () => {
    assert.equal(depName("lodash"), "lodash");
  });

  await t.test("strips version from unscoped package", () => {
    assert.equal(depName("lodash@4.17.21"), "lodash");
  });

  await t.test("strips version from scoped package", () => {
    assert.equal(depName("@types/node@22.0.0"), "@types/node");
  });

  await t.test("handles scoped package without version", () => {
    assert.equal(depName("@types/node"), "@types/node");
  });
});

test("normalizeVersionSpec", async (t) => {
  await t.test("returns 'latest' for undefined", () => {
    assert.equal(normalizeVersionSpec(undefined), "latest");
  });

  await t.test("returns trimmed version", () => {
    assert.equal(normalizeVersionSpec("  ^1.0.0  "), "^1.0.0");
  });

  await t.test("throws on empty string", () => {
    assert.throws(() => normalizeVersionSpec(""), /cannot be empty/);
  });

  await t.test("throws on version starting with dash", () => {
    assert.throws(() => normalizeVersionSpec("-bad"), /Invalid/);
  });

  await t.test("throws on invalid characters", () => {
    assert.throws(() => normalizeVersionSpec("1.0.0; rm -rf"), /Invalid/);
  });

  await t.test("accepts valid semver ranges", () => {
    assert.equal(normalizeVersionSpec("^1.0.0"), "^1.0.0");
    assert.equal(normalizeVersionSpec("~2.3.4"), "~2.3.4");
    assert.equal(normalizeVersionSpec("latest"), "latest");
  });
});

test("getInstalledDeps", async (t) => {
  await t.test("collects deps from all sections", () => {
    setSilent(true);
    const tmp = mkdtempSync(join(tmpdir(), "cli-core-pm-"));
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({
        dependencies: { lodash: "^4.0.0" },
        devDependencies: { vitest: "^1.0.0" },
        peerDependencies: { react: "^19.0.0" },
      }));
      const deps = getInstalledDeps(tmp);
      assert.ok(deps.has("lodash"));
      assert.ok(deps.has("vitest"));
      assert.ok(deps.has("react"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("returns empty set when package.json missing", () => {
    setSilent(true);
    const tmp = mkdtempSync(join(tmpdir(), "cli-core-pm-"));
    try {
      const deps = getInstalledDeps(tmp);
      assert.equal(deps.size, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });
});
