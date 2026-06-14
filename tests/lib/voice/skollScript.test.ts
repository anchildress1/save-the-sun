import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	SKOLL_SCRIPT,
	SKOLL_TTS_DIRECTION,
	ttsPrompt,
	generatedClips,
	type SkollBucketId
} from '$lib/voice/skollScript';

const GENERATED: SkollBucketId[] = [
	'night-opens',
	'hunt-far',
	'hunt-closing',
	'hunt-near',
	'wrong-cast',
	'hexed',
	'defeat-exit'
];
const DEFERRED: SkollBucketId[] = ['idle', 'taunt', 'winning-cast'];

describe('skollScript', () => {
	it('marks exactly the engine-event buckets as generated', () => {
		for (const id of GENERATED) expect(SKOLL_SCRIPT[id].generated).toBe(true);
		for (const id of DEFERRED) expect(SKOLL_SCRIPT[id].generated).toBe(false);
	});

	it('gives every variant a unique, non-empty id and caption', () => {
		const ids = new Set<string>();
		for (const bucket of Object.values(SKOLL_SCRIPT)) {
			for (const v of bucket.variants) {
				expect(v.id).not.toBe('');
				expect(v.text.trim()).not.toBe('');
				expect(ids.has(v.id)).toBe(false);
				ids.add(v.id);
				// The id is the clip filename stem, so it must stay path-safe.
				expect(v.id).toMatch(/^[a-z0-9-]+$/);
			}
		}
	});

	it('names each variant id after its bucket', () => {
		for (const bucket of Object.values(SKOLL_SCRIPT)) {
			for (const v of bucket.variants) expect(v.id.startsWith(bucket.id)).toBe(true);
		}
	});

	it('generatedClips flattens only the generated buckets', () => {
		const clips = generatedClips();
		const expected = GENERATED.flatMap((id) => SKOLL_SCRIPT[id].variants.map((v) => v.id));
		expect(clips.map((c) => c.id).sort()).toEqual([...expected].sort());
		// No deferred line leaks into the build set.
		const deferredIds = DEFERRED.flatMap((id) => SKOLL_SCRIPT[id].variants.map((v) => v.id));
		for (const c of clips) expect(deferredIds).not.toContain(c.id);
	});

	it('wraps a line in the director-notes TTS prompt', () => {
		const prompt = ttsPrompt('Two left. I need one.');
		expect(prompt.startsWith(SKOLL_TTS_DIRECTION)).toBe(true);
		expect(prompt).toContain('"Two left. I need one."');
	});

	it('only the winning-cast bucket carries an exclamation (charter: his one allowed)', () => {
		for (const bucket of Object.values(SKOLL_SCRIPT)) {
			for (const v of bucket.variants) {
				if (bucket.id === 'winning-cast') continue;
				expect(v.text).not.toContain('!');
			}
		}
	});

	// The whole point of the prebuilt library: every generated line must have a committed clip on disk,
	// or board-only play silently loses a taunt. This guards the audio against script drift.
	it('every generated line has a committed clip file', () => {
		const dir = path.resolve('static/audio/skoll');
		for (const clip of generatedClips()) {
			expect(existsSync(path.join(dir, `${clip.id}.pcm.b64`)), `missing clip: ${clip.id}`).toBe(
				true
			);
		}
	});
});
