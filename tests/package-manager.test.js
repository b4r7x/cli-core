import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectPackageManager } from "../dist/detect.js";

function withTmpDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cli-core-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("detectPackageManager", () => {
  const originalEnv = process.env.npm_config_user_agent;

  test("detects pnpm from packageManager field", () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
      assert.equal(detectPackageManager(dir), "pnpm");
    });
  });

  test("detects yarn from packageManager field", () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "yarn@4.0.0" }));
      assert.equal(detectPackageManager(dir), "yarn");
    });
  });

  test("detects bun from packageManager field", () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "bun@1.0.0" }));
      assert.equal(detectPackageManager(dir), "bun");
    });
  });

  test("detects pnpm from pnpm-lock.yaml lockfile", () => {
    delete process.env.npm_config_user_agent;
    try {
      withTmpDir((dir) => {
        writeFileSync(join(dir, "pnpm-lock.yaml"), "");
        assert.equal(detectPackageManager(dir), "pnpm");
      });
    } finally {
      process.env.npm_config_user_agent = originalEnv;
    }
  });

  test("detects yarn from yarn.lock lockfile", () => {
    delete process.env.npm_config_user_agent;
    try {
      withTmpDir((dir) => {
        writeFileSync(join(dir, "yarn.lock"), "");
        assert.equal(detectPackageManager(dir), "yarn");
      });
    } finally {
      process.env.npm_config_user_agent = originalEnv;
    }
  });

  test("detects npm from package-lock.json lockfile", () => {
    delete process.env.npm_config_user_agent;
    try {
      withTmpDir((dir) => {
        writeFileSync(join(dir, "package-lock.json"), "{}");
        assert.equal(detectPackageManager(dir), "npm");
      });
    } finally {
      process.env.npm_config_user_agent = originalEnv;
    }
  });

  test("defaults to npm when no signals present", () => {
    delete process.env.npm_config_user_agent;
    try {
      withTmpDir((dir) => {
        assert.equal(detectPackageManager(dir), "npm");
      });
    } finally {
      process.env.npm_config_user_agent = originalEnv;
    }
  });

  test("prefers packageManager field over lockfile", () => {
    withTmpDir((dir) => {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@9.0.0" }));
      writeFileSync(join(dir, "yarn.lock"), "");
      assert.equal(detectPackageManager(dir), "pnpm");
    });
  });

  test("accepts pre-loaded pkg as second argument", () => {
    withTmpDir((dir) => {
      const pkg = { packageManager: "bun@1.2.0" };
      assert.equal(detectPackageManager(dir, pkg), "bun");
    });
  });
});
