import type { ReactNode } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { Pressable, Text, TextInput, View } from "react-native";

export function Button({ theme, label, onPress, disabled = false, danger = false }: {
  theme: PluginTheme; label: string; onPress: () => void; disabled?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 10,
      borderWidth: 1, borderColor: danger ? theme.colors.statusDanger : theme.colors.border,
      borderRadius: 8, backgroundColor: theme.colors.surface1, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: danger ? theme.colors.statusDanger : theme.colors.foreground }}>{label}</Text>
  </Pressable>;
}
export function Field({ theme, label, value, onChange, multiline = false, disabled = false }: {
  theme: PluginTheme; label: string; value: string; onChange: (value: string) => void;
  multiline?: boolean; disabled?: boolean;
}) {
  return <View style={{ gap: 6 }}>
    <Text style={{ color: theme.colors.foreground }}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled}
      multiline={multiline} autoCapitalize={multiline ? "sentences" : "none"} autoCorrect={multiline}
      textAlignVertical={multiline ? "top" : "center"} placeholderTextColor={theme.colors.foregroundMuted}
      style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border, borderWidth: 1, borderRadius: 8, padding: 12,
        minHeight: multiline ? 240 : 44, fontSize: 15, lineHeight: 22 }} />
  </View>;
}
export function Note({ theme, children, error = false }: { theme: PluginTheme; children: ReactNode; error?: boolean }) {
  return <Text accessibilityRole={error ? "alert" : undefined}
    style={{ color: error ? theme.colors.statusDanger : theme.colors.foregroundMuted, lineHeight: 21 }}>
    {children}
  </Text>;
}
