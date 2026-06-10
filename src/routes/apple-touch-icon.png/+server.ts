import { read } from '$app/server';
import icon from '$lib/manifest-icons/apple-touch-icon.png';
import { cachedAsset } from '$lib/server/cache';

export function GET() {
	return cachedAsset(read(icon), 'image/png');
}
