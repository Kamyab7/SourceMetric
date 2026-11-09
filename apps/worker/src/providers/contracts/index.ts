export interface ProviderCapabilities {
  packageDownloads: 'cumulative' | 'interval';
  versionDownloads: boolean;
  prereleases: boolean;
}
export interface PackageMetadata {
  canonicalId: string;
  displayName: string;
  description: string;
  latestStable: string | null;
  latestPrerelease: string | null;
  versions: { version: string; prerelease: boolean; downloads: number | null }[];
}
export interface ProviderObservation {
  provider: string;
  canonicalId: string;
  metric: 'downloads';
  scope: 'package' | 'version';
  version?: string;
  kind: 'cumulative' | 'interval';
  value: number | null;
  observedAt: string;
  intervalStart?: string;
  intervalEnd?: string;
  availability: 'available' | 'unavailable';
  quality: 'source' | 'unavailable';
}
export interface CollectionResult {
  metadata: PackageMetadata;
  observations: ProviderObservation[];
}
export interface PackageProvider {
  readonly id: string;
  capabilities(): ProviderCapabilities;
  resolve(packageId: string): Promise<PackageMetadata>;
  metadata(packageId: string): Promise<PackageMetadata>;
  collect(packageId: string, observedAt: string): Promise<CollectionResult>;
}
export interface ProviderDependencies {
  fetch: typeof fetch;
}
