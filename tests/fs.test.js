import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFileSafe, ensureWithinDir } from "../dist/fs.js";

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cli-core-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("writeFileSafe", () => {
  test("writes new file and returns 'written'", () => {
    withTmpDir((dir) => {
      const result = writeFileSafe(join(dir, "a.txt"), "hello");
      assert.equal(result, "written");
      assert.equal(readFileSync(join(dir, "a.txt"), "utf-8"), "hello");
    });
  });

  test("skips existing file when overwrite is false", () => {
    withTmpDir((dir) => {
      const p = join(dir, "a.txt");
      writeFileSafe(p, "original");
      const result = writeFileSafe(p, "new content", false);
      assert.equal(result, "skipped");
      assert.equal(readFileSync(p, "utf-8"), "original");
    });
  });

  test("overwrites existing file when overwrite is true", () => {
    withTmpDir((dir) => {
      const p = join(dir, "a.txt");
      writeFileSafe(p, "original");
      const result = writeFileSafe(p, "updated", true);
      assert.equal(result, "overwritten");
      assert.equal(readFileSync(p, "utf-8"), "updated");
    });
  });

  test("creates intermediate directories", () => {
    withTmpDir((dir) => {
      const p = join(dir, "nested", "deep", "file.txt");
      writeFileSafe(p, "content");
      assert.ok(existsSync(p));
    });
  });

  test("default overwrite param is false", () => {
    withTmpDir((dir) => {
      const p = join(dir, "a.txt");
      writeFileSafe(p, "original");
      const result = writeFileSafe(p, "new");
      assert.equal(result, "skipped");
    });
  });
});

describe("ensureWithinDir", () => {
  test("does not throw for path inside base dir", () => {
    withTmpDir((dir) => {
      assert.doesNotThrow(() => ensureWithinDir(join(dir, "sub", "file.txt"), dir));
    });
  });

  test("throws for path traversal via ..", () => {
    withTmpDir((dir) => {
      assert.throws(
        () => ensureWithinDir(join(dir, "..", "escape.txt"), dir),
        /Path traversal detected/,
      );
    });
  });

  test("throws when target is outside base dir", () => {
    withTmpDir((dir) => {
      assert.throws(
        () => ensureWithinDir("/etc/passwd", dir),
        /Path traversal detected/,
      );
    });
  });

  test("does not throw for path equal to base dir", () => {
    withTmpDir((dir) => {
      assert.doesNotThrow(() => ensureWithinDir(join(dir, "file"), dir));
    });
  });
});
