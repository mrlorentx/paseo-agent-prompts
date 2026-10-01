import { useState } from "react";
import { Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { settingsRpc } from "@getpaseo/plugin";
import { useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { roleSettings, parseBackup, exportRoles, replaceRole, storeSchema, type PortableRole, type Role, type RoleDraft } from "../shared/roles.ts";
import { catalogRpc, legacyRpc, prepareRpc, reconcileRpc } from "../shared/rpc.ts";
import { prototypeExamples } from "../shared/examples.ts";
import { Button, Field, Note } from "./controls.tsx";
import { RoleEditor, type Catalog, type EditorDraft } from "./editor.tsx";

const readSettingsRpc = settingsRpc(roleSettings.id).read;

export function RoleSettingsScreen(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  const settings = useSettings(roleSettings);
  const getCatalog = useRpc(catalogRpc);
  const prepare = useRpc(prepareRpc);
  const reconcile = useRpc(reconcileRpc);
  const read = useRpc(readSettingsRpc);
  const readLegacy = useRpc(legacyRpc);
  const catalog = useQuery({ queryKey: ["roles-catalog", settings.status === "ready" ? settings.revision : ""], queryFn: () => getCatalog({}) });
  const [editor, setEditor] = useState<EditorDraft | null>(null);
  const [editorCatalog, setEditorCatalog] = useState<Catalog | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<Role | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [backup, setBackup] = useState("");
  const [importText, setImportText] = useState("");
  const [legacyPath, setLegacyPath] = useState("");
  const [previews, setPreviews] = useState<PortableRole[]>([]);

  const operation = useMutation({
    mutationFn: async (work: () => Promise<void>) => { setError(""); setNotice(""); await work(); },
    onError: (failure) => { setNotice(""); setError(failure instanceof Error ? failure.message : "The operation failed. Your saved instructions are preserved."); },
    onSettled: () => { void catalog.refetch(); },
  });
  const busy = operation.isPending || settings.saving;
  const run = (work: () => Promise<void>) => operation.mutate(work);

  function open(imported?: PortableRole, role?: Role) {
    if (settings.status !== "ready" || !catalog.data) return;
    setEditorCatalog(catalog.data);
    const existing = role ?? (imported?.id ? settings.values.roles.find((entry) => entry.id === imported.id) : undefined);
    setEditor({ revision: settings.revision, role: existing && imported
      ? { ...existing, name: imported.name, instructions: imported.instructions, enabled: imported.enabled }
      : existing, imported });
    setEditorKey((value) => value + 1);
    setError(""); setNotice(""); setRemoving(null);
  }

  async function persist(role: Role, revision: string) {
    if (settings.status !== "ready") throw new Error("Load valid settings before saving.");
    const next = replaceRole(settings.values, role);
    if (!await settings.save(next, revision)) {
      throw new Error("The role could not be saved. Check the settings error below. Your draft is still open; copy it before canceling or reloading.");
    }
    setEditor(null); setRemoving(null);
    setNotice("Instructions saved. Finishing the profile link…");
    // The host returns an opaque revision. Read it after the settings write;
    // do not guess it or use a stale React render's revision.
    const current = await read({});
    if (current.status !== "ready") throw new Error("Instructions saved, but settings could not be read. Refresh and retry linking.");
    const store = storeSchema.parse(current.values);
    const saved = store.roles.find((entry) => entry.id === role.id);
    if (JSON.stringify(saved) !== JSON.stringify(role)) {
      throw new Error("This role changed during save. Refresh to see the latest version before linking.");
    }
    try {
      await reconcile({ id: role.id, revision: current.revision });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Profile linking failed.";
      throw new Error("Instructions are saved, but the profile link is unfinished. Refresh or use Retry profile linking. " + detail);
    }
    setNotice(role.removed ? "Role removed and profile unlinked. Its provider is retained for existing sessions."
      : role.enabled ? "Role saved. Select its profile when starting a new agent." : "Role disabled for new agents.");
  }

  async function saveDraft(value: RoleDraft) {
    if (!editor) return;
    const role = await prepare({ revision: editor.revision, draft: value });
    await persist(role, editor.revision);
  }

  const section = { gap: 12, padding: layout.compact ? 12 : 20, borderWidth: 1,
    borderColor: theme.colors.border, backgroundColor: theme.colors.surface0, borderRadius: 10 };
  return <View style={{ gap: 20, paddingVertical: layout.compact ? 12 : 20 }}>
    <Text style={{ color: theme.colors.foreground, fontSize: 24, fontWeight: "600" }}>Role instructions</Text>
    <Note theme={theme}>Give a Paseo profile standing instructions for future agents. Roles are shared by clients connected to {props.host.label}.</Note>
    {notice && <Note theme={theme}>{notice}</Note>}
    {error && <Note theme={theme} error>{error}</Note>}
    {settings.saveError && <Note theme={theme} error>{settings.saveError}</Note>}
    {catalog.error && <Note theme={theme} error>{catalog.error.message}</Note>}
    {settings.status === "loading" && <Note theme={theme}>Loading saved roles…</Note>}
    {(settings.status === "invalid" || settings.status === "error") && <>
      <Note theme={theme} error>{settings.error}</Note>
      <Note theme={theme}>Stored data has not been reset. Export backups before uninstalling. Reload after fixing a connection problem; invalid settings need recovery from a saved host-settings backup.</Note>
    </>}
    <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 8 }}>
      <Button theme={theme} label="Create role" onPress={() => open()} disabled={busy || !!editor || settings.status !== "ready" || !catalog.data} />
      <Button theme={theme} label="Refresh" disabled={busy} onPress={() => run(async () => { await settings.reload(); await catalog.refetch(); })} />
      <Button theme={theme} label={transfer ? "Close import / export" : "Import / export"} onPress={() => setTransfer(!transfer)} disabled={busy || !!editor} />
    </View>
    {editor && editorCatalog && <View style={section}>
      {settings.status === "ready" && settings.revision !== editor.revision &&
        <Note theme={theme} error>Saved roles changed while this draft was open. Save will reject the old revision. Copy your instructions, cancel, and reopen the latest role to merge.</Note>}
      <RoleEditor key={editorKey} {...props} catalog={editorCatalog} draft={editor} busy={busy}
        onSave={(value) => run(() => saveDraft(value))} onCancel={() => { setEditor(null); setError(""); }} />
    </View>}

    {settings.status === "ready" && !editor && <>
      {!settings.values.roles.some((role) => !role.removed) &&
        <Note theme={theme}>No roles yet. Create a role or import your existing instructions.</Note>}
      {settings.values.roles.filter((role) => !role.removed || showRemoved).map((role) => {
        const profile = catalog.data?.profiles.find((entry) => entry.id === role.profile.id);
        const status = catalog.data?.roles.find((entry) => entry.id === role.id);
        const providerLabel = catalog.data?.providers.find((entry) => entry.id === role.alias.sourceProvider)?.label ?? role.alias.sourceProvider;
        return <View key={role.id} style={section}>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 18 }}>
            {role.name}{role.removed ? " · Removed" : !role.enabled ? " · Disabled" : ""}
          </Text>
          <Note theme={theme}>Profile: {profile?.name ?? role.profile.template.name}{" · Provider: "}{providerLabel}</Note>
          {catalog.data?.profiles.some((entry) => entry.provider === role.alias.id && entry.id !== role.profile.id) &&
            <Note theme={theme}>Also used by profiles: {catalog.data.profiles.filter((entry) => entry.provider === role.alias.id && entry.id !== role.profile.id).map((entry) => entry.name).join(", ")}</Note>}
          <Note theme={theme} error={status ? !status.linked : false}>{status?.detail ?? "Checking profile link…"}</Note>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button theme={theme} label={role.removed ? "Restore role" : "Edit role"} onPress={() => open(undefined, role)} disabled={busy} />
            {!role.removed && <>
              <Button theme={theme} label={role.enabled ? "Disable" : "Enable"} disabled={busy}
                onPress={() => run(() => persist({ ...role, enabled: !role.enabled }, settings.revision))} />
              <Button theme={theme} label="Remove role" danger onPress={() => setRemoving(role)} disabled={busy} />
            </>}
            {status && !status.linked && <Button theme={theme} label="Retry profile linking" disabled={busy}
              onPress={() => run(async () => { await reconcile({ id: role.id, revision: settings.revision }); setNotice("Profile link verified."); })} />}
          </View>
          {removing?.id === role.id && <>
            <Note theme={theme}>Remove stops these instructions for new agents and restores the profile's original provider if it still uses this role. The profile and provider remain available; existing agents keep their instructions. Removed instructions stay here for export or restore.</Note>
            <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 8 }}>
              <Button theme={theme} label="Remove and unlink" danger disabled={busy}
                onPress={() => run(() => persist({ ...role, removed: true }, settings.revision))} />
              <Button theme={theme} label="Cancel removal" onPress={() => setRemoving(null)} disabled={busy} />
            </View>
          </>}
        </View>;
      })}
      {settings.values.roles.some((role) => role.removed) &&
        <Button theme={theme} label={showRemoved ? "Hide removed roles" : "Show removed roles"} onPress={() => setShowRemoved(!showRemoved)} />}
    </>}
    {transfer && !editor && <View style={section}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 18 }}>Import and export</Text>
      <Note theme={theme}>Backups include instructions and profile preferences, including removed roles. They exclude credentials and alias ownership. Import opens a draft for each role so you can choose its profile on this host.</Note>
      <Button theme={theme} label="Export all roles" disabled={busy || settings.status !== "ready"}
        onPress={() => { if (settings.status === "ready") setBackup(exportRoles(settings.values)); }} />
      {backup && <>
        <Field theme={theme} label="Role backup — select or copy this text" value={backup} onChange={() => {}} multiline />
        <Button theme={theme} label="Copy backup" onPress={() => run(async () => { await copyText(backup); setNotice("Backup copied. Save it outside Paseo before uninstalling."); })} disabled={busy} />
      </>}
      <Field theme={theme} label="Paste a role backup" value={importText} onChange={setImportText} multiline disabled={busy} />
      <Button theme={theme} label="Preview import" disabled={busy}
        onPress={() => run(async () => { setPreviews(parseBackup(importText)); })} />
      <Note theme={theme}>Migrate the file-based prototype from this daemon. The default location is $PASEO_HOME/agent-system-prompt/bindings.json; files are only read.</Note>
      <Field theme={theme} label="Legacy bindings path (optional)" value={legacyPath} onChange={setLegacyPath} disabled={busy} />
      <Button theme={theme} label="Read prototype files" disabled={busy}
        onPress={() => run(async () => { setPreviews((await readLegacy({ path: legacyPath || undefined })).roles); })} />
      <Button theme={theme} label="Preview bundled example prompts" disabled={busy}
        onPress={() => setPreviews(prototypeExamples)} />
      {previews.map((item, index) => <View key={index} style={{ gap: 8 }}>
        <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{item.name}{item.removed ? " (removed in backup)" : ""}</Text>
        <Note theme={theme}>{item.instructions.length} characters. Review the full instructions in the editor.</Note>
        <Button theme={theme} label={"Configure " + item.name} onPress={() => open(item)} disabled={busy || settings.status !== "ready" || !catalog.data} />
      </View>)}
    </View>}
  </View>;
}
