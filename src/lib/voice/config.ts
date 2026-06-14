// Shared (non-secret) voice constants. Lives outside lib/server because the Live client must
// connect with the exact model the ephemeral token was constrained to — one constant, two sides.
export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';

// Confirmed available on LIVE_MODEL by a real connect — re-verify if the model changes.
// No Kore fallback needed.
export const ORACLE_VOICE = 'Gacrux'; // Aoede, Callirrhoe, Gacrux

// Sköll's voice. His game-move lines (his Ask) are voiced through the same server TTS route as the
// Oracle, just with this voice — first-person, predatory (Cast Voice Charter). One swappable value.
export const SKOLL_VOICE = 'Algieba'; // smooth — distinct from the Oracle's Gacrux

// Server-side TTS delivery (voice-as-delivery, P1): the Oracle's lines are synthesized key-side
// here instead of streamed from a Live session. Returns PCM16 mono @ SPEAKER_SAMPLE_RATE.
export const TTS_MODEL = 'gemini-3.1-flash-tts-preview';

// Live API audio contract: PCM16 mono, 16kHz up, 24kHz down. Not tunable.
export const MIC_SAMPLE_RATE = 16_000;
export const SPEAKER_SAMPLE_RATE = 24_000;
