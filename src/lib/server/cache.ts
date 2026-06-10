export const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';

export function cachedAsset(response: Response, contentType: string) {
	const headers = new Headers(response.headers);
	headers.set('cache-control', IMMUTABLE_ASSET_CACHE);
	headers.set('content-type', contentType);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
