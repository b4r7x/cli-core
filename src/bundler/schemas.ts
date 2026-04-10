import { z } from "zod";
import { RegistryItemSchema } from "../registry.js";

export const RegistrySourceFileSchema = z.object({
  path: z.string(),
  type: z.string().optional(),
});

export const RegistrySourceItemSchema = RegistryItemSchema.extend({
  files: z.array(RegistrySourceFileSchema),
});

export const RegistrySourceSchema = z.object({
  items: z.array(RegistrySourceItemSchema),
});

export type RegistrySourceItem = z.infer<typeof RegistrySourceItemSchema>;
