import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from '$routes/debug/+page.svelte';
import type { DebugEvent, DebugLevel } from '$lib/server/debug/log';

// The page polls /api/debug on a setInterval. Fake timers keep that interval from ever firing, so
// no request escapes to the (hook-less) test dev server — a late real tick was the source of the
// `wrapDynamicImport` TypeError in coverage. The fetch stub is belt-and-suspenders; both are torn
// down after each test so nothing leaks into other files.
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.reject(new Error('no server in test')))
	);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const turn: DebugEvent = {
	seq: 1,
	channel: 'turn',
	level: 'info',
	actor: 'Human',
	message: 'Yes. Sól is reaching for a light rune.'
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
	it('renders a turn as a single engine-fact card (no inference column)', () => {
		const { container } = renderWith([turn]);
		const li = container.querySelector('li')!;
		expect(li.classList.contains('engine')).toBe(true);
		expect(li.querySelector('.kind')?.textContent?.trim()).toBe('engine fact');
		expect(li.querySelector('.msg')?.textContent).toContain('Sól is reaching');
		expect(container.querySelector('.cols')).toBeNull(); // the two-column layout is gone
	});

	it('marks engine channels vs LLM-inference channels by class + chip', () => {
		const oracle: DebugEvent = { seq: 4, channel: 'oracle', level: 'info', message: 'Human asks' };
		const { container } = renderWith([turn, secret, floor, oracle]);
		const li = (c: string) => container.querySelector<HTMLElement>(`li.${c}`)!;
		expect(li('turn').classList.contains('engine')).toBe(true); // verdicts
		expect(li('session').classList.contains('engine')).toBe(true); // the secret
		expect(li('skoll').classList.contains('inference')).toBe(true); // his move
		expect(li('oracle').classList.contains('inference')).toBe(true); // the reading
		expect(li('oracle').querySelector('.kind')?.textContent?.trim()).toBe('LLM inference');
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

	it('polls /api/debug and replaces the stream on each tick', async () => {
		// Real timers for this one so the onMount interval actually fires; a resolving fetch feeds it.
		vi.useRealTimers();
		const next = {
			level: 'verbose' as DebugLevel,
			events: [
				{ seq: 9, channel: 'oracle', level: 'info', message: 'Human asks: "fresh"' } as DebugEvent
			]
		};
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(next))));
		const { container } = renderWith([turn]); // first paint: seq 1
		await expect
			.poll(() => container.querySelector('.msg')?.textContent, { timeout: 3000 })
			.toContain('Human asks: "fresh"');
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
