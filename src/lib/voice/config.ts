// Shared (non-secret) voice constants. Lives outside lib/server because the Live client must
// connect with the exact model the ephemeral token was constrained to — one constant, two sides.
export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
