// Shared deterministic PRNG. Same seed → same stream. Used by the board shuffle and the
// engine's secret selection so both are reproducible from a seed.
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		// >>> 0 (not | 0) keeps a as a uint32 with the same wraparound the algorithm needs;
		// the downstream Math.imul/XOR operate on the identical 32-bit pattern.
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
