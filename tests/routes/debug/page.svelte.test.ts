import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Page from '$routes/debug/+page.svelte';
import type { DebugEntry } from '$lib/server/debug/log';

// The page polls /api/debug on mount; stub fetch to reject so the SSR-given entries stand and the
// poll is a harmless no-op for these render assertions.
beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.reject(new Error('no server in test')))
	);
});

const human: DebugEntry = {
	seq: 1,
	actor: 'Human',
	action: 'Ask',
	truth: 'Yes. Sól is reaching for a light rune.',
	inference: 'read as "whether it is light"'
};
const skollFloor: DebugEntry = {
	seq: 2,
	actor: 'Sköll',
	action: 'Cast',
	truth: 'Cast Fehu — wrong, the round continues',
	inference: '',
	source: 'floor'
};

const renderWith = (entries: DebugEntry[]) =>
	render(Page, { data: { entries }, params: {}, form: null });

describe('/debug view', () => {
	it('shows both tagged columns for a result', async () => {
		const screen = renderWith([human]);
		const { container } = screen;
		// The column tags (the header reuses the words, so scope to the entry's .tag spans).
		const tags = [...container.querySelectorAll('.cols .tag')].map((n) => n.textContent);
		expect(tags).toEqual(['deterministic-engine', 'LLM-inference']);
		await expect.element(screen.getByText(human.truth)).toBeInTheDocument();
		await expect.element(screen.getByText(human.inference)).toBeInTheDocument();
	});

	it('flags a floor-fired turn and renders newest first', async () => {
		const { container } = renderWith([human, skollFloor]);
		await expect
			.element(container.querySelector<HTMLElement>('.source.floor')!)
			.toBeInTheDocument();
		// Newest (#2) renders above oldest (#1).
		const seqs = [...container.querySelectorAll('.seq')].map((n) => n.textContent);
		expect(seqs).toEqual(['#2', '#1']);
	});

	it('renders an em dash when there is no inference (a human Cast)', () => {
		const { container } = renderWith([skollFloor]);
		expect(container.querySelector('.inference p')?.textContent).toBe('—');
	});

	it('shows the empty state before any move', async () => {
		const screen = renderWith([]);
		await expect.element(screen.getByText(/No moves yet/)).toBeInTheDocument();
	});
});
