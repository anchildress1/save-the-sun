import { read } from '$app/server';
import icon from '$lib/manifest-icons/favicon-16x16.png';
import { cachedAsset } from '$lib/server/cache';

export function GET() {
	return cachedAsset(read(icon), 'image/png');
}
