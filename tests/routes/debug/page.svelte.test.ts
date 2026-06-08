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
	part: 'Ask',
	message: 'Yes. Sól is reaching for a light rune.'
};
const floor: DebugEvent = {
	seq: 2,
	channel: 'skoll',
	level: 'warn',
	actor: 'Sköll',
	part: 'Ask',
	message: 'Floor fired — Sköll asks after a gold rune.',
	data: { source: 'floor', reasoning: 'No facts yet; opening hunch: a gold rune.' }
};
const secret: DebugEvent = {
	seq: 3,
	channel: 'session',
	level: 'info',
	sensitive: true,
	part: 'Round',
	message: 'New round — secret is Sowilo'
};

const renderWith = (events: DebugEvent[], level: DebugLevel = 'verbose') =>
	render(Page, { data: { events, level }, params: {}, form: null });

describe('/debug view', () => {
	it('renders a turn verdict as a deterministic card coloured by its actor, with its part', () => {
		const { container } = renderWith([turn]);
		const li = container.querySelector('li')!;
		expect(li.classList.contains('human')).toBe(true); // actor Human → Human colour
		expect(li.querySelector('.who')?.textContent?.trim()).toBe('Human');
		expect(li.querySelector('.badge.llm')?.classList.contains('det')).toBe(true); // deterministic
		expect(li.querySelector('.part')?.textContent?.trim()).toBe('Ask');
		expect(li.querySelector('.msg')?.textContent).toContain('Sól is reaching');
		expect(container.querySelector('.cols')).toBeNull(); // the old two-column layout is gone
	});

	it('colours each card by source and badges LLM vs deterministic', () => {
		const oracle: DebugEvent = {
			seq: 4,
			channel: 'oracle',
			level: 'info',
			part: 'Ask',
			message: 'Human asks'
		};
		const gemini: DebugEvent = {
			seq: 5,
			channel: 'gemini',
			level: 'info',
			sensitive: true,
			part: 'Ask',
			message: 'Gemini move call'
		};
		const skollLlm: DebugEvent = {
			seq: 6,
			channel: 'skoll',
			level: 'info',
			actor: 'Sköll',
			part: 'Ask',
			message: 'Sköll asks…',
			data: { source: 'gemini' }
		};
		const { container } = renderWith([turn, secret, floor, oracle, gemini, skollLlm]);
		const li = (c: string) => container.querySelector<HTMLElement>(`li.${c}`)!;
		// Colour = source (turn coloured by its actor).
		expect(li('human')).toBeTruthy();
		expect(li('oracle')).toBeTruthy();
		expect(li('gemini')).toBeTruthy();
		expect(li('session')).toBeTruthy();
		// LLM vs deterministic badge.
		const isDet = (el: HTMLElement) => el.querySelector('.badge.llm')!.classList.contains('det');
		expect(isDet(li('oracle'))).toBe(false); // Oracle reads via Gemini → LLM
		expect(isDet(li('gemini'))).toBe(false); // raw model I/O → LLM
		expect(isDet(li('human'))).toBe(true); // engine verdict → deterministic
		expect(isDet(li('session'))).toBe(true); // the secret → deterministic
		// Sköll: gemini-sourced → LLM; floor-sourced → deterministic.
		expect(isDet(container.querySelector<HTMLElement>('li.skoll')!)).toBe(false); // skollLlm renders first among skoll
		expect(isDet(container.querySelectorAll<HTMLElement>('li.skoll')[1])).toBe(true); // floor
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
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(next)))
		);
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
