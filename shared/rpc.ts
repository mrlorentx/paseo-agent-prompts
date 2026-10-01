import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { draftSchema, portableRoleSchema, profileSchema, roleSchema } from "./roles.ts";

export const catalogRpc = defineRpc({
  name: "roles.catalog",
  input: z.object({}),
  output: z.object({
    discoveryCwd: z.string(),
    profiles: z.array(profileSchema),
    providers: z.array(z.object({
      id: z.string(), label: z.string(), available: z.boolean(),
      extends: z.string().optional(), managed: z.boolean(),
    })),
    roles: z.array(z.object({ id: z.string(), linked: z.boolean(), detail: z.string() })),
  }),
});
export const prepareRpc = defineRpc({
  name: "roles.prepare",
  input: z.object({ revision: z.string(), draft: draftSchema }),
  output: roleSchema,
});
export const reconcileRpc = defineRpc({
  name: "roles.reconcile",
  input: z.object({ id: z.string().uuid(), revision: z.string() }),
  output: z.object({ linked: z.literal(true) }),
});
export const legacyRpc = defineRpc({
  name: "roles.legacy",
  input: z.object({ path: z.string().optional() }),
  output: z.object({ roles: z.array(portableRoleSchema) }),
});
