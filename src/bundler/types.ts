export interface BundleFile {
  path: string;
  content: string;
}

export interface BundleItem {
  name: string;
  type: string;
  title: string;
  description: string;
  dependencies: string[];
  registryDependencies: string[];
  files: BundleFile[];
  meta?: Record<string, unknown>;
}

export interface BundlerConfig {
  rootDir: string;
  outputPath: string;
  peerDeps?: Set<string>;
  /** Deps to strip from auto-detected dependencies (e.g. cva, clsx that ship with the project). */
  coreDeps?: Set<string>;
  aliasPrefixes?: string[];
  transformPath?: (path: string) => string;
  /** Return extra top-level fields to merge into the bundle JSON (e.g. theme, styles). */
  extraContent?: (rootDir: string) => Record<string, unknown>;
  clientDefault?: boolean;
  itemLabel?: string;
}

export interface BundleResult {
  items: BundleItem[];
  integrity: string;
  extra: Record<string, unknown>;
}
