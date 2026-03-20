import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveAliasedPaths } from "../dist/config.js";

test("resolveAliasedPaths returns provided paths unchanged", () => {
  const result = resolveAliasedPaths(
    { components: "src/components/ui", hooks: "src/hooks" },
    { components: "@/components/ui", hooks: "@/hooks" },
  );
  assert.deepEqual(result, {
    components: "src/components/ui",
    hooks: "src/hooks",
  });
});

test("resolveAliasedPaths resolves missing paths from aliases", () => {
  const result = resolveAliasedPaths(
    { components: undefined, hooks: undefined },
    { components: "@/components/ui", hooks: "@/hooks" },
  );
  // Without cwd, sourceDir defaults to ".", so alias prefix @/ is stripped
  assert.equal(result.components, "components/ui");
  assert.equal(result.hooks, "hooks");
});

test("resolveAliasedPaths resolves with cwd that has tsconfig paths", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cli-core-test-"));
  try {
    // Create a tsconfig.json with a @/* path pointing to src/*
    writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./src/*"] } },
    }));
    mkdirSync(join(tmp, "src"), { recursive: true });

    const result = resolveAliasedPaths(
      { hooks: undefined, lib: "custom/lib" },
      { hooks: "@/hooks", lib: "@/lib" },
      tmp,
    );
    assert.equal(result.hooks, "src/hooks");
    assert.equal(result.lib, "custom/lib"); // provided path kept
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("resolveAliasedPaths handles empty map", () => {
  const result = resolveAliasedPaths({}, {});
  assert.deepEqual(result, {});
});

test("resolveAliasedPaths handles mix of provided and missing paths", () => {
  const result = resolveAliasedPaths(
    { components: "my/components", hooks: undefined, lib: undefined },
    { components: "@/components/ui", hooks: "@/hooks", lib: "@/lib" },
  );
  assert.equal(result.components, "my/components");
  assert.equal(result.hooks, "hooks");
  assert.equal(result.lib, "lib");
});
