// Browser-project test (the `.svelte.` suffix routes it to the jsdom/Playwright project) because
// the module touches `sessionStorage`, which the node project does not provide.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MUTE_STATE_KEY, readMuted, writeMuted } from '$lib/voice/outputMute';

beforeEach(() => {
	sessionStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
	sessionStorage.clear();
});

describe('outputMute — round-trip', () => {
	it('reads back the muted preference that was written', () => {
		writeMuted(true);
		expect(sessionStorage.getItem(MUTE_STATE_KEY)).toBe('true');
		expect(readMuted()).toBe(true);
	});

	it('reads back an unmuted preference', () => {
		writeMuted(false);
		expect(readMuted()).toBe(false);
	});

	it('defaults to unmuted when nothing is stored', () => {
		expect(readMuted()).toBe(false);
	});

	it('treats any non-"true" stored value as unmuted', () => {
		sessionStorage.setItem(MUTE_STATE_KEY, 'garbage');
		expect(readMuted()).toBe(false);
	});
});

describe('outputMute — storage failure degrades, never throws', () => {
	it('returns false when reading throws (private mode)', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new DOMException('denied');
		});
		expect(() => readMuted()).not.toThrow();
		expect(readMuted()).toBe(false);
	});

	it('swallows a write that throws (private mode)', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new DOMException('quota');
		});
		expect(() => writeMuted(true)).not.toThrow();
	});
});
