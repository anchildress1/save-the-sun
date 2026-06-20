import type { LineDescriptor } from '$lib/server/voice/lines';
import { SKOLL_VOICE } from '$lib/voice/config';

/** The two delivery-layer voice tags the medallion mirrors (distinct from the prebuilt VoiceId). */
export type DeliveryVoice = 'oracle' | 'skoll';

/**
 * The single who-speaks rule, read by BOTH the server TTS route (voiceForLine) and the client
 * medallion (delivery) so the two can never disagree. Type-only descriptor import keeps it client-safe.
 */
export function speakerOf(descriptor: LineDescriptor): DeliveryVoice {
	if (descriptor.kind === 'authored') return descriptor.voice === SKOLL_VOICE ? 'skoll' : 'oracle';
	if (descriptor.kind === 'skoll-ask' || descriptor.kind === 'skoll-cast') return 'skoll';
	if (descriptor.kind === 'outcome' && descriptor.result === 'lose') return 'skoll';
	return 'oracle';
}
