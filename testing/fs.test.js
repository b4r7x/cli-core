import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureWithinDir, ensureWithinAnyDir, readTsConfigPaths, writeFileSafe, copyGeneratedDir, cleanEmptyDirs } from "../dist/fs.js";

function createTmp() {
  return mkdtempSync(join(tmpdir(), "cli-core-fs-"));
}

test("ensureWithinDir", async (t) => {
  await t.test("allows paths within base dir", () => {
    assert.doesNotThrow(() => ensureWithinDir("/base/sub/file.ts", "/base"));
  });

  await t.test("throws on path traversal", () => {
    assert.throws(() => ensureWithinDir("/base/../outside/file.ts", "/base"), /Path traversal/);
  });

  await t.test("throws on absolute escape", () => {
    assert.throws(() => ensureWithinDir("/other/file.ts", "/base"), /Path traversal/);
  });
});

test("ensureWithinAnyDir", async (t) => {
  await t.test("allows path within any of the base dirs", () => {
    assert.doesNotThrow(() => ensureWithinAnyDir("/a/file.ts", ["/a", "/b"]));
  });

  await t.test("throws when path escapes all dirs", () => {
    assert.throws(() => ensureWithinAnyDir("/c/file.ts", ["/a", "/b"]), /Path traversal/);
  });
});

test("readTsConfigPaths", async (t) => {
  await t.test("reads paths from tsconfig.json", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
      }));
      const paths = readTsConfigPaths(tmp);
      assert.deepEqual(paths, { "@/*": ["./src/*"] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("reads from jsconfig.json when no tsconfig", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "jsconfig.json"), JSON.stringify({
        compilerOptions: { paths: { "~/*": ["./lib/*"] } },
      }));
      const paths = readTsConfigPaths(tmp);
      assert.deepEqual(paths, { "~/*": ["./lib/*"] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns null when no config exists", () => {
    const tmp = createTmp();
    try {
      assert.equal(readTsConfigPaths(tmp), null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("handles JSON with comments", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "tsconfig.json"), `{
        // This is a comment
        "compilerOptions": {
          /* block comment */
          "paths": { "@/*": ["./src/*"] }
        }
      }`);
      const paths = readTsConfigPaths(tmp);
      assert.deepEqual(paths, { "@/*": ["./src/*"] });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("writeFileSafe", async (t) => {
  await t.test("writes new file and returns 'written'", () => {
    const tmp = createTmp();
    try {
      const filePath = join(tmp, "new.txt");
      const result = writeFileSafe(filePath, "hello");
      assert.equal(result, "written");
      assert.equal(readFileSync(filePath, "utf-8"), "hello");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("skips existing file without overwrite", () => {
    const tmp = createTmp();
    try {
      const filePath = join(tmp, "existing.txt");
      writeFileSync(filePath, "original");
      const result = writeFileSafe(filePath, "new content");
      assert.equal(result, "skipped");
      assert.equal(readFileSync(filePath, "utf-8"), "original");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("overwrites existing file with overwrite=true", () => {
    const tmp = createTmp();
    try {
      const filePath = join(tmp, "existing.txt");
      writeFileSync(filePath, "original");
      const result = writeFileSafe(filePath, "new content", true);
      assert.equal(result, "overwritten");
      assert.equal(readFileSync(filePath, "utf-8"), "new content");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("creates parent directories", () => {
    const tmp = createTmp();
    try {
      const filePath = join(tmp, "deep", "nested", "file.txt");
      writeFileSafe(filePath, "content");
      assert.equal(readFileSync(filePath, "utf-8"), "content");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("copyGeneratedDir", async (t) => {
  await t.test("copies source to destination", () => {
    const tmp = createTmp();
    try {
      mkdirSync(join(tmp, "src/gen"), { recursive: true });
      writeFileSync(join(tmp, "src/gen/file.txt"), "hello");
      copyGeneratedDir(tmp, "src/gen", "dist/gen");
      assert.equal(readFileSync(join(tmp, "dist/gen/file.txt"), "utf-8"), "hello");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("throws when source does not exist", () => {
    const tmp = createTmp();
    try {
      assert.throws(() => copyGeneratedDir(tmp, "missing", "dist"), /not found/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("cleanEmptyDirs", async (t) => {
  await t.test("removes empty directories", () => {
    const tmp = createTmp();
    try {
      const emptyDir = join(tmp, "empty");
      mkdirSync(emptyDir);
      cleanEmptyDirs([emptyDir]);
      assert.equal(existsSync(emptyDir), false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("keeps non-empty directories", () => {
    const tmp = createTmp();
    try {
      const dir = join(tmp, "notempty");
      mkdirSync(dir);
      writeFileSync(join(dir, "file.txt"), "hi");
      cleanEmptyDirs([dir]);
      assert.equal(existsSync(dir), true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
