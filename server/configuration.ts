import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type Bindings = Record<string, string>;

export function defaultBindingsPath(): string {
  const paseoHome = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return resolve(paseoHome, "agent-system-prompt", "bindings.json");
}

async function readText(
  filePath: string,
  description: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    return await readFile(filePath, { encoding: "utf8", signal });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `[agent-system-prompt] Cannot read ${description} at ${filePath}: ${detail}`,
      { cause },
    );
  }
}

export async function readBindings(
  bindingsPath: string,
  signal?: AbortSignal,
): Promise<Bindings> {
  const source = await readText(bindingsPath, "bindings", signal);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    throw new Error(
      `[agent-system-prompt] Invalid JSON in ${bindingsPath}.`,
      { cause },
    );
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `[agent-system-prompt] ${bindingsPath} must map provider aliases to prompt file paths.`,
    );
  }

  for (const [provider, promptPath] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9-]*$/.test(provider)) {
      throw new Error(
        `[agent-system-prompt] Invalid provider alias "${provider}" in ${bindingsPath}.`,
      );
    }
    if (typeof promptPath !== "string" || !promptPath.trim()) {
      throw new Error(
        `[agent-system-prompt] Provider "${provider}" needs a non-empty prompt file path in ${bindingsPath}.`,
      );
    }
  }

  return value as Bindings;
}

export async function readRolePrompt(
  bindingsPath: string,
  provider: string,
  configuredPath: string,
  signal?: AbortSignal,
): Promise<{ text: string; path: string }> {
  const promptPath = resolve(dirname(bindingsPath), configuredPath);
  const text = (
    await readText(promptPath, `prompt for "${provider}"`, signal)
  ).trim();
  if (!text) {
    throw new Error(
      `[agent-system-prompt] Prompt for "${provider}" is empty: ${promptPath}.`,
    );
  }

  return { text, path: promptPath };
}

export async function importBindings(bindingsPath = defaultBindingsPath()) {
  if (!isAbsolute(bindingsPath)) throw new Error("Use an absolute bindings file path on the daemon host, or leave it blank for the default.");
  const bindings = await readBindings(bindingsPath);
  return Promise.all(Object.entries(bindings).map(async ([alias, configuredPath]) => {
    const path = resolve(dirname(bindingsPath), configuredPath);
    const instructions = await readText(path, `prompt for "${alias}"`);
    if (!instructions.trim()) throw new Error(`Prompt for "${alias}" is empty: ${path}.`);
    const heading = instructions.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return {
      name: heading || alias.replaceAll("-", " "),
      instructions,
      enabled: true,
      removed: false,
      suggestedAlias: alias,
    };
  }));
}
