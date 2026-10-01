# Contributing

Keep changes focused on standing instructions, provider aliases, and profile linking. Describe the user-visible problem and how to reproduce it in an [issue or pull request](https://github.com/mrlorentx/paseo-agent-prompts).

## Development setup

Use **Node.js 22.18 or newer** and npm. Fork and clone the repository, then run these commands from the checkout:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
```

For changes to the UI, runtime imports, or integration, also run:

```bash
npm run smoke
```

The smoke test requires the Paseo CLI on `PATH`. It locates the CLI's compiler without connecting to a daemon. Set `PASEO_COMPILER` to an absolute compiler module path to test a different installation; the CLI must still be on `PATH`.

For legacy file-import changes, validate the sample bindings too:

```bash
npm run check-config -- configuration/bindings.json
```

Include the relevant validation results in your pull request. For UI changes, include screenshots from wide and compact layouts and check both light and dark themes. These development commands do not install or enable the plugin or launch live agents.

## Verification coverage

Development SDKs are pinned to **Paseo 0.10.1**, the minimum supported version. The bundle smoke test has passed with the published **0.10.1 and 0.10.2 compilers**. Later versions have not been verified.

The smoke test compiles a temporary checkout without `node_modules`, matching a GitHub installation. It renders the compiled bundles with a simulated React Native host and exercises save/cancel, existing and new profiles, prompt injection using copied profile settings, conflicts, retry after failed writes, removal, backups, compact layouts, and themed controls.

Live Codex/Claude creation and resume, and rendering in real desktop/mobile clients, have not yet been verified for this plugin. When testing those paths, check that a new agent receives its role, a resumed agent retains its original instructions, and edits affect only later creations. Report the provider and Paseo versions tested.

## Code map

| Location | Responsibility |
| --- | --- |
| [index.client.tsx](index.client.tsx), [client/](client/) | Settings registration, role editor, import/export, and recovery actions. |
| [index.server.ts](index.server.ts) | Settings registration, RPC handlers, and the agent creation hook. |
| [shared/roles.ts](shared/roles.ts), [shared/rpc.ts](shared/rpc.ts) | Settings, role, backup, and RPC schemas. |
| [server/roles.ts](server/roles.ts) | Alias ownership, validation, profile linking, and conflict checks. |
| [server/prompts.ts](server/prompts.ts) | Exact provider matching and instruction composition. |
| [server/configuration.ts](server/configuration.ts), [configuration/](configuration/) | Legacy file import and example bindings/prompts. |
| [server/](server/), [scripts/smoke.mjs](scripts/smoke.mjs) | Unit tests and compiled UI/integration smoke test. |

## Preserve user data

Host-scoped plugin settings hold role text, stable IDs, enabled/removed state, and ownership records. Provider credentials and options remain in daemon configuration. Exports contain portable instructions and profile preferences, without credentials or ownership claims.

Saving has two stages: save the desired role with the settings revision guard, then reconcile the alias and profile through `paseo.config.get()` and `paseo.config.patch()`. A failed second stage must leave the saved instructions recoverable through retry. Match the saved revision before linking and derive status from current configuration after reconnects.

Profile patches replace the whole array. Re-read before patching, preserve unrelated profiles and all fields other than the intended provider link, serialize plugin writes, and verify afterward. Paseo 0.10.1/0.10.2 provide no config compare-and-swap guard, so a race with external writers remains possible.

Never infer a role from a model/mode combination: profile selection copies settings without passing the profile ID to the creation hook. Match the provider alias exactly and preserve the rest of the creation request, including any existing system prompt.

Alias collisions and changed options require explicit adoption. Keep aliases and profiles when removing a role: the supported APIs cannot enumerate every saved-agent or schedule reference needed to prove deletion safe. Retain removed instructions for export and restoration.

Invalid settings must remain intact. The hook skips instruction injection for an invalid document; a settings read/transport exception still fails the hook. Missing legacy files affect explicit import only. Keep prompt contents out of logs.

## Runtime and compatibility

Paseo supplies the plugin SDK, React, React Native, TanStack Query, and Zod. Git installs of this plugin require no dependency preparation. Keep client code in `client/`, server code in `server/`, and shared contracts in `shared/`.

Type-only imports are checked during installation too. Derive agent/config types through `@getpaseo/plugin/server`; importing development-only `@getpaseo/client` or `@getpaseo/protocol` directly from production code can fail in a clean checkout. Bundle file-backed assets explicitly: source-adjacent paths based on `import.meta.url`, `__dirname`, or `process.cwd()` are unreliable at runtime.

Use React Native controls, Paseo theme values, and compact layouts. Preserve the installation ID `agent-system-prompt` and migrate settings explicitly when changing their schema. Raise the manifest's minimum Paseo version only when adopting an API that requires it.

Consult the current official [plugin reference](https://paseo.sh/docs/plugins/reference), [SDK reference](https://paseo.sh/docs/sdk/reference), and [provider configuration guide](https://paseo.sh/docs/custom-providers) when changing integration behavior.
