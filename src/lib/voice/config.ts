// Shared (non-secret) voice constants. Lives outside lib/server because the Live client must
// connect with the exact model the ephemeral token was constrained to — one constant, two sides.
export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';

// Verified on the Live model against the real API (2026-06-11) — no Kore fallback needed.
export const ORACLE_VOICE = 'Gacrux';

// Live API audio contract: PCM16 mono, 16kHz up, 24kHz down. Not tunable.
export const MIC_SAMPLE_RATE = 16_000;
export const SPEAKER_SAMPLE_RATE = 24_000;
