import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableNativeExitCode } from "../scripts/lib/process-retry.mjs";

test("retries Windows access-violation and fast-fail renderer exits", () => {
  assert.equal(isRetryableNativeExitCode(0xC0000005, "win32"), true);
  assert.equal(isRetryableNativeExitCode(0xC0000409, "win32"), true);
});

test("does not retry ordinary script failures or non-Windows exits", () => {
  assert.equal(isRetryableNativeExitCode(1, "win32"), false);
  assert.equal(isRetryableNativeExitCode(0xC0000409, "linux"), false);
});
