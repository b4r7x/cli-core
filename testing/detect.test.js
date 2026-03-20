import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { detectPackageManager, detectSourceDir, readPackageJson } from "../dist/detect.js";

function createTmp() {
  return mkdtempSync(join(tmpdir(), "cli-core-detect-"));
}

test("readPackageJson", async (t) => {
  await t.test("reads valid package.json", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "test" }));
      const pkg = readPackageJson(tmp);
      assert.equal(pkg?.name, "test");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns null when missing", () => {
    const tmp = createTmp();
    try {
      assert.equal(readPackageJson(tmp), null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test("detectPackageManager", async (t) => {
  await t.test("detects from packageManager field", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
      assert.equal(detectPackageManager(tmp), "pnpm");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("detects from lockfile", () => {
    const tmp = createTmp();
    const savedAgent = process.env.npm_config_user_agent;
    try {
      delete process.env.npm_config_user_agent;
      writeFileSync(join(tmp, "yarn.lock"), "");
      assert.equal(detectPackageManager(tmp), "yarn");
    } finally {
      if (savedAgent !== undefined) process.env.npm_config_user_agent = savedAgent;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("defaults to npm when no signals", () => {
    const tmp = createTmp();
    const savedAgent = process.env.npm_config_user_agent;
    try {
      delete process.env.npm_config_user_agent;
      assert.equal(detectPackageManager(tmp), "npm");
    } finally {
      if (savedAgent !== undefined) process.env.npm_config_user_agent = savedAgent;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("accepts pre-loaded pkg parameter", () => {
    assert.equal(detectPackageManager("/any", { packageManager: "yarn@4.0.0" }), "yarn");
  });
});

test("detectSourceDir", async (t) => {
  await t.test("returns 'src' from tsconfig @/* paths", () => {
    const tmp = createTmp();
    try {
      writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
      }));
      assert.equal(detectSourceDir(tmp), "src");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns 'src' when src directory exists", () => {
    const tmp = createTmp();
    try {
      mkdirSync(join(tmp, "src"));
      assert.equal(detectSourceDir(tmp), "src");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  await t.test("returns '.' when no src or tsconfig", () => {
    const tmp = createTmp();
    try {
      assert.equal(detectSourceDir(tmp), ".");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
