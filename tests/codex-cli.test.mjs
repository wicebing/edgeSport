import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { findCodexCommand } from "../scripts/lib/codex-cli.mjs";

test("finds Codex bundled with the OpenAI VS Code extension when PATH does not contain it", async (context) => {
  const home = await mkdtemp(resolve(tmpdir(), "edge-sport-codex-"));
  context.after(() => rm(home, { recursive: true, force: true }));
  const executable = resolve(home, ".vscode", "extensions", "openai.chatgpt-26.908.40401-win32-x64", "bin", "windows-x86_64", "codex.exe");
  await mkdir(resolve(executable, ".."), { recursive: true });
  await writeFile(executable, "test", "utf8");

  const command = await findCodexCommand({
    environment: { PATH: "" },
    platform: "win32",
    architecture: "x64",
    homeDirectory: home,
    nodeExecutable: "node.exe"
  });

  assert.equal(command?.executable, executable);
  assert.deepEqual(command?.prefixArguments, []);
  assert.equal(command?.source, "OpenAI editor extension");
});

test("prefers an explicit Codex executable override", async (context) => {
  const directory = await mkdtemp(resolve(tmpdir(), "edge-sport-codex-override-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const executable = resolve(directory, "codex.exe");
  await writeFile(executable, "test", "utf8");

  const command = await findCodexCommand({
    environment: { EDGE_SPORT_CODEX_PATH: executable, PATH: "" },
    platform: "win32",
    homeDirectory: directory
  });

  assert.equal(command?.executable, executable);
  assert.equal(command?.source, "EDGE_SPORT_CODEX_PATH");
});
