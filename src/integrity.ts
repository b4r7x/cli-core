import { createHash } from "node:crypto";

// NOTE: Identical implementation exists in registry-kit/src/copy-bundle.ts.
// Intentionally duplicated: cli-core and registry-kit have no dependency relationship.
export function computeIntegrity(content: string): string {
  return "sha256-" + createHash("sha256").update(content).digest("hex");
}
