import { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { usePaseo, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import type { RpcOutput } from "@getpaseo/plugin";
import { catalogRpc } from "../shared/rpc.ts";
import { draftSchema, type PortableRole, type Role, type RoleDraft } from "../shared/roles.ts";
import { Button, Field, Note } from "./controls.tsx";

export type Catalog = RpcOutput<typeof catalogRpc>;
export type EditorDraft = {
  revision: string;
  role?: Role;
  imported?: PortableRole;
};

export function RoleEditor({ theme, layout, catalog, draft, busy, onSave, onCancel }: PluginSurfaceProps & {
  catalog: Catalog; draft: EditorDraft; busy: boolean;
  onSave: (value: RoleDraft) => void; onCancel: () => void;
}) {
  const paseo = usePaseo();
  const source = draft.role ?? draft.imported;
  const suggestedAlias = draft.imported?.suggestedAlias;
  const suggestedProfile = suggestedAlias ? catalog.profiles.find((profile) => profile.provider === suggestedAlias) : undefined;
  const [name, setName] = useState(source?.name ?? "");
  const [text, setText] = useState(source?.instructions ?? "");
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [kind, setKind] = useState(suggestedProfile ? "existing" : draft.imported ? "new" : catalog.profiles.length ? "existing" : "new");
  const [profileId, setProfileId] = useState(suggestedProfile?.id ?? "");
  const [profileName, setProfileName] = useState(draft.imported?.profile?.name ?? source?.name ?? "");
  const [provider, setProvider] = useState(draft.imported?.profile?.provider ??
    catalog.providers.find((entry) => entry.id === suggestedAlias)?.extends ?? "");
  const [model, setModel] = useState(draft.imported?.profile?.model ?? "");
  const [mode, setMode] = useState(draft.imported?.profile?.modeId ?? "");
  const [thinking, setThinking] = useState(draft.imported?.profile?.thinkingOptionId ?? "");
  const [features, setFeatures] = useState<Record<string, unknown>>(draft.imported?.profile?.featureValues ?? {});
  const [alias, setAlias] = useState(suggestedAlias && catalog.providers.some((entry) => entry.id === suggestedAlias && entry.extends) ? suggestedAlias : "");
  const [advanced, setAdvanced] = useState(Boolean(alias));
  const [relink, setRelink] = useState(false);
  const [adoptChanges, setAdoptChanges] = useState(false);
  const [error, setError] = useState("");
  const selected = catalog.profiles.find((entry) => entry.id === profileId);
  const providerId = kind === "existing" ? selected?.provider ?? "" : provider;
  const models = useQuery({
    queryKey: ["role-models", providerId], enabled: !draft.role && kind === "new" && Boolean(providerId),
    queryFn: async () => {
      const result = await paseo.providers.listModels(providerId);
      if (result.error) throw new Error(result.error);
      return result.models ?? [];
    },
  });
  const modes = useQuery({
    queryKey: ["role-modes", providerId], enabled: !draft.role && kind === "new" && Boolean(providerId),
    queryFn: async () => {
      const result = await paseo.providers.listModes(providerId);
      if (result.error) throw new Error(result.error);
      return result.modes ?? [];
    },
  });
  const featureQuery = useQuery({
    queryKey: ["role-features", providerId, model, mode, thinking, features],
    enabled: !draft.role && kind === "new" && Boolean(providerId),
    queryFn: async () => {
      const result = await paseo.providers.listFeatures({
        cwd: catalog.discoveryCwd,
        provider: model ? providerId + "/" + model : providerId,
        modeId: mode || undefined, thinkingOptionId: thinking || undefined, featureValues: features,
      });
      if (result.error) throw new Error(result.error);
      return result.features ?? [];
    },
  });
  const options = (items: { id: string; label: string }[] | undefined, value: string, fallback: string) => [
    { value: "", label: fallback },
    ...(items ?? []).map((entry) => ({ value: entry.id, label: entry.label })),
    ...(value && !items?.some((entry) => entry.id === value) ? [{ value, label: value + " (saved)" }] : []),
  ];
  function save() {
    const parsed = draftSchema.safeParse({
      id: draft.role?.id ?? draft.imported?.id, name, instructions: text, enabled, relink, adoptChanges,
      ...(!draft.role ? kind === "existing" ? { profileId, profileProvider: selected?.provider, adoptAlias: alias || undefined } : {
        adoptAlias: alias || undefined,
        newProfile: {
          name: profileName.trim() || name, provider, model: model || undefined, modeId: mode || undefined,
          thinkingOptionId: thinking || undefined, featureValues: features,
          notes: draft.imported?.profile?.notes,
        },
      } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join("\n"));
      return;
    }
    if (!draft.role && kind === "existing" && !profileId) {
      setError("Choose a profile to link."); return;
    }
    setError(""); onSave(parsed.data);
  }
  return <View style={{ gap: 16 }}>
    <Field theme={theme} label="Role name" value={name} onChange={setName} disabled={busy} />
    {draft.role ? <>
      <Note theme={theme}>Profile: {catalog.profiles.find((entry) => entry.id === draft.role?.profile.id)?.name ?? draft.role.profile.template.name}
        {" · Provider: "}{catalog.providers.find((entry) => entry.id === draft.role?.alias.sourceProvider)?.label ?? draft.role.alias.sourceProvider}</Note>
      <SettingsSwitch label="Restore profile link" value={relink} disabled={busy}
        hint="Use this after changing the profile provider elsewhere. Save will restore the role provider and preserve the profile's current model, mode, thinking and features."
        onValueChange={setRelink} />
    </> : <>
      <SettingsSelect label="Profile" value={kind} disabled={busy}
        options={[{ value: "existing", label: "Use an existing profile" }, { value: "new", label: "Create a new profile" }]}
        onValueChange={setKind} />
      {kind === "existing" ? <>
        <SettingsSelect label="Choose profile" value={profileId} disabled={busy}
          options={[{ value: "", label: "Select a profile" }, ...catalog.profiles
            .filter((entry) => !catalog.providers.find((p) => p.id === entry.provider)?.managed)
            .map((entry) => ({ value: entry.id, label: entry.name + " · " + (catalog.providers.find((p) => p.id === entry.provider)?.label ?? entry.provider) }))]}
          onValueChange={(value) => { setProfileId(value); setAlias(""); }} />
        <Note theme={theme}>Save links this profile to the role and keeps all its other settings. Other profiles are preserved.</Note>
      </> : <>
        <Field theme={theme} label="New profile name (defaults to role name)" value={profileName} onChange={setProfileName} disabled={busy} />
        <SettingsSelect label="Provider" value={provider} disabled={busy}
          options={[{ value: "", label: "Select a provider" }, ...catalog.providers.filter((entry) => !entry.managed)
            .map((entry) => ({ value: entry.id, label: entry.label + (entry.available ? "" : " (unavailable)") }))]}
          onValueChange={(value) => { setProvider(value); setModel(""); setMode(""); setThinking(""); setFeatures({}); setAlias(""); }} />
        <SettingsSelect label="Model" value={model} options={options(models.data, model, "Provider default")} disabled={busy}
          onValueChange={(value) => { setModel(value); setThinking(""); }} />
        <SettingsSelect label="Mode" value={mode}
          options={options(modes.data?.map((entry) => ({ id: entry.id, label: entry.label })), mode, "Provider default")}
          disabled={busy} onValueChange={setMode} />
        <SettingsSelect label="Thinking" value={thinking}
          options={options(models.data?.find((entry) => entry.id === model)?.thinkingOptions, thinking, "Provider default")}
          disabled={busy} onValueChange={setThinking} />
        {featureQuery.data?.map((feature) => feature.type === "toggle"
          ? <SettingsSwitch key={feature.id} label={feature.label} disabled={busy}
              value={typeof features[feature.id] === "boolean" ? features[feature.id] as boolean : feature.value}
              onValueChange={(value) => setFeatures({ ...features, [feature.id]: value })} />
          : <SettingsSelect key={feature.id} label={feature.label} disabled={busy}
              value={typeof features[feature.id] === "string" ? features[feature.id] as string : feature.value ?? ""}
              options={options(feature.options, "", "Provider default")}
              onValueChange={(value) => { const next = { ...features }; if (value) next[feature.id] = value; else delete next[feature.id]; setFeatures(next); }} />)}
        {[models.error, modes.error, featureQuery.error].filter(Boolean).map((entry, index) =>
          <Note key={index} theme={theme} error>{entry?.message}</Note>)}
      </>}
    </>}
    <Field theme={theme} label="Standing instructions (Markdown)" value={text} onChange={setText} multiline disabled={busy} />
    <Note theme={theme}>Saved instructions apply when creating a new agent. Existing sessions keep their captured instructions.</Note>
    <SettingsSwitch label="Apply instructions to new agents" value={enabled} onValueChange={setEnabled} disabled={busy} />
    <Button theme={theme} label={advanced ? "Hide advanced details" : "Advanced details"} onPress={() => setAdvanced(!advanced)} />
    {advanced && (draft.role ? <>
      <Note theme={theme}>
        Role ID: {draft.role.id}{"\n"}Provider alias: {draft.role.alias.id} ({draft.role.alias.ownership})
        {"\n"}Profile ID: {draft.role.profile.id} ({draft.role.profile.ownership})
      </Note>
      <SettingsSwitch label="Adopt current provider options" value={adoptChanges} onValueChange={setAdoptChanges} disabled={busy}
        hint="Use only after reviewing provider changes made in Paseo. This accepts the current alias with the same base provider and keeps its options intact." />
    </> : <>
      <SettingsSelect label="Provider alias" value={alias} disabled={busy}
        options={[{ value: "", label: "Create automatically" },
          ...catalog.providers.filter((entry) => entry.extends && !entry.managed)
            .map((entry) => ({ value: entry.id, label: entry.label + " · " + entry.id }))]}
        onValueChange={setAlias} />
      {alias && <Note theme={theme}>Adopting this provider applies instructions to every new agent using it, including other profiles and schedules. Its credentials and options are kept.</Note>}
    </>)}
    {error && <Note theme={theme} error>{error}</Note>}
    <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 8 }}>
      <Button theme={theme} label={busy ? "Saving…" : "Save role"} onPress={save} disabled={busy} />
      <Button theme={theme} label="Cancel" onPress={onCancel} disabled={busy} />
    </View>
  </View>;
}
