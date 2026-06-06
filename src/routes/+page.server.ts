import type { PageServerLoad } from './$types';

// A fresh board order each load so patterns don't jump out. Generated on the server so
// SSR and hydration share one seed — server load data is serialized to the client and
// reused, never recomputed, so the order can't differ between the two renders. When
// Sköll arrives this seed becomes engine-owned so he sees the same board. A refresh
// starts a new night with a new layout.
export const load: PageServerLoad = () => {
	// Web Crypto, not Math.random — the board seed will later drive the secret rune, so it
	// must not be a predictable PRNG. Returns a uint32; mulberry32 takes it via seed >>> 0.
	return { boardSeed: crypto.getRandomValues(new Uint32Array(1))[0] };
};
