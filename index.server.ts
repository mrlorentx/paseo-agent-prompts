import type { PluginServerContext } from "@getpaseo/plugin/server";
import { roleSettings } from "./shared/roles.ts";
import { catalogRpc, prepareRpc, reconcileRpc, legacyRpc } from "./shared/rpc.ts";
import { importBindings } from "./server/configuration.ts";
import { applySavedRole } from "./server/prompts.ts";
import { createRoleService } from "./server/roles.ts";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(roleSettings);
  const service = createRoleService(() => settings.read());
  server.handle(catalogRpc, (_, { paseo }) => service.catalog(paseo));
  server.handle(prepareRpc, ({ revision, draft }, { paseo }) => service.prepare(paseo, revision, draft));
  server.handle(reconcileRpc, ({ id, revision }, { paseo }) => service.reconcile(paseo, id, revision));
  server.handle(legacyRpc, async ({ path }) => ({ roles: await importBindings(path || undefined) }));

  let warned = false;
  return server.before("agent.create", async ({ request }) => {
    const state = await settings.read();
    if (state.status !== "ready") {
      if (!warned) {
        console.error("[agent-system-prompt] Invalid role settings; instructions are not being applied. Open plugin settings to recover.");
        warned = true;
      }
      return undefined;
    }
    warned = false;
    const config = applySavedRole(request.config, state.values);
    if (!config) return undefined;
    console.info("[agent-system-prompt] Applied saved role instructions", { provider: config.provider });
    return { ...request, config };
  });
}
