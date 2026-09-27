import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("public content accepts traceable references to earlier integrated weekly reports", async () => {
  const result = await execFileAsync(process.execPath, [resolve(rootDirectory, "scripts", "validate-content.mjs")], {
    cwd: rootDirectory,
    windowsHide: true
  });

  assert.match(result.stdout, /Validated \d+ published issues/u);
  assert.doesNotMatch(result.stderr, /unknown published prior report/u);
});
