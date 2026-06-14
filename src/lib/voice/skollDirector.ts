// The Sköll director (P2, R8/R9). Maps an engine event to a spoken taunt bucket, picks a variant with
// no repeat within the night, and hands back the clip to play + caption to render. Pure selection —
// the page owns playback (the shared `deliver` queue), the medallion `skoll-speaking` state, and R9
// mic isolation. Triggers are engine events only; the taunt bucket (a spoken input) defers to P5.

import { SKOLL_SCRIPT, generatedClips, type SkollBucketId, type SkollVariant } from './skollScript';

/** Static clip URL for a variant id — served from `static/audio/skoll/`. */
export function clipUrl(id: string): string {
	return `/audio/skoll/${id}.pcm.b64`;
}

/** Every generated clip's URL — the set to warm into the cache once audio is enabled. */
export function allSkollClipUrls(): string[] {
	return generatedClips().map((v) => clipUrl(v.id));
}

export interface SkollClip {
	/** Variant id (clip stem). */
	id: string;
	/** The spoken words — also the caption (R10). */
	caption: string;
	/** Static clip URL for the shared `deliverClip` queue. */
	url: string;
}

export interface SkollDirector {
	/** A Sköll turn. His first of the round opens the night; later turns taunt only when the hunt
	 *  crosses into a new stage (far → closing → near, by `turns` — the night-progress proxy), so the
	 *  wolf marks milestones instead of barking every turn. Null when this turn earns no new line. */
	turn(turns: number): SkollClip | null;
	/** The witch cast the wrong rune. */
	wrongCast(): SkollClip;
	/** The witch Hexed his Ask. */
	hexed(): SkollClip;
	/** The witch won — his one exit line. */
	playerWin(): SkollClip;
	/** New round: forget the night's first-turn, milestone, and no-repeat memory. */
	reset(): void;
}

// Hunt buckets by how far the night has run — reuses the night-progress thresholds (turns <= 2 deep,
// <= 5 thinning, else dawn) so his menace tracks the same clock the player already feels.
function huntBucket(turns: number): SkollBucketId {
	if (turns <= 2) return 'hunt-far';
	if (turns <= 5) return 'hunt-closing';
	return 'hunt-near';
}

/**
 * Build a director. `rng` is injectable for deterministic tests; defaults to `Math.random`.
 * No-repeat: each bucket draws from a shuffled pool that refills when exhausted, and a refill never
 * leads with the just-played line, so a bucket fired more often than it has variants still never
 * repeats back-to-back.
 */
export function createSkollDirector(rng: () => number = Math.random): SkollDirector {
	const pools = new Map<SkollBucketId, string[]>();
	const lastPlayed = new Map<SkollBucketId, string>();
	const huntStagesFired = new Set<SkollBucketId>();
	let opened = false;

	function variant(bucketId: SkollBucketId): SkollVariant {
		const all = SKOLL_SCRIPT[bucketId].variants;
		let pool = pools.get(bucketId);
		if (!pool || pool.length === 0) {
			pool = all.map((v) => v.id);
			// Avoid an immediate repeat across a refill when the bucket has room to.
			const last = lastPlayed.get(bucketId);
			if (last !== undefined && pool.length > 1) pool = pool.filter((id) => id !== last);
			pools.set(bucketId, pool);
		}
		const index = Math.floor(rng() * pool.length) % pool.length;
		const [id] = pool.splice(index, 1);
		lastPlayed.set(bucketId, id);
		return all.find((v) => v.id === id) as SkollVariant;
	}

	function pick(bucketId: SkollBucketId): SkollClip {
		const v = variant(bucketId);
		return { id: v.id, caption: v.text, url: clipUrl(v.id) };
	}

	return {
		turn(turns) {
			if (!opened) {
				opened = true;
				return pick('night-opens');
			}
			const stage = huntBucket(turns);
			if (huntStagesFired.has(stage)) return null; // already marked this stage of the night
			huntStagesFired.add(stage);
			return pick(stage);
		},
		wrongCast: () => pick('wrong-cast'),
		hexed: () => pick('hexed'),
		playerWin: () => pick('defeat-exit'),
		reset() {
			pools.clear();
			lastPlayed.clear();
			huntStagesFired.clear();
			opened = false;
		}
	};
}
