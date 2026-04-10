import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSilent } from "../dist/logger.js";

export function createTmp(suffix = "test") {
  return mkdtempSync(join(tmpdir(), `cli-core-${suffix}-`));
}

export function withSilent(fn) {
  setSilent(true);
  try {
    return fn();
  } finally {
    setSilent(false);
  }
}

// Async version
export async function withSilentAsync(fn) {
  setSilent(true);
  try {
    return await fn();
  } finally {
    setSilent(false);
  }
}
