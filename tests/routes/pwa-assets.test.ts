import { describe, it, expect, vi } from 'vitest';

// read() resolves a built asset to a Response at runtime; mock it so the route tests assert the
// route's own wiring (which content-type goes with which asset) without touching the filesystem.
// A fresh Response per call — a body can only be consumed once.
vi.mock('$app/server', () => ({
	read: vi.fn(() => new Response('icon-bytes', { status: 200 }))
}));

import { GET as appleTouch } from '$routes/apple-touch-icon.png/+server';
import { GET as favicon16 } from '$routes/favicon-16x16.png/+server';
import { GET as favicon32 } from '$routes/favicon-32x32.png/+server';
import { GET as faviconIco } from '$routes/favicon.ico/+server';
import { GET as icon192 } from '$routes/icon-192.png/+server';
import { GET as icon512 } from '$routes/icon-512.png/+server';
import { GET as webmanifest } from '$routes/site.webmanifest/+server';
import { IMMUTABLE_ASSET_CACHE } from '$lib/server/cache';
import { PWA_ASSET_VERSION } from '$lib/pwaAssets';

// The bug class across six near-identical files is a copy-paste content-type mismatch — favicon.ico
// handed image/png, two routes wired to the same icon. Pin each route to its expected type.
const imageRoutes = [
	{ name: 'apple-touch-icon.png', get: appleTouch, type: 'image/png' },
	{ name: 'favicon-16x16.png', get: favicon16, type: 'image/png' },
	{ name: 'favicon-32x32.png', get: favicon32, type: 'image/png' },
	{ name: 'favicon.ico', get: faviconIco, type: 'image/x-icon' },
	{ name: 'icon-192.png', get: icon192, type: 'image/png' },
	{ name: 'icon-512.png', get: icon512, type: 'image/png' }
] as const;

describe('PWA image asset routes', () => {
	it.each(imageRoutes)(
		'$name serves its asset with $type and immutable caching',
		({ get, type }) => {
			const res = get();
			expect(res.headers.get('content-type')).toBe(type);
			expect(res.headers.get('cache-control')).toBe(IMMUTABLE_ASSET_CACHE);
			expect(res.status).toBe(200);
		}
	);
});

describe('GET /site.webmanifest', () => {
	it('serves a manifest with version-busted icon URLs', async () => {
		const res = webmanifest();
		expect(res.headers.get('content-type')).toBe('application/manifest+json');
		expect(res.headers.get('cache-control')).toBe(IMMUTABLE_ASSET_CACHE);

		const body = await res.json();
		expect(body.icons).toEqual([
			{ src: `/icon-192.png?v=${PWA_ASSET_VERSION}`, sizes: '192x192', type: 'image/png' },
			{ src: `/icon-512.png?v=${PWA_ASSET_VERSION}`, sizes: '512x512', type: 'image/png' }
		]);
	});
});
