export const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';

export function cachedAsset(response: Response, contentType: string) {
	// A failed read must never be relabeled as a valid image and frozen for a year —
	// an immutable-cached error body is unrecoverable client-side until the URL changes.
	if (!response.ok || !response.body) {
		console.error(`[cache] asset read failed (${response.status} ${response.statusText})`);
		return new Response(null, { status: 502, statusText: 'Asset Unavailable' });
	}
	const headers = new Headers(response.headers);
	headers.set('cache-control', IMMUTABLE_ASSET_CACHE);
	headers.set('content-type', contentType);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}
