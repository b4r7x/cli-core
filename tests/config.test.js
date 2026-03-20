import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { loadJsonConfig, writeJsonConfig, aliasToFsPath } from "../dist/config.js";

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cli-core-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("loadJsonConfig", () => {
  test("returns ok:true with valid config", () => {
    withTmpDir((dir) => {
      const schema = z.object({ name: z.string() });
      writeFileSync(join(dir, "test.json"), JSON.stringify({ name: "hello" }));
      const result = loadJsonConfig("test.json", schema, dir);
      assert.equal(result.ok, true);
      assert.deepEqual(result.config, { name: "hello" });
    });
  });

  test("returns not_found when file is missing", () => {
    withTmpDir((dir) => {
      const schema = z.object({ name: z.string() });
      const result = loadJsonConfig("missing.json", schema, dir);
      assert.equal(result.ok, false);
      assert.equal(result.error, "not_found");
    });
  });

  test("returns parse_error for invalid JSON", () => {
    withTmpDir((dir) => {
      const schema = z.object({ name: z.string() });
      writeFileSync(join(dir, "bad.json"), "{ not valid json }");
      const result = loadJsonConfig("bad.json", schema, dir);
      assert.equal(result.ok, false);
      assert.equal(result.error, "parse_error");
    });
  });

  test("returns validation_error when schema fails", () => {
    withTmpDir((dir) => {
      const schema = z.object({ name: z.string() });
      writeFileSync(join(dir, "cfg.json"), JSON.stringify({ name: 42 }));
      const result = loadJsonConfig("cfg.json", schema, dir);
      assert.equal(result.ok, false);
      assert.equal(result.error, "validation_error");
      assert.ok(result.message?.includes("cfg.json"));
    });
  });

  test("resolves config path relative to cwd", () => {
    withTmpDir((dir) => {
      const schema = z.object({ v: z.number() });
      writeFileSync(join(dir, "c.json"), JSON.stringify({ v: 7 }));
      const result = loadJsonConfig("c.json", schema, dir);
      assert.equal(result.ok, true);
      assert.equal(result.config?.v, 7);
    });
  });
});

describe("writeJsonConfig", () => {
  test("writes JSON to file with trailing newline", () => {
    withTmpDir((dir) => {
      writeJsonConfig("out.json", { x: 1 }, dir);
      const content = readFileSync(join(dir, "out.json"), "utf-8");
      assert.deepEqual(JSON.parse(content), { x: 1 });
      assert.ok(content.endsWith("\n"));
    });
  });

  test("overwrites existing file atomically", () => {
    withTmpDir((dir) => {
      writeJsonConfig("out.json", { x: 1 }, dir);
      writeJsonConfig("out.json", { x: 2 }, dir);
      const content = readFileSync(join(dir, "out.json"), "utf-8");
      assert.equal(JSON.parse(content).x, 2);
    });
  });

  test("round-trips through loadJsonConfig", () => {
    withTmpDir((dir) => {
      const schema = z.object({ key: z.string() });
      writeJsonConfig("cfg.json", { key: "value" }, dir);
      const result = loadJsonConfig("cfg.json", schema, dir);
      assert.equal(result.ok, true);
      assert.equal(result.config?.key, "value");
    });
  });
});

describe("aliasToFsPath", () => {
  test("strips @/ prefix with no sourceDir", () => {
    assert.equal(aliasToFsPath("@/components/button"), "components/button");
  });

  test("strips @/ prefix and prepends sourceDir", () => {
    assert.equal(aliasToFsPath("@/components/button", "src"), "src/components/button");
  });

  test("leaves non-alias paths unchanged", () => {
    assert.equal(aliasToFsPath("components/button"), "components/button");
  });

  test("ignores sourceDir when it is '.'", () => {
    assert.equal(aliasToFsPath("@/foo", "."), "foo");
  });
});
