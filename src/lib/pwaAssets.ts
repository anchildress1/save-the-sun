export const PWA_ASSET_VERSION = '2026-06-10-image-perf';

export function versionedPwaAsset(path: string) {
	return `${path}?v=${PWA_ASSET_VERSION}`;
}
