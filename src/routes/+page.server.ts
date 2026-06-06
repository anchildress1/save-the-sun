import type { PageServerLoad } from './$types';

// A fresh board order each load so patterns don't jump out. Generated on the server so
// SSR and hydration share one seed — server load data is serialized to the client and
// reused, never recomputed, so the order can't differ between the two renders. When
// Sköll arrives this seed becomes engine-owned so he sees the same board. A refresh
// starts a new night with a new layout.
export const load: PageServerLoad = () => {
	return { boardSeed: Math.floor(Math.random() * 0x7fffffff) };
};
