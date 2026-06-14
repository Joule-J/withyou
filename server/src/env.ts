import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ENV_FILE_NAMES = [".env.local", ".env"];

export function loadEnvironmentFiles(): void {
  for (const filePath of resolveEnvPaths()) {
    if (!existsSync(filePath)) continue;
    const contents = readFileSync(filePath, "utf8");
    applyEnvFile(contents);
  }
}

function resolveEnvPaths(): string[] {
  const cwd = process.cwd();
  const roots = [cwd, path.resolve(cwd, "..")];
  return roots.flatMap((root) => ENV_FILE_NAMES.map((name) => path.join(root, name)));
}

function applyEnvFile(contents: string): void {
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || key in process.env) continue;

    process.env[key] = stripQuotes(line.slice(separatorIndex + 1).trim());
  }
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
