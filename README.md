# Role instructions for Paseo

Give your [Paseo](https://paseo.sh) agent profiles reusable Markdown instructions. Create roles such as **Code reviewer**, **Backend developer**, or **Design critic**, then use them through Paseo's normal profile picker.

The plugin provides an instruction editor and links each role to a profile automatically. Installation and everyday setup happen in the UI, without editing JSON or running shell commands.

## Install

You need **Paseo 0.10.1 or newer in both the app and daemon**, and a working agent provider on the host where you install the plugin.

1. Select that host in Paseo, open **Settings → Plugins**, and turn on **Enable plugins**.
2. Paste this into **Plugin source** and select **Install plugin**:

   ```text
   github:mrlorentx/paseo-agent-prompts
   ```

3. Find **agent-system-prompt**, ensure it is enabled, and open **Role instructions** from its three-dot settings menu.

Paseo plugins run with access to the daemon host and app. Install only sources you trust; see [Paseo's installation guide](https://paseo.sh/docs/plugins#install-and-try-it).

## Create your first role

1. Select **Create role** and enter a name, such as **Code reviewer**.
2. Choose **Use an existing profile** or **Create a new profile**. Existing profiles keep their model, mode, thinking, and feature settings. For a new profile, choose a provider and any settings you want to override.
3. Write your instructions in **Standing instructions (Markdown)**. For example:

   ```markdown
   Review changes for correctness, readability, and missing tests.
   Prioritize concrete defects and explain their impact.
   Include file references in your findings.
   Ask before modifying files during a review.
   ```

4. Select **Save role** and wait for **Ready for new agents**. **Cancel** discards an unsaved draft.
5. Start a new agent with the linked profile in Paseo's normal picker. Delegated agents receive the same instructions when launched with that profile's settings.

For more examples, open **Import / export → Preview bundled example prompts**. Select **Configure …** to review and adapt a prompt before saving it.

## Use and manage roles

The settings screen lists each role with its profile, provider, and link status. Roles are shared by clients connected to the same host; other hosts have separate roles.

**Instructions apply when an agent is created.** Editing, disabling, or removing a role affects future agents. Resuming an existing session keeps the instructions captured at creation.

| Action | Effect |
| --- | --- |
| **Edit role → Save role** | Saves instructions for future agents. Renaming keeps the same role and profile link. |
| **Disable / Enable** | Stops or resumes adding instructions to new agents. Keeps the instructions and profile link. |
| **Remove role → Remove and unlink** | Stops adding instructions and restores the profile's original provider if it still uses the role alias. Keeps the profile and its other settings. |
| **Show removed roles → Restore role** | Opens a draft to review and save. Removed instructions remain available for export. |

Role names and profile names are separate. To change the label in the agent picker, rename the profile in Paseo's profile settings.

The plugin adds to existing instructions. Paseo passes the role text as developer instructions to Codex and appended system instructions to Claude. Other providers depend on their support for `systemPrompt`; see [verification coverage](CONTRIBUTING.md#verification-coverage).

## Back up and share roles

1. Open **Import / export → Export all roles → Copy backup**.
2. Save the copied text in a file outside Paseo. If clipboard access fails, select and copy the displayed text manually.
3. To restore or transfer roles, paste the complete backup into **Paste a role backup** and select **Preview import**.
4. Select **Configure …** for each role, review its instructions and profile selection, and save.

Backups include removed roles and saved profile preferences. They exclude provider credentials and configuration, so set up providers separately on a new host. Review the instructions before sharing a backup if they contain private information.

Imports preserve the full instruction text. A matching role ID opens an edit of that role; a new host gets new profile links. Review and save each imported role individually.

### Import older Markdown bindings

If you used the earlier file-based version, choose **Read prototype files** in **Import / export**. It reads `$PASEO_HOME/agent-system-prompt/bindings.json`, or `~/.paseo/agent-system-prompt/bindings.json` when `PASEO_HOME` is unset. For another location, enter an absolute path on the **daemon host** in **Legacy bindings path**.

Select **Configure …** for each imported role, check the instructions and profile, and save. Relative prompt paths resolve beside the bindings file. Original files remain untouched; later changes to those files take effect only after another import and save.

## Update or uninstall

Export a backup before updating or uninstalling. Saved roles survive restarts, disabling the plugin, and updates to the same installation. **Uninstalling deletes the plugin's saved roles.** See [Paseo's settings lifecycle](https://paseo.sh/docs/plugins/reference#persisted-values).

To update a GitHub installation, use Paseo's CLI and review the proposed revision:

```bash
paseo plugin update agent-system-prompt
```

This targets the CLI's default host; use Paseo's global `--host` option for another host. Paseo currently documents update review through the [CLI](https://paseo.sh/docs/plugins/reference#cli-reference). Keep the existing installation instead of uninstalling and reinstalling to update.

Uninstalling leaves profiles and aliases in Paseo. To restore profiles to their previous providers, remove their roles in the plugin first and resolve any unfinished linking. Aliases are retained because existing agents and schedules may still reference them. Future agents no longer receive this plugin's instructions once it is disabled or uninstalled.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| **Role instructions** is missing | Check the selected host, both the global **Enable plugins** switch and the plugin's switch, and the app/daemon versions. Open the plugin's logs from its menu for load errors. |
| A provider is unavailable | Complete that provider's setup in Paseo, then select **Refresh** in the role settings. |
| Instructions are saved, but linking failed | Read the error, fix the reported problem, then select **Retry profile linking**. Saved text is retained. After a disconnect, refresh or reopen settings to check the result. |
| A save conflicts with another window | Copy the draft instructions, cancel, reopen the latest role, and merge your changes. The newer saved version has not been overwritten. |
| The profile's provider changed elsewhere | Use **Edit role → Restore profile link**, then save if you want to link it back to the role. Other profile settings are preserved. |
| An alias collides or its options changed | Review it in Paseo's provider settings. If it is the intended alias with the same base provider, use **Edit role → Advanced details → Adopt current provider options**, then save. |
| An agent does not receive the instructions | Check that the role is enabled and ready, then create a **new** agent with its linked profile. Selecting the base provider alone does not select a role. |
| Settings are invalid | The stored data is preserved, but role instructions are not applied. Recover with a compatible plugin version or a host-settings backup. A portable role backup can be imported into a healthy installation. |

Saving instructions and linking the profile are separate operations. Instructions can already apply to an existing alias even while its profile link needs repair. Avoid editing profiles from another client during a save: Paseo replaces the whole profile list, and simultaneous external edits can overwrite one another.

## Advanced: provider aliases

A provider alias identifies the role when Paseo creates an agent. The plugin matches that alias exactly; it never guesses from a model, mode, or profile name. You can inspect IDs and ownership under **Advanced details**.

Automatic aliases copy the selected provider's configured options when created. Later changes to that source provider do not synchronize to the copy.

To reuse an existing custom alias, select it under **Advanced details → Provider alias** while creating the role. It must use the same base provider. Adoption preserves its credentials and options, and applies the role to **every new agent using that alias**, including other profiles and schedules.

## Help and contributions

[Report an issue](https://github.com/mrlorentx/paseo-agent-prompts/issues) with your Paseo app and daemon versions, plugin revision, reproduction steps, and error message. Remove credentials and private prompt text from reports.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, tests, compatibility coverage, and the implementation's data-preservation rules.
