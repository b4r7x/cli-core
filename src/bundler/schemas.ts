import { z } from "zod";

export const RegistrySourceFileSchema = z.object({
  path: z.string(),
  type: z.string().optional(),
});

export const RegistrySourceItemSchema = z.object({
  name: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  dependencies: z.array(z.string()).optional().default([]),
  registryDependencies: z.array(z.string()).optional().default([]),
  files: z.array(RegistrySourceFileSchema),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const RegistrySourceSchema = z.object({
  items: z.array(RegistrySourceItemSchema),
});

export type RegistrySourceItem = z.infer<typeof RegistrySourceItemSchema>;
