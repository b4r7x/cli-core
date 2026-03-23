import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";

import { loadJsonConfig, writeJsonConfig, aliasToFsPath, updateManifest } from "../dist/config.js";
import { setSilent } from "../dist/logger.js";

const TestSchema = z.object({
  name: z.string(),
  version: z.number().optional(),
});

function createTmp() {
  return mkdtempSync(join(tmpdir(), "cli-core-config-"));
}

test("loadJsonConfig", async (t) => {
  await t.test("returns ok with parsed config for valid JSON", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "test.json"), JSON.stringify({ name: "foo", version: 1 }));
      const result = loadJsonConfig("test.json", TestSchema, tmp);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.config.name, "foo");
        assert.equal(result.config.version, 1);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns not_found when file does not exist", () => {
    const tmp = createTmp();
    try {
      const result = loadJsonConfig("missing.json", TestSchema, tmp);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "not_found");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns parse_error for invalid JSON", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "bad.json"), "not json{{{");
      const result = loadJsonConfig("bad.json", TestSchema, tmp);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "parse_error");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns validation_error for schema mismatch", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "bad.json"), JSON.stringify({ wrong: true }));
      const result = loadJsonConfig("bad.json", TestSchema, tmp);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error, "validation_error");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("writeJsonConfig", async (t) => {
  await t.test("writes formatted JSON atomically", () => {
    const tmp = createTmp();
    try {
      writeJsonConfig("out.json", { hello: "world" }, tmp);
      const content = readFileSync(join(tmp, "out.json"), "utf-8");
      assert.equal(content, JSON.stringify({ hello: "world" }, null, 2) + "\n");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("overwrites existing file", () => {
    const tmp = createTmp();
    try {
      writeJsonConfig("out.json", { a: 1 }, tmp);
      writeJsonConfig("out.json", { b: 2 }, tmp);
      const content = JSON.parse(readFileSync(join(tmp, "out.json"), "utf-8"));
      assert.deepEqual(content, { b: 2 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("aliasToFsPath", async (t) => {
  await t.test("strips @/ prefix without sourceDir", () => {
    assert.equal(aliasToFsPath("@/components/ui"), "components/ui");
  });

  await t.test("strips @/ and prepends sourceDir", () => {
    assert.equal(aliasToFsPath("@/hooks", "src"), "src/hooks");
  });

  await t.test("handles sourceDir of '.'", () => {
    assert.equal(aliasToFsPath("@/lib", "."), "lib");
  });
});

test("updateManifest", async (t) => {
  const ManifestSchema = z.object({
    name: z.string(),
    installed: z.record(z.string(), z.unknown()).optional(),
  });

  await t.test("adds entries to manifest", () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeJsonConfig("cfg.json", { name: "test" }, tmp);
      updateManifest({ configFileName: "cfg.json", schema: ManifestSchema, manifestKey: "installed", cwd: tmp, add: ["button", "card"] });
      const config = JSON.parse(readFileSync(join(tmp, "cfg.json"), "utf-8"));
      assert.ok(config.installed.button);
      assert.ok(config.installed.card);
      assert.ok(config.installed.button.installedAt);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("removes entries from manifest", () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeJsonConfig("cfg.json", { name: "test", installed: { button: { installedAt: "x" }, card: { installedAt: "x" } } }, tmp);
      updateManifest({ configFileName: "cfg.json", schema: ManifestSchema, manifestKey: "installed", cwd: tmp, remove: ["button"] });
      const config = JSON.parse(readFileSync(join(tmp, "cfg.json"), "utf-8"));
      assert.equal(config.installed.button, undefined);
      assert.ok(config.installed.card);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });

  await t.test("removes manifest key when all entries removed", () => {
    setSilent(true);
    const tmp = createTmp();
    try {
      writeJsonConfig("cfg.json", { name: "test", installed: { button: { installedAt: "x" } } }, tmp);
      updateManifest({ configFileName: "cfg.json", schema: ManifestSchema, manifestKey: "installed", cwd: tmp, remove: ["button"] });
      const config = JSON.parse(readFileSync(join(tmp, "cfg.json"), "utf-8"));
      assert.equal(config.installed, undefined);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      setSilent(false);
    }
  });
});
