import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { PluginHandlerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { draftSchema, roleSchema, storeSchema, type Role, type RoleDraft, type Profile } from "../shared/roles.ts";

type PaseoApi = PluginHandlerContext["paseo"];
type MutableDaemonConfig = Awaited<ReturnType<PaseoApi["config"]["get"]>>["config"];
type MutableDaemonConfigPatch = Parameters<PaseoApi["config"]["patch"]>[0];

export type StoreState = PluginSettingsState<typeof storeSchema>;
type Config = Pick<MutableDaemonConfig, "providers" | "agentProfiles">;
type ProviderConfig = Config["providers"][string];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function ownProvider(config: Config, id: string): ProviderConfig | undefined {
  return Object.hasOwn(config.providers, id) ? config.providers[id] : undefined;
}
function aliasDefinition(config: Config, source: string, label: string): ProviderConfig {
  const base = ownProvider(config, source) ?? {};
  if (base.enabled === false) throw new Error("The selected provider is disabled in Paseo.");
  return { ...base, extends: typeof base.extends === "string" ? base.extends : source, label };
}
function assertAlias(role: Role, entry: ProviderConfig): void {
  if (entry.enabled === false) throw new Error("The role provider is disabled. Enable it in Paseo provider settings before launching agents.");
  if (entry.extends !== role.alias.extends) {
    throw new Error("The role provider now has a different base provider. Its configuration was preserved. Choose another alias when creating a role.");
  }
  if (role.alias.ownership === "created" && fingerprint(entry) !== role.alias.fingerprint) {
    throw new Error("The role alias collides with another provider or its options changed. Nothing was overwritten. Review advanced details and explicitly adopt its current options to continue.");
  }
}
export function requireState(state: StoreState, revision?: string) {
  if (state.status !== "ready") throw new Error("Role settings are invalid. Stored instructions have been preserved; restore a backup before saving.");
  if (revision !== undefined && state.revision !== revision) {
    throw new Error("Roles changed in another window. Reload saved roles before trying again; your draft has been kept.");
  }
  return state;
}

export function prepareRole(config: Config, state: StoreState, input: RoleDraft, uuid = randomUUID): Role {
  const draft = draftSchema.parse(input);
  const store = requireState(state).values;
  const previous = store.roles.find((role) => role.id === draft.id);
  if (previous) {
    const current = config.agentProfiles?.find((profile) => profile.id === previous.profile.id);
    const alias = ownProvider(config, previous.alias.id);
    if (draft.adoptChanges && (!alias || alias.extends !== previous.alias.extends)) {
      throw new Error("Only an existing alias with the same base provider can be adopted.");
    }
    return roleSchema.parse({
      ...previous, name: draft.name, instructions: draft.instructions, enabled: draft.enabled, removed: false,
      alias: draft.adoptChanges ? { ...previous.alias, ownership: "adopted", fingerprint: fingerprint(alias) } : previous.alias,
      profile: {
        ...previous.profile,
        // Recovery is explicit. Other profile fields are always taken fresh at patch time.
        expectedProvider: draft.relink && current ? current.provider : previous.profile.expectedProvider,
        template: current ?? previous.profile.template,
      },
    });
  }
  if (Boolean(draft.profileId) === Boolean(draft.newProfile)) {
    throw new Error("Choose an existing profile or create a new profile.");
  }
  const selected = draft.profileId
    ? config.agentProfiles?.find((profile) => profile.id === draft.profileId)
    : undefined;
  if (draft.profileId && !selected) throw new Error("That profile no longer exists. Reload the profile list.");
  if (selected && draft.profileProvider && selected.provider !== draft.profileProvider) {
    throw new Error("The selected profile provider changed while this draft was open. Refresh and select the profile again.");
  }
  const id = draft.id ?? uuid();
  const profile: Profile = selected ?? {
    ...draft.newProfile!, id: uuid(),
  };
  if (store.roles.some((role) => !role.removed && role.profile.id === profile.id)) {
    throw new Error("This profile already belongs to a role. Edit that role or choose another profile.");
  }
  const source = profile.provider;
  if (store.roles.some((role) => role.alias.id === source)) {
    throw new Error("Choose the original provider or an unmanaged profile; a role alias cannot be used as another role's base.");
  }
  const aliasId = draft.adoptAlias ?? "role-" + id;
  if (store.roles.some((role) => role.alias.id === aliasId)) {
    throw new Error("That provider is already tracked by a role, including removed roles. Restore the original role.");
  }
  const existing = ownProvider(config, aliasId);
  let definition: ProviderConfig;
  if (draft.adoptAlias) {
    if (!existing || typeof existing.extends !== "string") {
      throw new Error("Only an existing custom provider alias can be adopted. Base providers are never adopted.");
    }
    const sourceBase = ownProvider(config, source)?.extends ?? source;
    if (existing.extends !== sourceBase && aliasId !== source) {
      throw new Error("The alias and profile must use the same base provider.");
    }
    if (existing.enabled === false) throw new Error("Enable this provider in Paseo before adopting it.");
    definition = existing;
  } else {
    if (existing) throw new Error("The generated provider ID already exists. Cancel and create the role again.");
    definition = aliasDefinition(config, source, draft.name);
  }
  return roleSchema.parse({
    id, name: draft.name, instructions: draft.instructions, enabled: draft.enabled, removed: false,
    alias: {
      id: aliasId, sourceProvider: source, extends: definition.extends,
      ownership: draft.adoptAlias ? "adopted" : "created",
      fingerprint: fingerprint(definition),
      sourceFingerprint: fingerprint(ownProvider(config, source) ?? {}),
      label: draft.name,
    },
    profile: {
      id: profile.id, ownership: selected ? "adopted" : "created",
      restoreProvider: source, expectedProvider: source, template: profile,
    },
  });
}

export function planLink(config: Config, role: Role): MutableDaemonConfigPatch {
  const patch: MutableDaemonConfigPatch = {};
  const profiles = config.agentProfiles ?? [];
  const current = profiles.find((profile) => profile.id === role.profile.id);
  if (role.removed) {
    // Keep user edits and missing profiles. Never delete aliases: archived sessions
    // and schedules are not completely enumerable through the 0.10.2 plugin API.
    if (current?.provider === role.alias.id && current.provider !== role.profile.restoreProvider) {
      patch.agentProfiles = profiles.map((profile) => profile.id === current.id
        ? { ...profile, provider: role.profile.restoreProvider } : profile);
    }
    return patch;
  }
  const existing = ownProvider(config, role.alias.id);
  if (existing) assertAlias(role, existing);
  else {
    if (role.alias.ownership === "adopted") throw new Error("The adopted provider is missing. Restore it in Paseo or remove the role.");
    if (fingerprint(ownProvider(config, role.alias.sourceProvider) ?? {}) !== role.alias.sourceFingerprint) {
      throw new Error("The source provider changed before its alias could be created. Remove the pending role and create it again using the current provider.");
    }
    const definition = aliasDefinition(config, role.alias.sourceProvider, role.alias.label);
    if (fingerprint(definition) !== role.alias.fingerprint) throw new Error("The provider plan no longer matches.");
    patch.providers = { [role.alias.id]: definition };
  }
  if (!current) {
    if (role.profile.ownership === "adopted") throw new Error("The linked profile was deleted. Restore the profile or remove this role.");
    patch.agentProfiles = [...profiles, { ...role.profile.template, provider: role.alias.id }];
  } else if (current.provider !== role.alias.id) {
    if (current.provider !== role.profile.expectedProvider) {
      throw new Error("The profile provider changed elsewhere. Edit the role and select Restore profile link to explicitly relink it. Its other settings will be preserved.");
    }
    patch.agentProfiles = profiles.map((profile) => profile.id === current.id
      ? { ...profile, provider: role.alias.id } : profile);
  }
  return patch;
}

export function linkStatus(config: Config, role: Role): { id: string; linked: boolean; detail: string } {
  try {
    const pending = Object.keys(planLink(config, role)).length > 0;
    return {
      id: role.id, linked: !pending,
      detail: pending ? "Instructions saved; profile linking needs to finish."
        : role.removed ? "Removed. Provider retained for existing sessions and schedules."
        : role.enabled ? "Ready for new agents." : "Disabled. New agents receive no role instructions.",
    };
  } catch (error) {
    return { id: role.id, linked: false, detail: error instanceof Error ? error.message : "Profile linking failed." };
  }
}

export function createRoleService(read: () => Promise<StoreState>) {
  let tail = Promise.resolve();
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => {}, () => {});
    return result;
  }
  return {
    async prepare(paseo: PaseoApi, revision: string, draft: RoleDraft) {
      const state = requireState(await read(), revision);
      const { config } = await paseo.config.get();
      if (!state.values.roles.some((role) => role.id === draft.id)) {
        const provider = draft.newProfile?.provider ??
          config.agentProfiles?.find((profile) => profile.id === draft.profileId)?.provider;
        const available = await paseo.providers.listAvailable();
        if (available.error) throw new Error("Provider discovery failed: " + available.error);
        if (!available.providers.some((entry) => entry.provider === provider && entry.available)) {
          throw new Error("The selected provider is unavailable. Check its setup in Paseo and refresh.");
        }
      }
      return prepareRole(config, state, draft);
    },
    reconcile(paseo: PaseoApi, id: string, revision: string) {
      return serialize(async () => {
        const state = requireState(await read(), revision);
        const role = state.values.roles.find((entry) => entry.id === id);
        if (!role) throw new Error("This role no longer exists.");
        let { config } = await paseo.config.get();
        let patch = planLink(config, role);
        if (Object.keys(patch).length) {
          // Rebase the whole-array patch onto the latest unrelated profile edits.
          config = (await paseo.config.get()).config;
          patch = planLink(config, role);
          requireState(await read(), revision);
          if (Object.keys(patch).length) await paseo.config.patch(patch);
        }
        const verified = (await paseo.config.get()).config;
        requireState(await read(), revision);
        const status = linkStatus(verified, role);
        if (!status.linked) throw new Error(status.detail);
        return { linked: true as const };
      });
    },
    async catalog(paseo: PaseoApi) {
      const [state, { config }, discovered] = await Promise.all([
        read(), paseo.config.get(), paseo.providers.snapshot(),
      ]);
      const roles = state.status === "ready" ? state.values.roles : [];
      const ids = new Set([...discovered.entries.map((entry) => entry.provider), ...Object.keys(config.providers)]);
      return {
        discoveryCwd: homedir(),
        profiles: config.agentProfiles ?? [],
        providers: [...ids].map((id) => {
          const entry = discovered.entries.find((item) => item.provider === id);
          const configured = ownProvider(config, id);
          return {
            id, label: entry?.label ?? (typeof configured?.label === "string" ? configured.label : id),
            available: entry?.status === "ready" && configured?.enabled !== false,
            extends: typeof configured?.extends === "string" ? configured.extends : undefined,
            managed: roles.some((role) => role.alias.id === id),
          };
        }),
        roles: roles.map((role) => linkStatus(config, role)),
      };
    },
  };
}
