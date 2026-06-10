import { read } from '$app/server';
import icon from '$lib/manifest-icons/icon-512.png';
import { cachedAsset } from '$lib/server/cache';

export function GET() {
	return cachedAsset(read(icon), 'image/png');
}
