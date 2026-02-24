export interface BundleFile {
  path: string;
  content: string;
  targetPath?: string;
  type?: string;
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
  /** Absolute path to the project root (where registry/ lives). */
  rootDir: string;
  /** Absolute path to output the bundle JSON. */
  outputPath: string;
  /** Peer deps to exclude from npm import detection. */
  peerDeps?: Set<string>;
  /** Core deps to strip from detected dependencies (e.g. cva, clsx). */
  coreDeps?: Set<string>;
  /** Import path prefixes to skip during npm import detection. */
  aliasPrefixes?: string[];
  /** Optional path rewriting for bundle file paths. */
  transformPath?: (path: string) => string;
  /** Return extra top-level fields to include in the bundle (e.g. theme, styles). */
  extraContent?: (rootDir: string) => Record<string, unknown>;
  /** Default value for the `client` field when not specified. */
  clientDefault?: boolean;
  /** Label for items in error messages (e.g. "hook", "component"). */
  itemLabel?: string;
}

export interface BundleResult {
  items: BundleItem[];
  integrity: string;
  extra: Record<string, unknown>;
}
