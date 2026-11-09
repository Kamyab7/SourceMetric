import { AppError } from '../platform/errors';
import { NuGetProvider } from './nuget/provider';
import type { PackageProvider, ProviderDependencies } from './contracts';
const registry: Record<string, (deps: ProviderDependencies) => PackageProvider> = {
  nuget: (deps) => new NuGetProvider(deps),
};
export function createPackageProvider(
  id: string,
  deps: ProviderDependencies = { fetch: globalThis.fetch.bind(globalThis) },
): PackageProvider {
  const create = Object.hasOwn(registry, id) ? registry[id] : undefined;
  if (!create)
    throw new AppError(400, 'UNSUPPORTED_PROVIDER', 'This package registry is not supported.');
  return create(deps);
}
