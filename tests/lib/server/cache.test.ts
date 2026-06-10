import { describe, it, expect, vi } from 'vitest';
import { cachedAsset, IMMUTABLE_ASSET_CACHE } from '$lib/server/cache';

describe('cachedAsset', () => {
	it('stamps the immutable cache header and overrides the content-type', async () => {
		const source = new Response('bytes', {
			status: 200,
			headers: { 'content-type': 'application/octet-stream' }
		});
		const res = cachedAsset(source, 'image/png');
		expect(res.headers.get('cache-control')).toBe(IMMUTABLE_ASSET_CACHE);
		expect(res.headers.get('content-type')).toBe('image/png');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('bytes');
	});

	it('refuses to cache or relabel a non-OK read — no immutable header, no image content-type', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = cachedAsset(new Response('not found', { status: 404 }), 'image/png');
		expect(res.status).toBe(502);
		expect(res.headers.get('cache-control')).toBeNull();
		expect(res.headers.get('content-type')).not.toBe('image/png');
		expect(err).toHaveBeenCalledOnce();
		err.mockRestore();
	});

	it('refuses an OK-but-bodyless read rather than caching an empty image for a year', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = cachedAsset(new Response(null, { status: 200 }), 'image/png');
		expect(res.status).toBe(502);
		expect(res.headers.get('cache-control')).toBeNull();
		expect(err).toHaveBeenCalledOnce();
		err.mockRestore();
	});
});
