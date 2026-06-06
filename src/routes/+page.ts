import type { PageLoad } from './$types';

// A fresh board order each load so patterns don't jump out. Seeded here (not in the
// component) so SSR and hydration agree on one order and the layout is reproducible;
// when Sköll arrives this seed becomes engine-owned so he sees the same board. A
// refresh starts a new night with a new layout.
export const load: PageLoad = () => {
	return { boardSeed: Math.floor(Math.random() * 0x7fffffff) };
};
