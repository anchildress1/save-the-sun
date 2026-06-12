import { render } from 'vitest-browser-svelte';
import { userEvent } from 'vitest/browser';
import { describe, it, expect, vi } from 'vitest';
import EclipseMedallion from '$lib/components/EclipseMedallion.svelte';
import {
	MEDALLION_LABEL,
	SPRITE_LEVELS,
	type MedallionState
} from '$lib/components/medallionState';

// The browser context runs with reducedMotion: 'reduce' (vite.config.ts), so every assertion
// here describes the reduced-motion contract: static glow intensities, no pulse/orbit.

// Derived from the source mapping so a seventh state can't ship untested here;
// medallionState.test.ts pins the union's exact membership.
const ALL_STATES = Object.keys(MEDALLION_LABEL) as MedallionState[];

// Scoped to the render's own container: several tests mount more than one medallion, and a
// page-wide testid locator would trip strict mode on the second mount.
const renderMedallion = (state: MedallionState, amplitude = 0, onToggle = vi.fn()) => {
	const screen = render(EclipseMedallion, { state, amplitude, onToggle });
	const button = screen.container.querySelector<HTMLButtonElement>(
		'[data-testid="eclipse-medallion"]'
	);
	if (!button) throw new Error('medallion did not render');
	return { screen, button, onToggle };
};

const layer = (button: HTMLElement, selector: string) => {
	const el = button.querySelector<HTMLElement>(selector);
	if (!el) throw new Error(`missing medallion layer: ${selector}`);
	return el;
};

describe('EclipseMedallion — labeled button (R6)', () => {
	it.each(ALL_STATES.map((state) => ({ state })))(
		'is a button labeled for the $state state',
		async ({ state }) => {
			const { screen } = renderMedallion(state);
			await expect
				.element(screen.getByRole('button', { name: MEDALLION_LABEL[state] }))
				.toBeInTheDocument();
		}
	);

	it('is a non-submitting button carrying its state as data for styling', () => {
		const { button } = renderMedallion('listening');
		expect(button.type).toBe('button');
		expect(button.dataset.voiceState).toBe('listening');
	});

	it('fires onToggle once per tap', async () => {
		const { screen, onToggle } = renderMedallion('asleep');
		await screen.getByTestId('eclipse-medallion').click();
		expect(onToggle).toHaveBeenCalledOnce();
	});

	it.each([
		{ key: 'Enter', press: '{Enter}' },
		{ key: 'Space', press: ' ' }
	])('wakes from the keyboard — $key fires onToggle like a tap', async ({ press }) => {
		const { button, onToggle } = renderMedallion('asleep');
		button.focus();
		await userEvent.keyboard(press);
		expect(onToggle).toHaveBeenCalledOnce();
	});

	it('swallows keyboard activation while eclipsed — the seal holds without a pointer too (S4)', async () => {
		const { button, onToggle } = renderMedallion('eclipsed');
		button.focus();
		await userEvent.keyboard('{Enter}');
		await userEvent.keyboard(' ');
		expect(onToggle).not.toHaveBeenCalled();
	});

	it('swallows the tap while eclipsed — the seal is inert whatever the page wires in (S4)', async () => {
		const { screen, button, onToggle } = renderMedallion('eclipsed');
		// force: aria-disabled makes Playwright refuse the click, but a real pointer still lands —
		// the guard under test is the component's own.
		await screen.getByTestId('eclipse-medallion').click({ force: true });
		expect(onToggle).not.toHaveBeenCalled();
		expect(button.getAttribute('aria-disabled')).toBe('true');
	});

	it('stays an enabled-but-inert button while eclipsed — focusable so the label can explain', () => {
		const { button } = renderMedallion('eclipsed');
		// disabled would drop it from the tab order; the sealed state must remain discoverable.
		expect(button.disabled).toBe(false);
		expect(getComputedStyle(button).cursor).toBe('default');
	});

	it('hides every visual layer from assistive tech — the label is the whole story', () => {
		const { button } = renderMedallion('hearing', 0.2);
		expect(layer(button, '.visual').getAttribute('aria-hidden')).toBe('true');
		const ringRunes = button.querySelectorAll('img.ring-rune');
		expect(ringRunes).toHaveLength(8);
		for (const img of ringRunes) expect(img.getAttribute('alt')).toBe('');
	});
});

describe('EclipseMedallion — state visuals', () => {
	it('etches the mic glyph while asleep; the wolf stays hidden', () => {
		const { button } = renderMedallion('asleep');
		expect(getComputedStyle(layer(button, '.mic-glyph')).opacity).toBe('1');
		expect(getComputedStyle(layer(button, '.wolf-eyes')).opacity).toBe('0');
		// The strike is the eclipse seal's mark — it must never bleed into ordinary sleep.
		expect(getComputedStyle(layer(button, '.mic-strike')).display).toBe('none');
	});

	it('strikes the dimmed glyph while eclipsed — a shape signal that this is the seal, not sleep (S4)', () => {
		const { button } = renderMedallion('eclipsed');
		expect(getComputedStyle(layer(button, '.mic-strike')).display).not.toBe('none');
		const glyphOpacity = Number(getComputedStyle(layer(button, '.mic-glyph')).opacity);
		expect(glyphOpacity).toBeGreaterThan(0);
		expect(glyphOpacity).toBeLessThan(1);
	});

	it('kindles the corona while waking — pending, not asleep', () => {
		const { button } = renderMedallion('waking');
		expect(getComputedStyle(layer(button, '.mic-glyph')).opacity).toBe('0');
		// Brighter than the asleep corona (base 0.08), or waking is indistinguishable from asleep.
		expect(Number(getComputedStyle(layer(button, '.corona')).opacity)).toBeGreaterThan(0.08);
	});

	it('unveils the disc on listening — no mic glyph, corona lit', () => {
		const { button } = renderMedallion('listening');
		expect(getComputedStyle(layer(button, '.mic-glyph')).opacity).toBe('0');
		expect(Number(getComputedStyle(layer(button, '.corona')).opacity)).toBeGreaterThan(0.2);
	});

	it('opens the wolf eyes only while Sköll speaks — a shape signal, not color alone', () => {
		const { button } = renderMedallion('skoll-speaking');
		expect(getComputedStyle(layer(button, '.wolf-eyes')).opacity).toBe('1');
		expect(button.querySelectorAll('.eye')).toHaveLength(2);
		// The ember palette swap rides the same state, but the eyes are the color-blind signal.
		expect(getComputedStyle(button).getPropertyValue('--corona-rgb').trim()).toBe('200, 71, 63');
	});

	it('keeps the gold palette for every Oracle-side state', () => {
		for (const state of ALL_STATES.filter((s) => s !== 'skoll-speaking')) {
			const { button } = renderMedallion(state);
			expect(getComputedStyle(button).getPropertyValue('--corona-rgb').trim()).toBe('217, 169, 74');
		}
	});
});

describe('EclipseMedallion — voice level strip disc', () => {
	it('renders the level strip as the disc art once the page goes idle', async () => {
		const { button } = renderMedallion('asleep');
		// Deferred off the critical path (perf gate) — it must still arrive, idle or not.
		await vi.waitFor(
			() =>
				expect(layer(button, '.disc').style.backgroundImage).toContain('voice-medallion-levels'),
			{ timeout: 3000 }
		);
	});

	it.each([
		{ state: 'asleep' as const, amplitude: 0, level: '0' },
		{ state: 'eclipsed' as const, amplitude: 0, level: '0' },
		{ state: 'waking' as const, amplitude: 0, level: '2' },
		{ state: 'hearing' as const, amplitude: 0.15, level: '6' },
		{ state: 'hearing' as const, amplitude: 0.3, level: '11' },
		{ state: 'speaking' as const, amplitude: 0, level: '11' }
	])('points $state (amp $amplitude) at strip level $level', ({ state, amplitude, level }) => {
		const { button } = renderMedallion(state, amplitude);
		expect(button.style.getPropertyValue('--sprite-level')).toBe(level);
	});

	it('derives the strip geometry from SPRITE_LEVELS — the CSS cannot drift from the constant', () => {
		const { button } = renderMedallion('speaking');
		const disc = getComputedStyle(layer(button, '.disc'));
		expect(disc.backgroundSize).toBe(`${SPRITE_LEVELS * 100}% 100%`);
		// Peak level resolves to the strip's last frame; asleep to its first.
		expect(disc.backgroundPosition).toBe('100% 0%');
		const asleep = renderMedallion('asleep');
		expect(getComputedStyle(layer(asleep.button, '.disc')).backgroundPosition).toBe('0% 0%');
	});

	it('loads the strip through the setTimeout fallback when requestIdleCallback is missing', async () => {
		const original = window.requestIdleCallback;
		// @ts-expect-error -- removing the API entirely; stubbing undefined won't beat `in window`
		delete window.requestIdleCallback;
		try {
			const { button } = renderMedallion('asleep');
			await vi.waitFor(
				() =>
					expect(layer(button, '.disc').style.backgroundImage).toContain('voice-medallion-levels'),
				{ timeout: 3000 }
			);
		} finally {
			window.requestIdleCallback = original;
		}
	});

	it('freezes the playback loop under reduced motion — the static level stands in', () => {
		for (const state of ['listening', 'speaking', 'skoll-speaking'] as const) {
			const { button } = renderMedallion(state);
			expect(getComputedStyle(layer(button, '.disc')).animationName).toBe('none');
		}
	});
});

describe('EclipseMedallion — amplitude flare (hearing)', () => {
	it.each([
		{ label: 'half-scale speech', amplitude: 0.15, flare: '0.5' },
		{ label: 'an over-scale amplitude clamped to full', amplitude: 5, flare: '1' },
		{ label: 'a negative amplitude clamped to silence', amplitude: -2, flare: '0' },
		{ label: 'NaN read as silence', amplitude: Number.NaN, flare: '0' }
	])('drives --flare from $label', ({ amplitude, flare }) => {
		const { button } = renderMedallion('hearing', amplitude);
		expect(button.style.getPropertyValue('--flare')).toBe(flare);
	});
});

describe('EclipseMedallion — reduced motion (R6)', () => {
	it.each([
		{ state: 'listening' as const, selector: '.corona', why: 'breathing pulse' },
		{ state: 'speaking' as const, selector: '.corona', why: 'voice pulse' },
		{ state: 'skoll-speaking' as const, selector: '.corona', why: 'ember pulse' },
		{ state: 'thinking' as const, selector: '.rune-ring', why: 'ring orbit' }
	])('replaces the $why with a static glow in the $state state', ({ state, selector }) => {
		const { button } = renderMedallion(state);
		const el = layer(button, selector);
		expect(getComputedStyle(el).animationName).toBe('none');
	});

	it('pins the hearing flare to a static intensity — amplitude must not move the glow', () => {
		const loud = renderMedallion('hearing', 0.3);
		const quiet = renderMedallion('hearing', 0.01);
		const loudCorona = getComputedStyle(layer(loud.button, '.corona'));
		const quietCorona = getComputedStyle(layer(quiet.button, '.corona'));
		expect(loudCorona.opacity).toBe(quietCorona.opacity);
		expect(loudCorona.transform).toBe('none');
	});

	it('ignites the rim runes on hearing — brighter than their listening rest', () => {
		const hearing = renderMedallion('hearing', 0.2);
		const listening = renderMedallion('listening');
		const ignited = Number(getComputedStyle(layer(hearing.button, '.ring-rune')).opacity);
		const resting = Number(getComputedStyle(layer(listening.button, '.ring-rune')).opacity);
		expect(ignited).toBeGreaterThan(resting);
	});
});

describe('EclipseMedallion — state announcements', () => {
	it('announces the privacy-critical transitions and holds quiet through an exchange', async () => {
		const screen = render(EclipseMedallion, {
			state: 'asleep' as MedallionState,
			amplitude: 0,
			onToggle: vi.fn()
		});
		const status = screen.getByTestId('medallion-status');
		await expect.element(status).toHaveTextContent('The voice sleeps.');

		await screen.rerender({ state: 'listening' });
		await expect.element(status).toHaveTextContent('The Oracle listens.');

		// hearing and thinking are still "listening" to the player — the line must hold steady.
		await screen.rerender({ state: 'hearing', amplitude: 0.2 });
		await expect.element(status).toHaveTextContent('The Oracle listens.');
		await screen.rerender({ state: 'thinking' });
		await expect.element(status).toHaveTextContent('The Oracle listens.');

		await screen.rerender({ state: 'speaking' });
		await expect.element(status).toHaveTextContent('The Oracle speaks.');
		await screen.rerender({ state: 'skoll-speaking' });
		await expect.element(status).toHaveTextContent('Sköll speaks.');
		await screen.rerender({ state: 'asleep' });
		await expect.element(status).toHaveTextContent('The voice sleeps.');
	});

	it('narrates politely — a status region, never an interrupting alert', () => {
		const { screen } = renderMedallion('asleep');
		const status = screen.getByTestId('medallion-status').element();
		expect(status.getAttribute('role')).toBe('status');
	});
});
