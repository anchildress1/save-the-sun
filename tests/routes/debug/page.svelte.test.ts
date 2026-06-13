import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Page from '$routes/debug/+page.svelte';
import type { DebugEvent } from '$lib/server/debug/log';

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

const verdict: DebugEvent = {
	seq: 1,
	owner: 'Engine',
	kind: 'deterministic',
	part: 'Ask',
	level: 'info',
	message: 'Yes. Sól is reaching for a light rune.'
};
const floor: DebugEvent = {
	seq: 2,
	owner: 'Sköll',
	kind: 'deterministic',
	part: 'Ask',
	level: 'warn',
	message: 'A gold rune. Mine.',
	data: { source: 'floor', reasoning: 'No facts yet; opening hunch: a gold rune.' }
};
const secret: DebugEvent = {
	seq: 3,
	owner: 'Engine',
	kind: 'deterministic',
	part: 'Round',
	level: 'info',
	message: 'New round — secret is Sowilo'
};

const renderWith = (events: DebugEvent[], sessionId = 'sid-demo') =>
	render(Page, { data: { events, sessionId }, params: {}, form: null });

describe('/debug view', () => {
	it('renders an engine verdict as a deterministic Engine card, with its part', () => {
		const { container } = renderWith([verdict]);
		const li = container.querySelector('li')!;
		expect(li.classList.contains('engine')).toBe(true); // owner Engine → Engine color
		expect(li.querySelector('.who')?.textContent?.trim()).toBe('Engine');
		expect(li.querySelector('.kind-badge')?.classList.contains('deterministic')).toBe(true);
		expect(li.querySelector('.part')?.textContent?.trim()).toBe('Ask');
		expect(li.querySelector('.msg')?.textContent).toContain('Sól is reaching');
		expect(container.querySelector('.cols')).toBeNull(); // the old two-column layout is gone
	});

	it('colors each card by owner and badges kind (LLM vs deterministic)', () => {
		const oracle: DebugEvent = {
			seq: 4,
			owner: 'Oracle',
			kind: 'llm',
			part: 'Ask',
			level: 'info',
			message: 'reads it as: whether it is light'
		};
		const skollLlm: DebugEvent = {
			seq: 6,
			owner: 'Sköll',
			kind: 'llm',
			part: 'Ask',
			level: 'info',
			message: 'Sköll asks…',
			data: { source: 'gemini' }
		};
		const { container } = renderWith([verdict, secret, floor, oracle, skollLlm]);
		const li = (c: string) => container.querySelector<HTMLElement>(`li.${c}`)!;
		// Color = owner.
		expect(li('engine')).toBeTruthy();
		expect(li('oracle')).toBeTruthy();
		expect(li('skoll')).toBeTruthy();
		// Kind badge.
		const kind = (el: HTMLElement) => el.querySelector('.kind-badge')!.classList;
		expect(kind(li('oracle')).contains('llm')).toBe(true); // Oracle reads via Gemini → LLM
		expect(kind(li('engine')).contains('deterministic')).toBe(true); // engine verdict
		// Sköll: gemini-sourced → LLM; floor-sourced → deterministic. Newest-first → skollLlm before floor.
		const skolls = container.querySelectorAll<HTMLElement>('li.skoll');
		expect(skolls[0].querySelector('.kind-badge')!.classList.contains('llm')).toBe(true);
		expect(skolls[1].querySelector('.kind-badge')!.classList.contains('deterministic')).toBe(true);
	});

	it('shows a raw Gemini call as a Sköll card (his move), LLM-badged', () => {
		const gemini: DebugEvent = {
			seq: 5,
			owner: 'Sköll',
			kind: 'llm',
			part: 'Cast',
			level: 'info',
			message: 'raw Gemini move call',
			data: { response: {} }
		};
		const { container } = renderWith([gemini]);
		const card = container.querySelector('li')!;
		expect(card.classList.contains('skoll')).toBe(true); // his move call → Sköll color
		expect(card.querySelector('.who')?.textContent?.trim()).toBe('Sköll');
		expect(card.querySelector('.kind-badge')?.classList.contains('llm')).toBe(true); // LLM
		expect(card.querySelector('.msg')?.textContent).toContain('raw Gemini move call');
	});

	it('collapses raw Gemini I/O by default and toggles open/closed on click', async () => {
		const gemini: DebugEvent = {
			seq: 7,
			owner: 'Sköll',
			kind: 'llm',
			part: 'Cast',
			level: 'info',
			message: 'raw Gemini move call',
			data: { request: { contents: 'board…' }, response: { text: '{}' } }
		};
		const screen = renderWith([gemini, floor]);
		const { container } = screen;
		// The parsed turn info (head + message) stays visible; only the raw I/O hides.
		expect(container.textContent).toContain('raw Gemini move call');
		const details = container.querySelector<HTMLDetailsElement>('details.io')!;
		expect(details.open).toBe(false);
		// Gemini calls only: the floor event's data block stays inline, no expander.
		expect(container.querySelectorAll('details.io')).toHaveLength(1);
		expect(container.querySelectorAll('pre').length).toBeGreaterThanOrEqual(2);
		await screen.getByText('full request / response').click();
		expect(details.open).toBe(true);
		await screen.getByText('full request / response').click();
		expect(details.open).toBe(false);
	});

	it('renders an event as a message + JSON detail, flagging warn', async () => {
		const { container } = renderWith([floor]);
		await expect
			.element(container.querySelector<HTMLElement>('li.skoll.warn')!)
			.toBeInTheDocument();
		expect(container.querySelector('.msg')?.textContent).toContain('gold rune');
		expect(container.querySelector('pre')?.textContent).toContain('floor'); // the data block
	});

	it('renders newest first and shows the round secret in the open', async () => {
		const { container } = renderWith([verdict, floor, secret]);
		await expect.element(container.querySelector<HTMLElement>('li.engine')!).toBeInTheDocument();
		const seqs = [...container.querySelectorAll('.seq')].map((n) => n.textContent);
		expect(seqs).toEqual(['#3', '#2', '#1']);
		expect(container.textContent).toContain('secret is Sowilo');
	});

	it('shows the empty state when there are no events', async () => {
		const screen = renderWith([]);
		await expect.element(screen.getByText(/No events yet/)).toBeInTheDocument();
	});

	it('surfaces the session id so it can be copied onto a watching screen', () => {
		const { container } = renderWith([verdict], 'abc-123');
		expect(container.querySelector('.session code')?.textContent).toBe('abc-123');
	});

	it('polls /api/debug for the browser’s own cookie session', async () => {
		vi.useRealTimers();
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string) => {
				calls.push(input);
				return new Response(JSON.stringify({ sessionId: 'watched', events: [] }));
			})
		);
		// Unmount stops the onMount interval so polling can't leak into later tests under real timers.
		const { unmount } = renderWith([verdict], 'watched');
		await expect.poll(() => calls.length, { timeout: 3000 }).toBeGreaterThan(0);
		expect(calls[0]).toBe('/api/debug');
		unmount();
	});

	it('polls /api/debug and replaces the stream on each tick', async () => {
		// Real timers for this one so the onMount interval actually fires; a resolving fetch feeds it.
		vi.useRealTimers();
		const next = {
			events: [
				{
					seq: 9,
					owner: 'Oracle',
					kind: 'llm',
					part: 'Ask',
					level: 'info',
					message: 'Human asks: "fresh"'
				} as DebugEvent
			]
		};
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(next)))
		);
		const { container, unmount } = renderWith([verdict]); // first paint: seq 1
		await expect
			.poll(() => container.querySelector('.msg')?.textContent, { timeout: 3000 })
			.toContain('Human asks: "fresh"');
		unmount();
	});

	it('wraps long raw I/O instead of overflowing the page horizontally', async () => {
		// A realistic raw gemini event: a long unbroken token (base64-like) + a long prose string.
		const heavy: DebugEvent = {
			seq: 9,
			owner: 'Sköll',
			kind: 'llm',
			part: 'Cast',
			level: 'info',
			message: 'raw Gemini move call',
			data: {
				request: { systemInstruction: 'word '.repeat(900), contents: '{}' },
				response: { thoughtSignature: 'A'.repeat(2000) }
			}
		};
		const { container } = renderWith([heavy]);
		// Raw I/O ships collapsed; open it — the wrap contract applies to the expanded view.
		container.querySelector<HTMLDetailsElement>('details.io')!.open = true;
		const pre = container.querySelector<HTMLElement>('pre')!;
		await expect.element(pre).toBeInTheDocument();
		// The long pre must not be wider than its card, and the page must not scroll sideways.
		expect(pre.scrollWidth).toBeLessThanOrEqual(pre.clientWidth + 1);
		const root = document.documentElement;
		expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
	});
});
