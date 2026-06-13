/** The viewed session for a /debug request: a non-empty trimmed ?session overrides the cookie. */
export function resolveSessionId(url: URL, fallback: string): string {
	const requested = url.searchParams.get('session')?.trim();
	return requested ? requested : fallback;
}
