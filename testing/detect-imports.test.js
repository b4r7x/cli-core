import assert from "node:assert/strict";
import test from "node:test";

import { detectNpmImports } from "../dist/bundler/detect-imports.js";

test("detectNpmImports", async (t) => {
  await t.test("detects regular npm imports", () => {
    const content = `import { cn } from "clsx";\nimport { cva } from "class-variance-authority";`;
    const result = detectNpmImports(content);
    assert.deepEqual(new Set(result), new Set(["clsx", "class-variance-authority"]));
  });

  await t.test("detects scoped npm imports", () => {
    const content = `import { something } from "@radix-ui/react-dialog";`;
    const result = detectNpmImports(content);
    assert.deepEqual(result, ["@radix-ui/react-dialog"]);
  });

  await t.test("skips type-only imports", () => {
    const content = `import type { FC } from "react";\nexport type { Props } from "react";`;
    const result = detectNpmImports(content);
    assert.deepEqual(result, []);
  });

  await t.test("skips aliased imports", () => {
    const content = `import { Button } from "@/components/button";\nimport { util } from "../utils";`;
    const result = detectNpmImports(content);
    assert.deepEqual(result, []);
  });

  await t.test("skips node: imports", () => {
    const content = `import { readFileSync } from "node:fs";`;
    const result = detectNpmImports(content);
    assert.deepEqual(result, []);
  });

  await t.test("skips peer deps", () => {
    const content = `import React from "react";`;
    const result = detectNpmImports(content, { peerDeps: new Set(["react"]) });
    assert.deepEqual(result, []);
  });

  await t.test("deduplicates imports", () => {
    const content = `import { a } from "clsx";\nimport { b } from "clsx";`;
    const result = detectNpmImports(content);
    assert.deepEqual(result, ["clsx"]);
  });

  await t.test("handles custom alias prefixes", () => {
    const content = `import { X } from "~app/components";\nimport { Y } from "lodash";`;
    const result = detectNpmImports(content, { aliasPrefixes: ["~app/"] });
    assert.deepEqual(result, ["lodash"]);
  });
});
