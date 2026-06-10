import { json } from '@sveltejs/kit';
import { IMMUTABLE_ASSET_CACHE } from '$lib/server/cache';
import { versionedPwaAsset } from '$lib/pwaAssets';

export function GET() {
	return json(
		{
			name: 'Save the Sun',
			short_name: 'Save the Sun',
			icons: [
				{
					src: versionedPwaAsset('/icon-192.png'),
					sizes: '192x192',
					type: 'image/png'
				},
				{
					src: versionedPwaAsset('/icon-512.png'),
					sizes: '512x512',
					type: 'image/png'
				}
			],
			theme_color: '#060912',
			background_color: '#060912',
			display: 'standalone'
		},
		{
			headers: {
				'cache-control': IMMUTABLE_ASSET_CACHE,
				'content-type': 'application/manifest+json'
			}
		}
	);
}
