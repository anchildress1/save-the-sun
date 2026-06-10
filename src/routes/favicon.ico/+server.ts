import { read } from '$app/server';
import icon from '$lib/manifest-icons/favicon.ico';
import { cachedAsset } from '$lib/server/cache';

export function GET() {
	return cachedAsset(read(icon), 'image/x-icon');
}
