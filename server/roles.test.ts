import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { PaseoApi } from "@getpaseo/client";
import { MutableDaemonConfigSchema, type MutableDaemonConfig, type MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";
import { backupSchema, exportRoles, parseBackup, replaceRole, storeSchema, type Role, type RoleDraft } from "../shared/roles.ts";
import { prototypeExamples } from "../shared/examples.ts";
import { importBindings } from "./configuration.ts";
import { applySavedRole } from "./prompts.ts";
import { createRoleService, fingerprint, linkStatus, planLink, prepareRole, type StoreState } from "./roles.ts";

const worker = {
  id: "worker", name: "Backend worker", provider: "codex", model: "same-model",
  modeId: "full-access", thinkingOptionId: "high", featureValues: { fast_mode: true },
  icon: "Code", color: "blue", notes: "Delegate backend tasks.", futureSetting: { keep: true },
};
const config = () => MutableDaemonConfigSchema.parse({
  mcp: { injectIntoAgents: true }, providers: {},
  agentProfiles: [worker, { id: "other", name: "Design Critic", provider: "claude", model: "same-model" }],
});
const empty = (): StoreState => ({ status: "ready", revision: "0", values: storeSchema.parse({}) });
const draft = (extra: Partial<RoleDraft> = {}): RoleDraft => ({
  name: "Backend", instructions: "  # Work\n\nKeep exact whitespace.\n", enabled: true,
  profileId: "worker", relink: false, adoptChanges: false, ...extra,
});
function state(role: Role, revision = "1"): StoreState {
  return { status: "ready", revision, values: { roles: [role] } };
}
function apply(config: MutableDaemonConfig, patch: MutableDaemonConfigPatch) {
  assert.equal(patch.removeProviders, undefined, "Never remove a provider needed by saved sessions.");
  return MutableDaemonConfigSchema.parse({ ...config, ...patch, providers: { ...config.providers, ...patch.providers } });
}
function host(initial = config()) {
  let current = initial;
  let gets = 0;
  const patches: MutableDaemonConfigPatch[] = [];
  let beforeGet: (count: number) => void = () => {};
  let afterPatch: () => void = () => {};
  const api = {
    config: {
      get: async () => { beforeGet(++gets); return { requestId: "read", config: structuredClone(current) }; },
      patch: async (patch: MutableDaemonConfigPatch) => {
        patches.push(structuredClone(patch)); current = apply(current, patch); afterPatch();
        return { requestId: "patch", config: structuredClone(current) };
      },
    },
    providers: { listAvailable: async () => ({ providers: [
      { provider: "codex", available: true }, { provider: "claude", available: true },
    ] }) },
  } as unknown as PaseoApi;
  return {
    api, patches,
    get current() { return current; },
    set current(value) { current = value; },
    onGet(fn: typeof beforeGet) { beforeGet = fn; },
    onPatch(fn: typeof afterPatch) { afterPatch = fn; },
  };
}

test("linking an existing profile preserves all profile fields and unrelated profiles", () => {
  const original = config();
  const role = prepareRole(original, empty(), draft());
  const patch = planLink(original, role);
  assert.equal(role.profile.ownership, "adopted");
  assert.equal(role.alias.ownership, "created");
  assert.deepEqual(patch.providers?.[role.alias.id], { extends: "codex", label: "Backend" });
  assert.deepEqual(patch.agentProfiles?.[0], { ...worker, provider: role.alias.id });
  assert.deepEqual(patch.agentProfiles?.[1], original.agentProfiles?.[1]);
  assert.equal(original.agentProfiles?.[0]?.provider, "codex");
  assert.deepEqual(planLink(apply(original, patch), role), {});
});

test("new profiles and renamed roles keep stable identities", () => {
  const original = config();
  const role = prepareRole(original, empty(), draft({
    profileId: undefined, newProfile: { name: "Fresh profile", provider: "claude", model: "m", modeId: "plan" },
  }));
  const linked = apply(original, planLink(original, role));
  const renamed = prepareRole(linked, state(role), draft({ id: role.id, name: "Renamed", instructions: "Updated" }));
  assert.equal(renamed.id, role.id);
  assert.deepEqual(renamed.alias, role.alias);
  assert.equal(renamed.profile.id, role.profile.id);
  assert.deepEqual(planLink(linked, renamed), {});
});

test("custom provider clones preserve credentials and options without storing them in settings", () => {
  const original = config();
  original.providers.custom = { extends: "claude", label: "Custom", env: { API_KEY: "test-secret" }, params: { endpoint: "private" }, command: ["custom-cli"], enabled: true };
  original.agentProfiles![0]!.provider = "custom";
  const role = prepareRole(original, empty(), draft());
  const alias = planLink(original, role).providers?.[role.alias.id];
  assert.equal(alias?.extends, "claude");
  assert.deepEqual(alias, { ...original.providers.custom, label: "Backend" });
  assert.ok(!JSON.stringify(role).includes("test-secret"));
  assert.ok(!exportRoles({ roles: [role] }).includes("test-secret"));
});

test("adoption is explicit and never rewrites an existing alias", () => {
  const original = config();
  original.providers.legacy = { extends: "codex", label: "Legacy", env: { TOKEN: "secret" }, params: { keep: true } };
  const role = prepareRole(original, empty(), draft({ adoptAlias: "legacy" }));
  const patch = planLink(original, role);
  assert.equal(role.alias.ownership, "adopted");
  assert.equal(patch.providers, undefined);
  assert.deepEqual(original.providers.legacy.env, { TOKEN: "secret" });
  assert.throws(() => prepareRole(original, empty(), draft({ adoptAlias: "codex" })), /custom provider alias/);
  original.providers.legacy.extends = "claude";
  assert.throws(() => prepareRole(original, empty(), draft({ adoptAlias: "legacy" })), /same base provider/);
});

test("colliding aliases are preserved and can only be adopted deliberately", () => {
  const original = config();
  const role = prepareRole(original, empty(), draft());
  original.providers[role.alias.id] = { extends: "codex", env: { TOKEN: "other" } };
  assert.throws(() => planLink(original, role), /collides/);
  const adopted = prepareRole(original, state(role), draft({ id: role.id, adoptChanges: true }));
  assert.equal(adopted.alias.ownership, "adopted");
  assert.equal(planLink(original, adopted).providers, undefined);
  original.providers[role.alias.id]!.extends = "claude";
  assert.throws(() => prepareRole(original, state(role), draft({ id: role.id, adoptChanges: true })), /same base provider/);
});

test("stale source options and stale profile provider selections are rejected", () => {
  const original = config();
  const role = prepareRole(original, empty(), draft());
  original.providers.codex = { env: { TOKEN: "changed" } };
  assert.throws(() => planLink(original, role), /source provider changed/);
  original.agentProfiles![0]!.provider = "claude";
  assert.throws(() => prepareRole(original, empty(), draft({ profileProvider: "codex" })), /draft was open/);
});

test("one role owns a profile and alias, including a reservation for removed aliases", () => {
  const original = config();
  const role = prepareRole(original, empty(), draft());
  assert.throws(() => prepareRole(original, state(role), draft()), /already belongs/);
  assert.throws(() => replaceRole({ roles: [role] }, { ...role, id: "22222222-2222-4222-8222-222222222222" }), /Duplicate role/);
  original.providers[role.alias.id] = { extends: "codex" };
  assert.throws(() => prepareRole(original, state({ ...role, removed: true }), draft({ adoptAlias: role.alias.id })), /already tracked/);
});

test("disabled and removed roles stop instructions, preserve aliases, and keep sessions resumable", () => {
  const original = config();
  const role = prepareRole(original, empty(), draft());
  const linked = apply(original, planLink(original, role));
  const agent = { provider: role.alias.id, cwd: "/tmp", systemPrompt: "Existing" };
  const snapshot = applySavedRole(agent, { roles: [role] });
  assert.equal(snapshot?.systemPrompt, "Existing\n\n" + role.instructions);
  assert.equal(applySavedRole(agent, { roles: [{ ...role, enabled: false }] }), undefined);
  assert.deepEqual(planLink(linked, { ...role, enabled: false }), {});
  const removed = { ...role, removed: true };
  const patch = planLink(linked, removed);
  assert.equal(patch.providers, undefined);
  assert.equal(patch.agentProfiles?.[0]?.provider, "codex");
  assert.equal(applySavedRole(agent, { roles: [removed] }), undefined);
  assert.equal(snapshot?.systemPrompt, "Existing\n\n" + role.instructions);
  assert.deepEqual(apply(linked, patch).providers, linked.providers);
});

test("removing an adopted alias restores the original profile provider without losing options", () => {
  const original = config();
  original.providers.legacy = { extends: "codex", env: { TOKEN: "keep" } };
  original.agentProfiles![0]!.provider = "legacy";
  const role = prepareRole(original, empty(), draft({ adoptAlias: "legacy" }));
  assert.deepEqual(planLink(original, { ...role, removed: true }), {});
  assert.equal(original.agentProfiles![0]!.provider, "legacy");
});

test("removing a role preserves a profile moved elsewhere or deleted by its owner", () => {
  const original = config();
  const role = prepareRole(original, empty(), draft());
  original.agentProfiles![0]!.provider = "claude";
  assert.deepEqual(planLink(original, { ...role, removed: true }), {});
  original.agentProfiles = [];
  assert.deepEqual(planLink(original, { ...role, removed: true }), {});
  assert.throws(() => planLink(original, role), /profile was deleted/);
});

test("fresh profile-array reads preserve concurrent unrelated and model edits", async () => {
  const h = host();
  const role = prepareRole(h.current, empty(), draft());
  h.onGet((count) => {
    if (count === 2) {
      h.current.agentProfiles![0]!.model = "new-model";
      h.current.agentProfiles!.push({ id: "concurrent", name: "Added elsewhere", provider: "claude" });
    }
  });
  await createRoleService(async () => state(role)).reconcile(h.api, role.id, "1");
  assert.equal(h.current.agentProfiles![0]!.model, "new-model");
  assert.equal(h.current.agentProfiles!.at(-1)!.id, "concurrent");
});

test("target provider drift blocks writes and explicit relinking preserves its latest settings", async () => {
  const h = host();
  const role = prepareRole(h.current, empty(), draft());
  h.onGet((count) => { if (count === 2) h.current.agentProfiles![0]!.provider = "claude"; });
  await assert.rejects(createRoleService(async () => state(role)).reconcile(h.api, role.id, "1"), /changed elsewhere/);
  assert.equal(h.patches.length, 0);
  const relinked = prepareRole(h.current, state(role), draft({ id: role.id, relink: true }));
  await createRoleService(async () => state(relinked)).reconcile(h.api, role.id, "1");
  assert.equal(h.current.agentProfiles![0]!.provider, role.alias.id);
});

test("settings revision changes prevent config writes", async () => {
  const h = host();
  const role = prepareRole(h.current, empty(), draft());
  let reads = 0;
  const service = createRoleService(async () => state(role, ++reads === 1 ? "1" : "2"));
  await assert.rejects(service.reconcile(h.api, role.id, "1"), /another window/);
  assert.equal(h.patches.length, 0);
});

test("partial failure keeps saved instructions and a restart can retry idempotently", async () => {
  const h = host();
  const role = prepareRole(h.current, empty(), draft());
  const persisted = state(role);
  h.onPatch(() => { throw new Error("Response lost after commit"); });
  await assert.rejects(createRoleService(async () => persisted).reconcile(h.api, role.id, "1"), /Response lost/);
  assert.equal(applySavedRole({ provider: role.alias.id, cwd: "/" }, { roles: [role] })?.systemPrompt, role.instructions);
  h.onPatch(() => {});
  await createRoleService(async () => persisted).reconcile(h.api, role.id, "1");
  assert.equal(h.patches.length, 1);
  assert.equal(linkStatus(h.current, role).linked, true);
});

test("concurrent retries are serialized and create only one alias/profile", async () => {
  const h = host();
  const role = prepareRole(h.current, empty(), draft({ profileId: undefined, newProfile: { name: "New", provider: "codex" } }));
  const service = createRoleService(async () => state(role));
  await Promise.all([service.reconcile(h.api, role.id, "1"), service.reconcile(h.api, role.id, "1")]);
  assert.equal(h.patches.length, 1);
  assert.equal(h.current.agentProfiles!.filter((profile) => profile.id === role.profile.id).length, 1);
});

test("post-write drift is reported for recovery, never reported as a successful link", async () => {
  const h = host();
  const role = prepareRole(h.current, empty(), draft());
  h.onPatch(() => { h.current.agentProfiles![0]!.provider = "claude"; });
  await assert.rejects(createRoleService(async () => state(role)).reconcile(h.api, role.id, "1"), /changed elsewhere/);
});

test("settings prompts match exact aliases and preserve all request config fields", () => {
  const role = prepareRole(config(), empty(), draft());
  const agent = Object.freeze({
    provider: role.alias.id, cwd: "/workspace", model: "same-model",
    systemPrompt: "  Original\n", featureValues: { fast_mode: true }, providerOptions: { custom: true },
  });
  const first = applySavedRole(agent, { roles: [role] })!;
  assert.deepEqual(first, { ...agent, systemPrompt: agent.systemPrompt + "\n\n" + role.instructions });
  const updated = { ...role, instructions: "Next agent only." };
  assert.equal(applySavedRole(agent, { roles: [updated] })?.systemPrompt, agent.systemPrompt + "\n\nNext agent only.");
  assert.ok(first.systemPrompt?.endsWith(role.instructions));
  for (const provider of ["codex", "claude", "constructor", role.alias.id + "-other"]) {
    assert.equal(applySavedRole({ ...agent, provider }, { roles: [role] }), undefined);
  }
  assert.equal(applySavedRole(agent, { roles: [] }), undefined);
});

test("portable export/import preserves IDs and exact Markdown, without claiming ownership", () => {
  const role = prepareRole(config(), empty(), draft());
  const exported = exportRoles({ roles: [{ ...role, removed: true }] });
  const parsed = backupSchema.parse(JSON.parse(exported));
  assert.equal(parsed.roles[0]!.id, role.id);
  assert.equal(parsed.roles[0]!.instructions, role.instructions);
  assert.equal(parsed.roles[0]!.removed, true);
  assert.ok(!exported.includes("fingerprint"));
  assert.ok(!exported.includes("ownership"));
  assert.equal(parsed.roles[0]!.profile?.featureValues?.fast_mode, true);
});

test("legacy migration and bundled examples preserve the existing Markdown bytes", async () => {
  const imported = await importBindings(resolve("configuration/bindings.json"));
  assert.deepEqual(imported, prototypeExamples);
  for (const item of imported) {
    const original = await readFile(resolve("configuration/prompts", item.suggestedAlias + ".md"), "utf8");
    assert.equal(item.instructions, original);
  }
});

test("legacy imports report malformed files without affecting the empty managed runtime", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "role-import-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  await writeFile(join(path, "bindings.json"), "{");
  await assert.rejects(importBindings(join(path, "bindings.json")), /Invalid JSON/);
  assert.equal(applySavedRole({ provider: "codex", cwd: "/" }, { roles: [] }), undefined);
});

test("validation rejects blank prompts, duplicate identities and oversized imports", () => {
  assert.throws(() => prepareRole(config(), empty(), draft({ instructions: " \n" })), /standing instructions/);
  const role = prepareRole(config(), empty(), draft());
  assert.throws(() => storeSchema.parse({ roles: [role, role] }), /Duplicate role/);
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
  assert.throws(() => prepareRole(config(), empty(), draft({ instructions: "x".repeat(131073) })), /131,072 characters/);
});

test("backup errors are useful and existing profile names are not constrained by the new-role editor", () => {
  assert.throws(() => parseBackup("{"), /Paste the complete text/);
  assert.throws(() => parseBackup('{"format":"unknown","version":2,"roles":[]}'), /Cannot import this backup/);
  const original = config();
  original.agentProfiles![0]!.name = "A".repeat(150);
  const role = prepareRole(original, empty(), draft());
  assert.equal(role.profile.template.name.length, 150);
});
