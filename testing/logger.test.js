import assert from "node:assert/strict";
import test from "node:test";

import { toErrorMessage, setSilent, isSilentMode, CancelError } from "../dist/logger.js";

test("toErrorMessage", async (t) => {
  await t.test("extracts message from Error", () => {
    assert.equal(toErrorMessage(new Error("test error")), "test error");
  });

  await t.test("stringifies non-Error values", () => {
    assert.equal(toErrorMessage("string error"), "string error");
    assert.equal(toErrorMessage(42), "42");
    assert.equal(toErrorMessage(null), "null");
  });
});

test("setSilent / isSilentMode", async (t) => {
  await t.test("toggles silent mode", () => {
    setSilent(true);
    assert.equal(isSilentMode(), true);
    setSilent(false);
    assert.equal(isSilentMode(), false);
  });
});

test("CancelError", async (t) => {
  await t.test("is an instance of Error", () => {
    const err = new CancelError();
    assert.ok(err instanceof Error);
    assert.equal(err.name, "CancelError");
    assert.equal(err.message, "Cancelled.");
  });
});
