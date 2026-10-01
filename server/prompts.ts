import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import type { RoleStore } from "../shared/roles.ts";
import { readBindings, readRolePrompt } from "./configuration.ts";

type AgentSessionConfig = PluginBeforeRequests["agent.create"]["config"];

export async function applyRolePrompt(
  config: AgentSessionConfig,
  bindingsPath: string,
  signal?: AbortSignal,
): Promise<{ config: AgentSessionConfig; promptPath: string } | undefined> {
  const bindings = await readBindings(bindingsPath, signal);
  if (!Object.hasOwn(bindings, config.provider)) {
    return undefined;
  }

  const prompt = await readRolePrompt(
    bindingsPath,
    config.provider,
    bindings[config.provider]!,
    signal,
  );
  const existing = config.systemPrompt;
  const systemPrompt = existing?.trim()
    ? `${existing}\n\n${prompt.text}`
    : prompt.text;

  return {
    config: { ...config, systemPrompt },
    promptPath: prompt.path,
  };
}

export function applySavedRole(config: AgentSessionConfig, store: RoleStore): AgentSessionConfig | undefined {
  const role = store.roles.find((entry) => entry.alias.id === config.provider);
  if (!role || role.removed || !role.enabled) return undefined;
  const existing = config.systemPrompt;
  return {
    ...config,
    systemPrompt: existing?.trim() ? existing + "\n\n" + role.instructions : role.instructions,
  };
}
