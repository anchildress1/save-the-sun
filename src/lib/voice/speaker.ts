import type { LineDescriptor } from '$lib/server/voice/lines';
import { SKOLL_VOICE } from '$lib/voice/config';

/**
 * Which character voices a line — Sköll's Ask, his winning cast, the loss outcome, and any line
 * authored in his voice are his; everything else the Oracle's. The ONE rule the server TTS route
 * (`voiceForLine`) and the client medallion (`delivery`) both read, so they can never disagree about
 * who is speaking. Type-only import of the descriptor shape keeps this client-safe.
 */
/** The two delivery-layer voice tags the medallion mirrors (distinct from the prebuilt VoiceId). */
export type DeliveryVoice = 'oracle' | 'skoll';

export function speakerOf(descriptor: LineDescriptor): DeliveryVoice {
	if (descriptor.kind === 'authored') return descriptor.voice === SKOLL_VOICE ? 'skoll' : 'oracle';
	if (descriptor.kind === 'skoll-ask' || descriptor.kind === 'skoll-cast') return 'skoll';
	if (descriptor.kind === 'outcome' && descriptor.result === 'lose') return 'skoll';
	return 'oracle';
}
