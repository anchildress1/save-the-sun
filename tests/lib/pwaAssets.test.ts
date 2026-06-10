import { describe, it, expect } from 'vitest';
import { versionedPwaAsset, PWA_ASSET_VERSION } from '$lib/pwaAssets';

describe('versionedPwaAsset', () => {
	it('appends the asset version as a cache-busting query — the contract the manifest + <link>s rely on', () => {
		expect(versionedPwaAsset('/icon-192.png')).toBe(`/icon-192.png?v=${PWA_ASSET_VERSION}`);
	});
});
