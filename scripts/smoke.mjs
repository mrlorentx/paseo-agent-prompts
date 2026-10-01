import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MutableDaemonConfigSchema } from "@getpaseo/protocol/messages";
import * as queryRuntime from "@tanstack/react-query";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = realpathSync(execFileSync("which", ["paseo"], { encoding: "utf8" }).trim());
const compilerPath = process.env.PASEO_COMPILER ?? resolve(dirname(cli), "../node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js");
const { compilePlugin } = await import(pathToFileURL(compilerPath).href);
const checkout = await mkdtemp(join(tmpdir(), "paseo-plugin-install-smoke-"));
let bundles;
try {
  await cp(root, checkout, {
    recursive: true,
    filter: (path) => ![".git", "node_modules"].includes(basename(path)),
  });
  // The installed source must compile using only host-provided modules.
  const checkoutRequire = createRequire(resolve(checkout, "package.json"));
  assert.throws(() => checkoutRequire.resolve("@getpaseo/protocol/agent-types"), { code: "MODULE_NOT_FOUND" });
  bundles = await compilePlugin({
    client: resolve(checkout, "index.client.tsx"),
    server: resolve(checkout, "index.server.ts"),
  });
} finally {
  await rm(checkout, { recursive: true, force: true });
}
assert.ok(bundles.clientBundle && bundles.serverBundle);
const evaluate = (source, loader = require) => new Function("return " + source)()(loader);

let state;
let definition;
let revision = 0;
const listeners = new Set();
const handlers = new Map();
let hook;
let patchFailure = false;
let config = MutableDaemonConfigSchema.parse({
  mcp: { injectIntoAgents: true },
  providers: { legacy: { extends: "claude", label: "Legacy critic", env: { TOKEN: "must-stay-on-host" } } },
  agentProfiles: [{ id: "existing", name: "Existing worker", provider: "codex", model: "m",
    modeId: "mode", thinkingOptionId: "high", featureValues: { fast_mode: true }, notes: "Use for backend work." }],
});
const patches = [];
const paseo = {
  config: {
    get: async () => ({ config: structuredClone(config) }),
    patch: async (patch) => {
      if (patchFailure) throw new Error("Simulated config write failure");
      patches.push(structuredClone(patch));
      config = MutableDaemonConfigSchema.parse({ ...config, ...patch, providers: { ...config.providers, ...patch.providers } });
      return { config: structuredClone(config) };
    },
  },
  providers: {
    snapshot: async () => ({ entries: [
      { provider: "codex", status: "ready", label: "Codex" }, { provider: "claude", status: "ready", label: "Claude" },
      ...Object.entries(config.providers).map(([provider, value]) => ({ provider, status: "ready", label: value.label })),
    ] }),
    listAvailable: async () => ({ providers: ["codex", "claude", ...Object.keys(config.providers)].map((provider) => ({ provider, available: true })) }),
    listModels: async () => ({ models: [{ id: "m", label: "Model", thinkingOptions: [{ id: "high", label: "High" }] }] }),
    listModes: async () => ({ modes: [{ id: "mode", label: "Mode" }] }),
    listFeatures: async () => ({ features: [{ id: "fast_mode", label: "Fast mode", type: "toggle", value: false }] }),
  },
};
evaluate(bundles.serverBundle).default({
  registerSettings(value) {
    definition = value;
    state = { status: "ready", values: value.schema.parse({}), revision: "0" };
    return { read: async () => structuredClone(state), subscribe: () => () => {} };
  },
  handle(contract, handler) { handlers.set(contract.name, { contract, handler }); },
  before(event, handler) { assert.equal(event, "agent.create"); hook = handler; return () => {}; },
});
async function rpc(contract, input) {
  if (contract.name === "settings.roles.read") return structuredClone(state);
  const entry = handlers.get(contract.name);
  assert.ok(entry, contract.name);
  return entry.contract.output.parse(await entry.handler(entry.contract.input.parse(input), { paseo }));
}
async function save(values, expected) {
  if (state.revision !== expected) return false;
  state = { status: "ready", values: definition.schema.parse(values), revision: String(++revision) };
  for (const listener of listeners) listener();
  return true;
}
function useSettings() {
  const snapshot = React.useSyncExternalStore(
    React.useCallback((notify) => { listeners.add(notify); return () => listeners.delete(notify); }, []),
    () => state,
  );
  return { ...snapshot, saving: false, saveError: null, save,
    reload: async () => {}, reset: async () => { throw new Error("No implicit reset allowed"); } };
}
let copied = "";
const native = Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView"].map((name) => [name, name]));
const ui = Object.fromEntries(["SettingsSelect", "SettingsSwitch"].map((name) => [name, name]));
const client = evaluate(bundles.clientBundle, (id) => {
  if (id === "react-native") return native;
  if (id === "@getpaseo/plugin/client/ui") return ui;
  if (id === "@getpaseo/plugin/client/react-native") return { copyText: async (text) => { copied = text; } };
  if (id === "@getpaseo/plugin/client") return { useSettings, useRpc: (contract) => (input) => rpc(contract, input), usePaseo: () => paseo };
  if (id === "@tanstack/react-query") return queryRuntime;
  return require(id);
});
let Screen;
client.default({ addSettingsScreen(screen) { assert.equal(screen.id, "roles"); Screen = screen.Component; return () => {}; } });
assert.ok(Screen);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const theme = { colors: {
  surface0: "#101010", surface1: "#202020", surface2: "#303030", border: "#444444",
  foreground: "#ffffff", foregroundMuted: "#bbbbbb", accent: "#4488ff", accentForeground: "#ffffff",
  statusSuccess: "#00ff00", statusWarning: "#ffaa00", statusDanger: "#ff5555",
} };
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
let tree;
async function settle() { await act(async () => { await new Promise((done) => setTimeout(done, 20)); }); }
await act(async () => {
  tree = TestRenderer.create(React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(Screen, { theme, layout: { compact: false, platform: "web" }, host: { id: "test", label: "Test host" } })));
});
await settle();
function find(type, predicate) { return tree.root.findAllByType(type).find(predicate); }
async function button(label) {
  const item = find("Pressable", (node) => node.props.accessibilityLabel === label);
  assert.ok(item, "Missing button: " + label);
  assert.ok(!item.props.disabled, "Disabled button: " + label);
  await act(async () => { item.props.onPress(); });
  await settle();
}
async function field(label, value) {
  const item = find("TextInput", (node) => node.props.accessibilityLabel === label);
  assert.ok(item, "Missing field: " + label);
  await act(async () => { item.props.onChangeText(value); });
}
async function select(label, value) {
  const item = find("SettingsSelect", (node) => node.props.label === label);
  assert.ok(item, "Missing select: " + label);
  await act(async () => { item.props.onValueChange(value); });
  await settle();
}
function visibleText() { return JSON.stringify(tree.toJSON()); }

assert.equal(await hook({ request: { config: { provider: "codex", cwd: "/" } } }), undefined);
await button("Create role");
await field("Role name", "Canceled role");
await button("Cancel");
assert.equal(state.values.roles.length, 0);
assert.equal(patches.length, 0);
await button("Create role");
await select("Choose profile", "existing");
await field("Role name", "Worker");
await field("Standing instructions (Markdown)", "  # Saved worker\nUse care.\n");
await button("Save role");
assert.equal(state.values.roles.length, 1, visibleText());
const role = state.values.roles[0];
assert.equal(config.agentProfiles[0].provider, role.alias.id, visibleText());
assert.equal(config.agentProfiles[0].model, "m");
assert.equal(config.agentProfiles[0].notes, "Use for backend work.");

// Normal picker and delegated launches both copy the profile settings.
const request = { config: { ...config.agentProfiles[0], cwd: "/workspace", systemPrompt: "Existing" }, prompt: "Do the task", labels: { delegated: "true" } };
const created = await hook({ request });
assert.equal(created.config.systemPrompt, "Existing\n\n" + role.instructions);
assert.equal(created.prompt, request.prompt);
assert.deepEqual(created.labels, request.labels);
assert.equal(request.config.systemPrompt, "Existing");

await button("Edit role");
await field("Role name", "Renamed worker");
await button("Save role");
assert.equal(state.values.roles[0].id, role.id);
assert.equal(state.values.roles[0].alias.id, role.alias.id);
await button("Disable");
assert.equal(await hook({ request }), undefined);
assert.equal(created.config.systemPrompt, "Existing\n\n" + role.instructions);
await button("Enable");

// A stale draft cannot overwrite another client's saved instructions.
await button("Edit role");
await field("Standing instructions (Markdown)", "Stale edit");
await act(async () => { await save({ roles: [{ ...state.values.roles[0], instructions: "Other client's text" }] }, state.revision); });
await button("Save role");
assert.equal(state.values.roles[0].instructions, "Other client's text");
assert.ok(visibleText().includes("another window"));
await button("Cancel");

// A failed daemon write leaves a durable role and an actionable retry.
await button("Create role");
await select("Profile", "new");
await field("Role name", "Critic");
await select("Provider", "claude");
await field("Standing instructions (Markdown)", "# Critic\nReview design.");
patchFailure = true;
await button("Save role");
assert.equal(state.values.roles.length, 2);
assert.ok(visibleText().includes("Simulated config write failure"));
patchFailure = false;
await button("Retry profile linking");
assert.equal(config.agentProfiles.length, 2);

// Removal confirmation leaves aliases and profiles, and export preserves prompts.
await button("Remove role");
await button("Cancel removal");
assert.equal(state.values.roles[0].removed, false);
await button("Remove role");
await button("Remove and unlink");
assert.equal(state.values.roles[0].removed, true);
assert.equal(config.agentProfiles[0].provider, "codex");
assert.ok(config.providers[role.alias.id]);
await button("Import / export");
await button("Export all roles");
await button("Copy backup");
assert.ok(copied.includes("Other client's text"));
assert.ok(!copied.includes("must-stay-on-host"));
assert.ok(!copied.includes("ownership"));
await field("Paste a role backup", copied);
await button("Preview import");
assert.ok(visibleText().includes("Configure Renamed worker"));
await button("Preview bundled example prompts");
assert.ok(visibleText().includes("Configure Backend worker"));

// Render compact layout with a light palette and audit themed text and inputs.
await act(async () => {
  tree.update(React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(Screen, { theme: { colors: { ...theme.colors, foreground: "#111111", surface0: "#ffffff" } },
      layout: { compact: true, platform: "ios" }, host: { id: "test", label: "Test host" } })));
});
await settle();
for (const node of tree.root.findAllByType("Text")) assert.ok(node.props.style.color, "Text must use theme color");
for (const node of tree.root.findAllByType("Pressable")) assert.ok(node.props.style.minHeight >= 44, "Touch target");
assert.ok(tree.root.findAllByType("View").some((node) => node.props.style?.flexDirection === "column"));
await act(async () => tree.unmount());
queryClient.clear();
console.log("Compiled a clean checkout without node_modules; settings UI, native layouts, profile/delegation hooks, conflict, retry, removal and backup smoke checks passed.");
