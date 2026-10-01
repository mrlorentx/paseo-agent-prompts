import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const providerId = z.string().regex(/^[a-z][a-z0-9-]*$/, "Choose a valid provider.");
export const instructions = z.string().max(131072, "Instructions must be at most 131,072 characters.")
  .refine((value) => value.trim().length > 0, "Write some standing instructions.");
export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: providerId,
  model: z.string().optional(),
  modeId: z.string().optional(),
  thinkingOptionId: z.string().optional(),
  featureValues: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
}).passthrough();

export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Give the role a name.").max(100),
  instructions,
  enabled: z.boolean(),
  removed: z.boolean().default(false),
  alias: z.object({
    id: providerId,
    sourceProvider: providerId,
    extends: providerId,
    ownership: z.enum(["created", "adopted"]),
    fingerprint: z.string(),
    sourceFingerprint: z.string(),
    label: z.string(),
  }),
  profile: z.object({
    id: z.string().min(1),
    ownership: z.enum(["created", "adopted"]),
    restoreProvider: providerId,
    expectedProvider: providerId,
    template: profileSchema,
  }),
});
export type Role = z.infer<typeof roleSchema>;
export type Profile = z.infer<typeof profileSchema>;

export const storeSchema = z.object({
  roles: z.array(roleSchema).max(200).default([]),
}).superRefine(({ roles }, ctx) => {
  for (const field of ["id", "alias", "profile"] as const) {
    const used = new Set<string>();
    for (const role of roles) {
      if (field === "profile" && role.removed) continue;
      const value = field === "id" ? role.id : role[field].id;
      if (used.has(value)) ctx.addIssue({ code: "custom", message: `Duplicate role ${field}: ${value}` });
      used.add(value);
    }
  }
});
export type RoleStore = z.infer<typeof storeSchema>;
export const roleSettings = defineSettings({
  id: "roles", scope: "host", version: 1, schema: storeSchema,
});

export const draftSchema = z.object({
  id: z.string().uuid().optional(),
  name: roleSchema.shape.name,
  instructions,
  enabled: z.boolean(),
  profileId: z.string().optional(),
  profileProvider: providerId.optional(),
  newProfile: profileSchema.omit({ id: true }).extend({
    name: z.string().trim().min(1, "Give the profile a name.").max(100),
  }).optional(),
  adoptAlias: providerId.optional(),
  relink: z.boolean().default(false),
  adoptChanges: z.boolean().default(false),
});
export type RoleDraft = z.infer<typeof draftSchema>;

export const portableRoleSchema = z.object({
  id: z.string().uuid().optional(),
  name: roleSchema.shape.name,
  instructions,
  enabled: z.boolean().default(true),
  removed: z.boolean().default(false),
  profile: z.object({
    name: z.string(), provider: providerId,
    model: z.string().optional(), modeId: z.string().optional(),
    thinkingOptionId: z.string().optional(),
    featureValues: z.record(z.string(), z.unknown()).optional(),
    notes: z.string().optional(),
  }).optional(),
  suggestedAlias: providerId.optional(),
});
export type PortableRole = z.infer<typeof portableRoleSchema>;
export const backupSchema = z.object({
  format: z.literal("paseo-role-instructions"), version: z.literal(1),
  roles: z.array(portableRoleSchema).max(200),
});

export function exportRoles(store: RoleStore): string {
  return JSON.stringify({
    format: "paseo-role-instructions", version: 1,
    roles: store.roles.map((role) => {
      const { name, model, modeId, thinkingOptionId, featureValues, notes } = role.profile.template;
      return {
        id: role.id, name: role.name, instructions: role.instructions,
        enabled: role.enabled, removed: role.removed,
        profile: { name, provider: role.alias.sourceProvider, model, modeId, thinkingOptionId, featureValues, notes },
      };
    }),
  }, null, 2);
}

export function replaceRole(store: RoleStore, role: Role): RoleStore {
  return storeSchema.parse({
    roles: store.roles.some((entry) => entry.id === role.id)
      ? store.roles.map((entry) => entry.id === role.id ? role : entry)
      : [...store.roles, role],
  });
}

export function parseBackup(text: string): PortableRole[] {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error("This is not a valid role backup. Paste the complete text from Export all roles."); }
  const parsed = backupSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Cannot import this backup: " + parsed.error.issues
      .map((issue) => (issue.path.length ? issue.path.join(".") + ": " : "") + issue.message).join("\n"));
  }
  return parsed.data.roles;
}
