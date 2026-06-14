// The machine-readable source of truth for Sköll's spoken taunt library (ux-copy.md §2). Both the
// build-time generator (`scripts/skoll-voice.mjs`) and the runtime director (`skollDirector.ts`) read
// this one file, so the clip IDs, caption text, and bucket structure can never drift between the
// audio on disk and the code that plays it. Pure erasable TS (no $lib imports) so plain Node can load
// it through type-stripping for the generator.

/** A single spoken line. `id` is also its clip filename stem (`static/audio/skoll/<id>.pcm.b64`). */
export interface SkollVariant {
	id: string;
	/** The spoken words, verbatim — also the caption (R10: everything spoken is written). */
	text: string;
}

export type SkollBucketId =
	| 'night-opens'
	| 'hunt-far'
	| 'hunt-closing'
	| 'hunt-near'
	| 'wrong-cast'
	| 'hexed'
	| 'defeat-exit'
	| 'idle'
	| 'taunt'
	| 'winning-cast';

export interface SkollBucket {
	id: SkollBucketId;
	/** Human label for the trigger this bucket answers. */
	label: string;
	/**
	 * Whether P2 generates clips for this bucket. The engine-event buckets are generated and wired to
	 * the director now; idle (a client timer), taunt (needs a spoken input — P5), and winning-cast
	 * (names a dynamic `{Rune}`, stays text on his frame) are not. See architecture.md.
	 */
	generated: boolean;
	variants: SkollVariant[];
}

// The director's-notes wrapper handed to Gemini TTS with each line. The model speaks only the quoted
// line; the prefix shapes Algieba into his register (Cast Voice Charter — predatory, sardonic, cold).
export const SKOLL_TTS_DIRECTION =
	'Read this line as Sköll, the great wolf who hunts the sun. Low and predatory, sardonic — ' +
	'cold menace, like a growl, never shouting. Keep it brisk and clipped, no lingering. ' +
	'Speak only the line, no narration:';

/** The full TTS prompt for one line: the director's note plus the quoted line. */
export function ttsPrompt(text: string): string {
	return `${SKOLL_TTS_DIRECTION}\n\n"${text}"`;
}

export const SKOLL_SCRIPT: Record<SkollBucketId, SkollBucket> = {
	'night-opens': {
		id: 'night-opens',
		label: 'His first turn — the night opens',
		generated: true,
		variants: [
			{ id: 'night-opens-1', text: 'The night ends in my jaws.' },
			{ id: 'night-opens-2', text: 'I have hunted her for ages.' },
			{ id: 'night-opens-3', text: 'The sun knows how this ends.' }
		]
	},
	'hunt-far': {
		id: 'hunt-far',
		label: 'A later Sköll turn — his field still wide',
		generated: true,
		variants: [
			{ id: 'hunt-far-1', text: 'The scent is thin. It thickens.' },
			{ id: 'hunt-far-2', text: 'A wide field. I have run wider.' },
			{ id: 'hunt-far-3', text: 'Every answer trims the dark.' }
		]
	},
	'hunt-closing': {
		id: 'hunt-closing',
		label: 'A later Sköll turn — the field narrowing',
		generated: true,
		variants: [
			{ id: 'hunt-closing-1', text: 'Fewer places left to hide.' },
			{ id: 'hunt-closing-2', text: 'The trail warms underfoot.' },
			{ id: 'hunt-closing-3', text: 'I taste which one. Almost.' }
		]
	},
	'hunt-near': {
		id: 'hunt-near',
		label: 'A later Sköll turn — one or two left',
		generated: true,
		variants: [
			{ id: 'hunt-near-1', text: 'Two left. I need one.' },
			{ id: 'hunt-near-2', text: 'Close enough to hear her burn.' },
			{ id: 'hunt-near-3', text: 'One answer, and dawn is mine.' }
		]
	},
	'wrong-cast': {
		id: 'wrong-cast',
		label: 'The witch casts the wrong rune',
		generated: true,
		variants: [
			{ id: 'wrong-cast-1', text: 'Wrong rune. The night thanks you.' },
			{ id: 'wrong-cast-2', text: 'All that crossing, for that.' },
			{ id: 'wrong-cast-3', text: 'Spend your turns. I hunt.' }
		]
	},
	hexed: {
		id: 'hexed',
		label: 'The witch Hexes his Ask',
		generated: true,
		variants: [
			{ id: 'hexed-1', text: 'Silence her. My nose works.' },
			{ id: 'hexed-2', text: 'Clever. It saves you once.' },
			{ id: 'hexed-3', text: 'Kill the question. The trail remains.' }
		]
	},
	'defeat-exit': {
		id: 'defeat-exit',
		label: 'The witch wins — his one exit line',
		generated: true,
		variants: [{ id: 'defeat-exit-1', text: 'Keep your dawn, witch. Another year comes.' }]
	},
	// --- Deferred buckets: kept as the canonical text, not generated or wired in P2. ---
	idle: {
		id: 'idle',
		label: 'The witch hesitates (idle on her turn) — deferred (client timer)',
		generated: false,
		variants: [
			{ id: 'idle-1', text: 'You hesitate. I do not.' },
			{ id: 'idle-2', text: 'Count them again, slower.' },
			{ id: 'idle-3', text: 'The fire burns while you stare.' }
		]
	},
	taunt: {
		id: 'taunt',
		label: 'The witch taunts him — deferred to P5 (needs a spoken input)',
		generated: false,
		variants: [
			{ id: 'taunt-1', text: 'Bold words from prey.' },
			{ id: 'taunt-2', text: 'Save your breath for dawn.' },
			{ id: 'taunt-3', text: 'Louder ones have burned.' }
		]
	},
	'winning-cast': {
		id: 'winning-cast',
		label: 'His winning cast — stays text on his frame (names a {Rune})',
		generated: false,
		variants: [
			{ id: 'winning-cast-1', text: 'I name it. {Rune}.' },
			{ id: 'winning-cast-2', text: 'The hunt ends. {Rune}.' },
			{ id: 'winning-cast-3', text: '{Rune}! And the dawn dies with it.' }
		]
	}
};

/** Every clip the P2 generator should synthesize — the variants of the generated buckets, flattened. */
export function generatedClips(): SkollVariant[] {
	return Object.values(SKOLL_SCRIPT)
		.filter((bucket) => bucket.generated)
		.flatMap((bucket) => bucket.variants);
}
