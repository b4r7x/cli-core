import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { writeFilesWithRollback, formatWriteSummary } from "../dist/add-helpers.js";
import { createTmp, withSilent } from "./helpers.js";

test("writeFilesWithRollback", async (t) => {
  await t.test("writes new files successfully", () => {
    withSilent(() => {
      const tmp = createTmp();
      try {
        const result = writeFilesWithRollback([
          { targetPath: join(tmp, "a.ts"), content: "const a = 1;", relativePath: "a.ts", installDir: tmp },
          { targetPath: join(tmp, "b.ts"), content: "const b = 2;", relativePath: "b.ts", installDir: tmp },
        ], false);

        assert.equal(result.written, 2);
        assert.equal(result.skipped, 0);
        assert.equal(readFileSync(join(tmp, "a.ts"), "utf-8"), "const a = 1;");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  await t.test("skips existing files without overwrite", () => {
    withSilent(() => {
      const tmp = createTmp();
      try {
        writeFileSync(join(tmp, "existing.ts"), "original");
        const result = writeFilesWithRollback([
          { targetPath: join(tmp, "existing.ts"), content: "new", relativePath: "existing.ts", installDir: tmp },
        ], false);

        assert.equal(result.skipped, 1);
        assert.equal(readFileSync(join(tmp, "existing.ts"), "utf-8"), "original");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  await t.test("overwrites existing files with overwrite flag", () => {
    withSilent(() => {
      const tmp = createTmp();
      try {
        writeFileSync(join(tmp, "existing.ts"), "original");
        const result = writeFilesWithRollback([
          { targetPath: join(tmp, "existing.ts"), content: "new", relativePath: "existing.ts", installDir: tmp },
        ], true);

        assert.equal(result.overwritten, 1);
        assert.equal(readFileSync(join(tmp, "existing.ts"), "utf-8"), "new");
        assert.equal(result.backups.length, 1);
        assert.equal(result.backups[0].content, "original");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  await t.test("creates parent directories", () => {
    withSilent(() => {
      const tmp = createTmp();
      try {
        writeFilesWithRollback([
          { targetPath: join(tmp, "deep", "nested", "file.ts"), content: "x", relativePath: "deep/nested/file.ts", installDir: tmp },
        ], false);

        assert.equal(readFileSync(join(tmp, "deep", "nested", "file.ts"), "utf-8"), "x");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});

test("formatWriteSummary", async (t) => {
  await t.test("formats all parts", () => {
    const result = formatWriteSummary({
      written: 2, skipped: 1, overwritten: 1,
      newFiles: [], backups: [], createdDirs: [],
    });
    assert.equal(result, "Done. 2 written, 1 skipped, 1 overwritten.");
  });

  await t.test("omits zero counts", () => {
    const result = formatWriteSummary({
      written: 3, skipped: 0, overwritten: 0,
      newFiles: [], backups: [], createdDirs: [],
    });
    assert.equal(result, "Done. 3 written.");
  });
});
