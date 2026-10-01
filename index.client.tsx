import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RoleSettingsScreen } from "./client/settings.tsx";

export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "roles", title: "Role instructions", icon: "NotebookPen", Component: RoleSettingsScreen,
  });
}
