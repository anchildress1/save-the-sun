import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import EclipseMedallion from '$lib/components/EclipseMedallion.svelte';
import {
	MEDALLION_LABEL,
	SPRITE_LEVELS,
	type MedallionState
} from '$lib/components/medallionState';

// The browser context runs with reducedMotion: 'reduce' (vite.config.ts), so every assertion
// here describes the reduced-motion contract: static glow intensities, no pulse.

// Derived from the source mapping so a new state can't ship untested here.
const ALL_STATES = Object.keys(MEDALLION_LABEL) as MedallionState[];

const renderMedallion = (state: MedallionState, onHoldStart = vi.fn(), onHoldEnd = vi.fn()) => {
	const screen = render(EclipseMedallion, { state, onHoldStart, onHoldEnd });
	const button = screen.container.querySelector<HTMLButtonElement>(
		'[data-testid="eclipse-medallion"]'
	);
	if (!button) throw new Error('medallion did not render');
	return { screen, button, onHoldStart, onHoldEnd };
};

const layer = (button: HTMLElement, selector: string) => {
	const el = button.querySelector<HTMLElement>(selector);
	if (!el) throw new Error(`missing medallion layer: ${selector}`);
	return el;
};

const press = (button: HTMLElement) =>
	button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
const release = (button: HTMLElement) =>
	button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

describe('EclipseMedallion — hold-to-record button (R6)', () => {
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
		const { button } = renderMedallion('idle');
		expect(button.type).toBe('button');
		expect(button.dataset.voiceState).toBe('idle');
	});

	it('fires onHoldStart on press and onHoldEnd on release', () => {
		const { button, onHoldStart, onHoldEnd } = renderMedallion('idle');
		press(button);
		expect(onHoldStart).toHaveBeenCalledOnce();
		expect(onHoldEnd).not.toHaveBeenCalled();
		release(button);
		expect(onHoldEnd).toHaveBeenCalledOnce();
	});

	it('ends the hold if the pointer leaves the disc mid-press', () => {
		const { button, onHoldEnd } = renderMedallion('idle');
		press(button);
		button.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true, pointerId: 1 }));
		expect(onHoldEnd).toHaveBeenCalledOnce();
	});

	it('a stray release with no matching press does nothing', () => {
		const { button, onHoldEnd } = renderMedallion('idle');
		release(button);
		expect(onHoldEnd).not.toHaveBeenCalled();
	});

	it('refuses the hold while denied — the seal is inert', () => {
		const { button, onHoldStart } = renderMedallion('denied');
		press(button);
		expect(onHoldStart).not.toHaveBeenCalled();
		expect(button.getAttribute('aria-disabled')).toBe('true');
	});

	it('holds while Space is held on the focused medallion, releasing on keyup', () => {
		const { button, onHoldStart, onHoldEnd } = renderMedallion('idle');
		button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
		expect(onHoldStart).toHaveBeenCalledOnce();
		// A key repeat while held must not re-fire the hold.
		button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, repeat: true }));
		expect(onHoldStart).toHaveBeenCalledOnce();
		button.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
		expect(onHoldEnd).toHaveBeenCalledOnce();
	});

	it('ignores keys that are not the talk keys', () => {
		const { button, onHoldStart } = renderMedallion('idle');
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		expect(onHoldStart).not.toHaveBeenCalled();
	});

	it('refuses a keyboard hold while denied', () => {
		const { button, onHoldStart } = renderMedallion('denied');
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(onHoldStart).not.toHaveBeenCalled();
	});

	it('hides every visual layer from assistive tech — the label is the whole story', () => {
		const { button } = renderMedallion('idle');
		expect(layer(button, '.visual').getAttribute('aria-hidden')).toBe('true');
		const ringRunes = button.querySelectorAll('img.ring-rune');
		expect(ringRunes).toHaveLength(8);
		for (const img of ringRunes) expect(img.getAttribute('alt')).toBe('');
	});
});

describe('EclipseMedallion — state visuals', () => {
	it('etches the mic glyph while idle; the Sköll eclipse stays hidden', () => {
		const { button } = renderMedallion('idle');
		expect(Number(getComputedStyle(layer(button, '.mic-glyph')).opacity)).toBeGreaterThan(0);
		expect(getComputedStyle(layer(button, '.eclipse-shadow')).opacity).toBe('0');
		// The strike is the denied seal's mark — it must never bleed into ordinary idle.
		expect(getComputedStyle(layer(button, '.mic-strike')).display).toBe('none');
	});

	it('strikes the dimmed glyph while denied — a shape signal that this is the seal', () => {
		const { button } = renderMedallion('denied');
		expect(getComputedStyle(layer(button, '.mic-strike')).display).not.toBe('none');
		const glyphOpacity = Number(getComputedStyle(layer(button, '.mic-glyph')).opacity);
		expect(glyphOpacity).toBeGreaterThan(0);
		expect(glyphOpacity).toBeLessThan(1);
	});

	it('flares the corona while recording — the rite is hearing you', () => {
		const { button } = renderMedallion('recording');
		// Brighter than the idle breath, so recording reads as active capture.
		expect(Number(getComputedStyle(layer(button, '.corona')).opacity)).toBeGreaterThan(0.4);
	});

	it('deepens the disc toward eclipse only while Sköll speaks — a brightness signal, not color alone', () => {
		const { button } = renderMedallion('skoll-speaking');
		expect(getComputedStyle(layer(button, '.eclipse-shadow')).opacity).toBe('1');
		expect(getComputedStyle(button).getPropertyValue('--corona-rgb').trim()).toBe('200, 71, 63');
	});

	it('paints the player input silver-blue while recording — its own voice, not the Oracle gold', () => {
		const { button } = renderMedallion('recording');
		expect(getComputedStyle(button).getPropertyValue('--corona-rgb').trim()).toBe('150, 185, 225');
		expect(getComputedStyle(layer(button, '.eclipse-shadow')).opacity).toBe('0');
	});

	it('keeps the gold palette and hides the eclipse for the Oracle-side states', () => {
		// Recording (input, silver-blue) and Sköll (ember) carry their own hues — the rest stay gold.
		for (const state of ALL_STATES.filter((s) => s !== 'skoll-speaking' && s !== 'recording')) {
			const { button } = renderMedallion(state);
			expect(getComputedStyle(button).getPropertyValue('--corona-rgb').trim()).toBe('217, 169, 74');
			expect(getComputedStyle(layer(button, '.eclipse-shadow')).opacity).toBe('0');
		}
	});
});

describe('EclipseMedallion — voice level strip disc', () => {
	it('renders the level strip as the disc art once the page goes idle', async () => {
		const { button } = renderMedallion('idle');
		await vi.waitFor(
			() =>
				expect(layer(button, '.disc').style.backgroundImage).toContain('voice-medallion-levels'),
			{ timeout: 3000 }
		);
	});

	it.each([
		{ state: 'denied' as const, level: '0' },
		{ state: 'idle' as const, level: '4' },
		{ state: 'recording' as const, level: '11' },
		{ state: 'speaking' as const, level: '11' }
	])('points $state at strip level $level', ({ state, level }) => {
		const { button } = renderMedallion(state);
		expect(button.style.getPropertyValue('--sprite-level')).toBe(level);
	});

	it('derives the strip geometry from SPRITE_LEVELS — the CSS cannot drift from the constant', () => {
		const { button } = renderMedallion('speaking');
		const disc = getComputedStyle(layer(button, '.disc'));
		expect(disc.backgroundSize).toBe(`${SPRITE_LEVELS * 100}% 100%`);
		expect(disc.backgroundPosition).toBe('100% 0%');
		const denied = renderMedallion('denied');
		expect(getComputedStyle(layer(denied.button, '.disc')).backgroundPosition).toBe('0% 0%');
	});
});

describe('EclipseMedallion — reduced motion (R6)', () => {
	it.each([
		{ state: 'idle' as const, selector: '.corona', why: 'breathing pulse' },
		{ state: 'recording' as const, selector: '.corona', why: 'recording pulse' },
		{ state: 'recording' as const, selector: '.disc', why: 'sprite loop' }
	])('replaces the $why with a static glow in the $state state', ({ state, selector }) => {
		const { button } = renderMedallion(state);
		expect(getComputedStyle(layer(button, selector)).animationName).toBe('none');
	});

	it('holds the speaking disc at its static peak — no audio-driven pulse to honor or ignore', () => {
		// The live-level pulse was stripped: speaking is a steady lit disc, so the frame is the state's
		// fixed peak regardless of any playback, with no animation to disable under reduced motion.
		const { button } = renderMedallion('speaking');
		expect(button.style.getPropertyValue('--sprite-level')).toBe(String(SPRITE_LEVELS - 1));
		expect(getComputedStyle(layer(button, '.disc')).animationName).toBe('none');
	});
});

describe('EclipseMedallion — state announcements', () => {
	it('announces each state via a polite status region', async () => {
		const screen = render(EclipseMedallion, {
			state: 'idle' as MedallionState,
			onHoldStart: vi.fn(),
			onHoldEnd: vi.fn()
		});
		const status = screen.getByTestId('medallion-status');
		await expect.element(status).toHaveTextContent('Ready to hear you.');

		await screen.rerender({ state: 'recording' });
		await expect.element(status).toHaveTextContent('Listening.');

		await screen.rerender({ state: 'speaking' });
		await expect.element(status).toHaveTextContent('The Oracle speaks.');
		await screen.rerender({ state: 'skoll-speaking' });
		await expect.element(status).toHaveTextContent('Sköll speaks.');

		expect(status.element().getAttribute('role')).toBe('status');
	});
});
