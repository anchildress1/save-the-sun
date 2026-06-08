import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from '$routes/debug/+page.svelte';
import type { DebugEvent, DebugLevel } from '$lib/server/debug/log';

// The page polls /api/debug on mount; stub fetch to reject so the SSR-given data stands and the
// poll is a harmless no-op for these render assertions. Restore it after each so the stub never
// leaks into other test files.
beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.reject(new Error('no server in test')))
	);
});
afterEach(() => vi.unstubAllGlobals());

const turn: DebugEvent = {
	seq: 1,
	channel: 'turn',
	level: 'info',
	actor: 'Human',
	message: 'Yes. Sól is reaching for a light rune.',
	data: {
		action: 'Ask',
		truth: 'Yes. Sól is reaching for a light rune.',
		inference: 'read as "is it light"'
	}
};
const floor: DebugEvent = {
	seq: 2,
	channel: 'skoll',
	level: 'warn',
	actor: 'Sköll',
	message: 'Floor fired — Sköll asks after a gold rune.',
	data: { source: 'floor', reasoning: 'No facts yet; opening hunch: a gold rune.' }
};
const secret: DebugEvent = {
	seq: 3,
	channel: 'session',
	level: 'info',
	sensitive: true,
	message: 'New round — secret is Sowilo'
};

const renderWith = (events: DebugEvent[], level: DebugLevel = 'verbose') =>
	render(Page, { data: { events, level }, params: {}, form: null });

describe('/debug view', () => {
	it('renders a turn event as two tagged columns', async () => {
		const { container } = renderWith([turn]);
		const tags = [...container.querySelectorAll('.cols .tag')].map((n) => n.textContent?.trim());
		expect(tags[0]).toBe('deterministic-engine');
		expect(tags[1]).toContain('LLM-inference');
		expect(container.querySelector('.truth p')?.textContent).toContain('Sól is reaching');
		expect(container.querySelector('.inference p')?.textContent).toContain('read as');
	});

	it('renders a non-turn event as a message + JSON detail, flagging warn', async () => {
		const { container } = renderWith([floor]);
		await expect
			.element(container.querySelector<HTMLElement>('li.skoll.warn')!)
			.toBeInTheDocument();
		expect(container.querySelector('.msg')?.textContent).toContain('Floor fired');
		expect(container.querySelector('pre')?.textContent).toContain('floor'); // the data block
	});

	it('badges a sensitive event and renders newest first', async () => {
		const { container } = renderWith([turn, floor, secret]);
		await expect
			.element(container.querySelector<HTMLElement>('li.session .badge')!)
			.toBeInTheDocument();
		const seqs = [...container.querySelectorAll('.seq')].map((n) => n.textContent);
		expect(seqs).toEqual(['#3', '#2', '#1']);
	});

	it('shows the empty state when there are no events', async () => {
		const screen = renderWith([]);
		await expect.element(screen.getByText(/No events yet/)).toBeInTheDocument();
	});

	it('shows the disabled hint when the level is off', async () => {
		const screen = renderWith([], 'off');
		await expect.element(screen.getByText(/debug log is off/)).toBeInTheDocument();
	});

	it('wraps long raw I/O instead of overflowing the page horizontally', async () => {
		// A realistic verbose gemini event: a long unbroken token (base64-like) + a long prose string.
		const heavy: DebugEvent = {
			seq: 9,
			channel: 'gemini',
			level: 'info',
			sensitive: true,
			message: 'Gemini move call',
			data: {
				request: { systemInstruction: 'word '.repeat(900), contents: '{}' },
				response: { thoughtSignature: 'A'.repeat(2000) }
			}
		};
		const { container } = renderWith([heavy]);
		const pre = container.querySelector<HTMLElement>('pre')!;
		await expect.element(pre).toBeInTheDocument();
		// The long pre must not be wider than its card, and the page must not scroll sideways.
		expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth + 1);
		const root = document.documentElement;
		expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
	});
});
