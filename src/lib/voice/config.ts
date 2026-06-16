// Shared (non-secret) voice constants.

// The Oracle's TTS voice. One swappable value.
export const ORACLE_VOICE = 'Gacrux'; // Aoede, Callirrhoe, Gacrux

// Sköll's voice. His game-move lines (his Ask) are voiced through the same server TTS route as the
// Oracle, just with this voice — first-person, predatory (Cast Voice Charter). One swappable value.
export const SKOLL_VOICE = 'Algieba'; // smooth — distinct from the Oracle's Gacrux

// Server-side TTS delivery (voice-as-delivery, P1): the Oracle's lines are synthesized key-side
// here instead of streamed from a Live session. Returns PCM16 mono @ SPEAKER_SAMPLE_RATE.
export const TTS_MODEL = 'gemini-3.1-flash-tts-preview';

// Push-to-talk transcription: a held recording (WAV) is sent to this model server-side and turned
// into the player's Ask text. A general flash model with audio understanding — one swappable value.
export const STT_MODEL = 'gemini-3.5-flash';

// PCM16 mono audio contract: 16kHz for captured speech (push-to-talk), 24kHz for TTS playback.
export const MIC_SAMPLE_RATE = 16_000;
export const SPEAKER_SAMPLE_RATE = 24_000;
