# Role instructions for Paseo

Manage standing instructions for Paseo agents through **Settings → Plugins → agent-system-prompt → Role instructions**.

Create a role, choose an existing agent profile or create a new one, write Markdown instructions, and select **Save role**. The plugin creates or adopts a provider alias and links the profile automatically. Use that profile in Paseo's normal agent picker or delegated-agent workflow. Ordinary setup requires no JSON editing, symlinks, or shell commands.

Requires Paseo **0.10.2 or newer on both the daemon and app**. Development and offline verification target 0.10.2; later releases have not been tested.

## Install and configure

1. On the intended host, open **Settings → Plugins**. Paseo plugins are trusted code, so only enable plugins and install sources you trust.
2. Enter the plugin's directory path on that daemon, or a Git/npm source supplied by its distributor, into **Plugin source** and install it.
3. Open **Role instructions** under the installed plugin.
4. Select **Create role**. Choose an existing profile or **Create a new profile**. New profiles can select a provider, model, mode, thinking level, and discovered feature settings.
5. Write the role name and standing instructions; select **Save role**. **Cancel** discards the draft without writing settings or configuration.
6. Wait for **Ready for new agents**, then create a new agent with the linked profile.

This repository is prepared for sharing but has not been published or installed on the local daemon. Its npm package remains private until a release is intentionally prepared. A distributor can share this directory or repository without changing the implementation. npm publication additionally requires removing `private` and choosing package ownership and licensing.

Role names and profile names are separate. Renaming a role preserves its stable ID, provider alias, and profile. Rename the profile through Paseo's profile settings if its picker label should change too.

## What gets applied

The creation hook matches the **exact provider alias** and appends the saved instructions to any existing `config.systemPrompt`. It preserves every other request/config field. Model, mode, or profile-name combinations never determine role identity.

Selecting a profile copies its settings, including the alias. Delegated launches do the same; no selected profile ID needs to reach the hook. Direct launches using that alias also receive the role instructions.

Codex receives developer instructions; Claude receives appended system instructions. The provider's built-in prompt and Paseo's daemon-wide instructions remain in place. Other providers can be selected, but their handling of `systemPrompt` needs provider-specific verification.

Instructions are captured at **agent creation**. Edits, disable, and removal affect future agents. Existing sessions retain their captured text when resumed. Changing the provider of an existing session does not rerun this hook.

## Ownership and lifecycle

Host-scoped plugin settings are the canonical store for Markdown, stable role IDs, enabled state, removed-role records, and alias/profile ownership. Settings survive daemon restart, reload, disable, and updates under the **same installation ID**. They are separate from source files.

Paseo configuration owns providers and agent profiles. All writes use `paseo.config.get()` and `paseo.config.patch()`; the plugin never rewrites `config.json`.

- **Existing profile:** only its provider is changed. Model, mode, thinking, feature settings, notes, icon, color, and unknown profile fields are preserved. Linking is recorded as adoption.
- **New profile:** gets its own stable ID and is recorded as plugin-created.
- **Automatic alias:** gets a stable ID derived from the role ID. Custom source-provider options are copied because 0.10.2 aliases extend a built-in provider or ACP, rather than another alias. Credentials and options stay in daemon configuration; they are not copied into plugin settings or exports. Changes to the source provider after creation do not update this independent copy.
- **Adopted alias:** choose one explicitly under **Advanced details**. It must be a custom alias with the same base provider. Its configuration is never patched. Adoption applies the role to every future agent using that alias, including other profiles and schedules.
- **Disable:** retains instructions and profile/alias links, but stops adding role instructions to new agents.
- **Remove:** stops instructions immediately and restores the linked profile's original provider if it still uses the role alias. Other profile edits and deleted profiles are respected. Profiles created by the plugin are kept too. A profile that already used an adopted alias keeps that original alias.
- **Removed roles:** stay in **Show removed roles** for export or restoration. Their alias IDs remain reserved. Restoring is an explicit draft and save.

**Aliases are always retained**, including after removal. They may be referenced by active or archived agents, other profiles, schedules, or callers outside the plugin. The 0.10.2 plugin SDK does not expose a complete reference inventory, so automatic deletion cannot establish that resume is safe. The plugin never calls `removeProviders`, deletes profiles, or changes schedules. Retained aliases no longer receive instructions from a removed role.

## Save failures and concurrent changes

Save has two steps:

1. Validate and save the desired role in host settings using Paseo's revision guard.
2. Re-read daemon config, create the alias if needed, merge the profile link, and verify the resulting config.

This is intentionally recoverable rather than pretending settings and daemon configuration share a transaction. Instructions start applying to an existing alias after step 1. If step 2 fails, the saved role remains visible with an error and **Retry profile linking**. Refresh or reopen settings after a disconnect; status is derived from current configuration, so no in-memory transaction is needed. Retry also handles a response lost after the configuration was committed.

An unsaved draft keeps its original settings revision. A conflicting save is rejected and the draft stays open. Copy its instructions, cancel, reopen the current role, and merge the intended change.

The service serializes its configuration writes, reads the profile array again immediately before patching, preserves unrelated entries, and verifies the result. A provider change on the target profile causes a conflict. **Edit role → Restore profile link** explicitly accepts relinking while keeping that profile's latest other settings.

If an automatically created alias collides or its options changed, nothing is overwritten. Review the provider in Paseo, then **Edit role → Advanced details → Adopt current provider options** to explicitly adopt it. A different base provider cannot be accepted as the same alias.

Paseo 0.10.2 has **no compare-and-swap revision on daemon config patches**. The remaining race between the last read and patch cannot be eliminated by a plugin: simultaneous external edits to the same whole-array profile configuration can still be lost. Avoid editing profiles in another client during a role-link save. Settings revisions do protect role text from concurrent UI saves.

## Import the prototype or another user's roles

Open **Import / export**:

- **Read prototype files** reads `$PASEO_HOME/agent-system-prompt/bindings.json`, falling back to `~/.paseo/agent-system-prompt/bindings.json`. An optional absolute path on the daemon host supports a different location. Relative Markdown paths resolve beside that bindings file.
- **Preview bundled example prompts** imports lossless copies of this repository's Backend worker and Design Critic drafts, without relying on bundle-relative paths.
- **Preview import** accepts a pasted export and lists roles for review.

Choose **Configure …** for each role, review its complete Markdown, select a profile, and save. An existing profile using the exact legacy alias can be selected automatically. Otherwise choose the intended profile yourself; roles are never guessed from models or modes. For example, if Design Critic still uses base Claude, choose that profile and explicitly adopt its legacy alias in Advanced details.

Imports preserve the exact instruction text, including whitespace. They never modify or delete Markdown/bindings files. Imported portable roles keep their stable role IDs. On another host they receive new profile/alias mappings; matching role IDs on the same installation open an edit draft rather than making a duplicate. Restore removed roles only when intended.

The old file reader, standalone validator, original example Markdown, and nine prototype tests remain available for validation and migration. The installed hook now uses settings; editing legacy files has no effect until you import and save them again.

## Backups, updates, and uninstall

Use **Export all roles → Copy backup** and save the text outside Paseo. A selectable text area is available if clipboard access fails. Paste it into **Preview import** to restore through the UI. Backups include removed roles and profile preferences, and exclude provider credentials and ownership claims. Treat exported instructions as private when they contain private information.

Keep the plugin installation ID `agent-system-prompt` unchanged across updates. Do not remove and reinstall as an update procedure.

**Removing the plugin installation deletes its host settings**, including instructions. Export first. Uninstall does not run profile cleanup: aliases and profiles remain in daemon config so existing sessions can still resume. They launch future agents without this plugin's added instructions. Remove/unlink individual roles through the UI before uninstalling if you want profiles restored to their previous providers.

Settings validation failures are surfaced without resetting the stored document. Invalid settings stop prompt injection and emit a metadata-only error; they do not block every unrelated agent creation. A host read/transport failure still fails the hook. Missing or malformed legacy files affect only explicit import/validation, not ordinary agent creation.

The UI does not silently reset an invalid or unsupported-version settings document. Preserve that host document and recover it using a compatible plugin version or a host backup. Portable exports are intended for recovery into a healthy installation.

## Development and verification

Use Node 22.18 or newer. SDK/React Native versions are pinned to the inspected Paseo release. From this checkout:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run check-config -- configuration/bindings.json
npm run smoke
npm pack --dry-run
```

The smoke command requires an installed Paseo CLI. It locates its compiler without connecting to a daemon; `PASEO_COMPILER` can override the compiler module path for other installations. It compiles both actual entries, renders the client with a simulated React Native host, and exercises save/cancel, existing and new profiles, prompt injection through copied profile settings, conflicts, failed writes/retry, removal, export/import preview, compact layout, and themed controls.

This verifies bundled integration without installing or enabling plugins. It does **not** substitute for checking a real desktop/mobile client or live Codex/Claude creation and resume. Those live checks remain outstanding. No daemon enablement, installation, publication, or live-agent launch is performed by the development checks.

Current official references: [plugin settings and hooks](https://paseo.sh/docs/plugins/reference), [SDK](https://paseo.sh/docs/sdk/reference), [provider configuration](https://paseo.sh/docs/custom-providers), and [publishing](https://paseo.sh/docs/plugins/publishing).
