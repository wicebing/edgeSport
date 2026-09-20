import { access, readdir } from "node:fs/promises";
import { delimiter, extname, resolve } from "node:path";

export async function findCodexCommand(options = {}) {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const homeDirectory = options.homeDirectory ?? environment.USERPROFILE ?? environment.HOME ?? "";

  const override = String(environment.EDGE_SPORT_CODEX_PATH ?? "").trim();
  if (override && await fileExists(override)) {
    return commandForFile(override, nodeExecutable, "EDGE_SPORT_CODEX_PATH");
  }

  const pathDirectories = String(environment.PATH ?? "").split(delimiter).filter(Boolean);
  const executableNames = platform === "win32" ? ["codex.exe"] : ["codex"];
  for (const directory of pathDirectories) {
    for (const name of executableNames) {
      const candidate = resolve(directory, name);
      if (await fileExists(candidate)) return commandForFile(candidate, nodeExecutable, "PATH");
    }
  }

  if (platform !== "win32") return null;

  const npmLoaders = unique([
    environment.APPDATA ? resolve(environment.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js") : null,
    environment.NVM_SYMLINK ? resolve(environment.NVM_SYMLINK, "node_modules", "@openai", "codex", "bin", "codex.js") : null,
    environment.npm_config_prefix ? resolve(environment.npm_config_prefix, "node_modules", "@openai", "codex", "bin", "codex.js") : null,
    ...pathDirectories.map((directory) => resolve(directory, "node_modules", "@openai", "codex", "bin", "codex.js"))
  ]);
  for (const loader of npmLoaders) {
    if (await fileExists(loader)) return commandForFile(loader, nodeExecutable, "global npm package");
  }

  const extensionRoots = homeDirectory ? [
    resolve(homeDirectory, ".vscode", "extensions"),
    resolve(homeDirectory, ".vscode-insiders", "extensions"),
    resolve(homeDirectory, ".cursor", "extensions")
  ] : [];
  for (const extensionRoot of extensionRoots) {
    const executable = await findOpenAiExtensionExecutable(extensionRoot, architecture);
    if (executable) return commandForFile(executable, nodeExecutable, "OpenAI editor extension");
  }

  return null;
}

function commandForFile(path, nodeExecutable, source) {
  return extname(path).toLocaleLowerCase("en") === ".js"
    ? { executable: nodeExecutable, prefixArguments: [path], source }
    : { executable: path, prefixArguments: [], source };
}

async function findOpenAiExtensionExecutable(extensionRoot, architecture) {
  let entries;
  try {
    entries = await readdir(extensionRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const extensionDirectories = entries
    .filter((entry) => entry.isDirectory() && /^openai\.chatgpt-/iu.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  const architectureDirectories = architecture === "arm64"
    ? ["windows-arm64", "windows-x86_64"]
    : ["windows-x86_64", "windows-arm64"];

  for (const extensionDirectory of extensionDirectories) {
    for (const architectureDirectory of architectureDirectories) {
      const candidate = resolve(extensionRoot, extensionDirectory, "bin", architectureDirectory, "codex.exe");
      if (await fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
