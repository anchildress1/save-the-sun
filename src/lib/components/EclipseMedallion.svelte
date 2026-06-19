<script lang="ts">
	import { onMount } from 'svelte';
	import {
		MEDALLION_ANNOUNCEMENT,
		MEDALLION_LABEL,
		RING_RUNES,
		SPRITE_LEVELS,
		spriteLevel,
		type MedallionState
	} from './medallionState';
	import { RUNE_SYMBOL_ASSET } from './runeVisuals';
	import levelStrip from '$lib/assets-webp/ui/voice-medallion-levels.webp?url&no-inline';

	// Presentation + hold-to-record gesture only: the page owns the recorder and decides what `state`
	// means (recording while held, thinking while transcribing, the voices from delivery).
	// (Aliased locally: a binding literally named `state` collides with the $state rune.)
	let {
		state: current,
		onHoldStart,
		onHoldEnd
	}: {
		state: MedallionState;
		onHoldStart: () => void;
		onHoldEnd: () => void;
	} = $props();

	let sealed = $derived(current === 'denied');

	// Disc frame: the state's fixed glow level. Speaking holds a steady lit disc — the indicator's
	// motion is the discrete switch between voices as the delivery queue plays, not an audio pulse.
	let level = $derived(spriteLevel(current));

	// pointerdown begins the hold; release/leave/cancel ends it. Guarded against a denied mic and
	// against a stray pointerup with no matching down (e.g. a release that started off the disc).
	let holding = false;
	function begin(event: PointerEvent) {
		if (sealed || holding) return;
		holding = true;
		// Keep receiving move/up even if the pointer slides off the disc mid-hold.
		try {
			(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		} catch {
			// No active pointer (a synthetic event, or one already released) — capture is best-effort.
		}
		onHoldStart();
	}
	function end() {
		if (!holding) return;
		holding = false;
		onHoldEnd();
	}

	// Keyboard hold-to-record: when the medallion is focused, Space/Enter drive the hold directly.
	// The native button would fire a click on keyup; we preventDefault and run the press-and-hold
	// gesture instead, so a keyboard user records for exactly as long as they hold the key.
	function keyDown(event: KeyboardEvent) {
		if (event.key !== ' ' && event.key !== 'Enter') return;
		event.preventDefault();
		if (sealed || event.repeat || holding) return;
		holding = true;
		onHoldStart();
	}
	function keyUp(event: KeyboardEvent) {
		if (event.key !== ' ' && event.key !== 'Enter') return;
		event.preventDefault();
		end();
	}

	// The strip loads at idle, never against the LCP fetch — the perf gate holds the line.
	// Until it lands the glow layers carry the medallion alone.
	let stripUrl = $state('');
	onMount(() => {
		const load = () => (stripUrl = levelStrip);
		// The timeout bounds a page that never goes idle — the art must still arrive.
		if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 1500 });
		else setTimeout(load, 500);
	});

	// Re-announces only when the line changes, so a steady state never re-narrates. The sealed state
	// is left to the page's voice-notice live region (which carries the actionable "continues by
	// hand") — narrating it here too would double-speak the same denial to a screen reader.
	let announced = $derived(sealed ? '' : MEDALLION_ANNOUNCEMENT[current]);
</script>

<div class="medallion-wrap">
	<button
		class="medallion"
		type="button"
		data-testid="eclipse-medallion"
		data-voice-state={current}
		aria-label={MEDALLION_LABEL[current]}
		aria-disabled={sealed}
		aria-describedby={sealed ? undefined : 'mic-hint'}
		style="--ring-step: {360 /
			RING_RUNES.length}deg; --sprite-level: {level}; --sprite-size: {SPRITE_LEVELS *
			100}%; --sprite-peak: {SPRITE_LEVELS - 1}"
		onpointerdown={begin}
		onpointerup={end}
		onpointerleave={end}
		onpointercancel={end}
		onkeydown={keyDown}
		onkeyup={keyUp}
		onblur={end}
		oncontextmenu={(e) => e.preventDefault()}
	>
		<span class="visual" aria-hidden="true">
			<span class="corona"></span>
			<span class="clip">
				<!-- The disc renders the 12-level volume strip (docs/ui-image-resources.md): static
				     level per state, ping-pong loop while recording or a voice plays. -->
				<span class="disc" style={stripUrl ? `background-image: url(${stripUrl})` : ''}></span>
				<!-- Sköll speaking: the disc darkens toward total eclipse with an ember rim — the sun
				     devoured. A brightness/shape signal, never color alone. -->
				<span class="eclipse-shadow"></span>
				<span class="rune-ring">
					{#each RING_RUNES as name, i (name)}
						<img
							class="ring-rune"
							style="--i: {i}"
							src={RUNE_SYMBOL_ASSET[name]}
							alt=""
							width="20"
							height="20"
							decoding="async"
						/>
					{/each}
				</span>
				<svg class="mic-glyph" viewBox="0 0 28 28">
					<rect x="11" y="4" width="6" height="11" rx="3" />
					<path d="M7.5 13a6.5 6.5 0 0 0 13 0" />
					<line x1="14" y1="19.5" x2="14" y2="23" />
					<line x1="10.5" y1="23" x2="17.5" y2="23" />
					<line class="mic-strike" x1="7" y1="5" x2="21" y2="23" />
				</svg>
			</span>
		</span>
	</button>
	<span class="sr-only" role="status" data-testid="medallion-status">{announced}</span>
	<!-- Discoverability for the page-wide push-to-talk key: a hover/focus hint that the backtick holds
	     too. Also the button's aria-describedby, so it is read on focus, not just seen on hover. Hidden
	     while sealed — the key does nothing without a mic. -->
	{#if !sealed}
		<span class="mic-hint" id="mic-hint">
			Hold to speak, or hold <kbd aria-label="the backtick key">`</kbd>
		</span>
	{/if}
</div>

<style>
	.medallion-wrap {
		display: flex;
		justify-content: center;
		position: relative;
	}

	/* Hover/focus hint that the backtick key holds the mic too. Hidden until the disc is hovered or
	   focused; pointer-events off so it never blocks the hold gesture. */
	.mic-hint {
		position: absolute;
		top: calc(100% + 0.4rem);
		left: 50%;
		transform: translateX(-50%) translateY(0.15rem);
		z-index: 5;
		white-space: nowrap;
		padding: 0.3rem 0.55rem;
		border: 1px solid var(--gold-dim);
		border-radius: 0.4rem;
		background: rgba(6, 9, 18, 0.92);
		color: var(--gold-bright);
		font-size: 0.72rem;
		line-height: 1;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.16s ease,
			transform 0.16s ease;
	}

	.mic-hint kbd {
		font-family: inherit;
		font-size: 0.78rem;
		padding: 0 0.28rem;
		border: 1px solid var(--gold-dim);
		border-radius: 0.25rem;
		background: rgba(217, 169, 74, 0.12);
	}

	.medallion:hover ~ .mic-hint,
	.medallion:focus-visible ~ .mic-hint {
		opacity: 1;
		transform: translateX(-50%) translateY(0);
	}

	.medallion {
		/* Sized so the corona's spill still fits under the panel's top padding — the panel
		   clips overflow, and a taller disc had its glow crown sliced flat while shoving the
		   content stack down over the wolf banner. */
		--size: 6.25rem;
		--ring-r: 2.35rem;
		--corona-rgb: 217, 169, 74; /* gold */
		position: relative;
		width: var(--size);
		height: var(--size);
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
		/* A hold-to-record gesture must not scroll the page or select text on touch. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	/* Ember palette is never the only Sköll signal — the disc deepens to eclipse below. */
	.medallion[data-voice-state='skoll-speaking'] {
		--corona-rgb: 200, 71, 63;
	}

	/* The player's own voice (input) reads moonlight silver-blue — distinct from the Oracle's gold and
	   the wolf's ember, so recording is never mistaken for a spoken reply. Paired with the flare below. */
	.medallion[data-voice-state='recording'] {
		--corona-rgb: 150, 185, 225;
	}

	.medallion:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 4px;
	}

	.visual {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.corona {
		position: absolute;
		/* Reach + pulse (below) capped so the glow stays inside the panel's clipped top border. */
		inset: -10%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(var(--corona-rgb), 0.85) 0%,
			rgba(var(--corona-rgb), 0.3) 48%,
			transparent 78%
		);
		opacity: 0.08;
		transition: opacity 0.25s ease;
	}

	/* The disc clips the inner layers; the corona stays outside so its glow can spill. */
	.clip {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		overflow: hidden;
	}

	/* Strip geometry rides the inline vars derived from SPRITE_LEVELS — one source of truth.
	   The position fraction divides by the peak because N background-position stops span
	   0–100% in N-1 steps. The looping states' animations below override the static frame
	   (animations outrank inline styles in the cascade). */
	.disc {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background-size: var(--sprite-size) 100%;
		background-position: calc(var(--sprite-level) * 100% / var(--sprite-peak)) 0%;
	}

	/* The strip is a monotonic 0→11 intensity ramp, so alternate plays it as a breath:
	   up the ramp, back down — one full pulse per two passes. */
	.medallion[data-voice-state='recording'] .disc {
		animation: sprite-level 1.1s steps(12, jump-none) infinite alternate;
	}

	/* Ember shift for the wolf — paired with the deepening eclipse below, never the only signal. */
	.medallion[data-voice-state='skoll-speaking'] .disc {
		filter: hue-rotate(-40deg) saturate(1.25);
	}

	/* Recording shifts the gold disc toward the same moonlight silver-blue as its corona, so the
	   player's voice reads cohesively cool — distinct from gold/ember. The flare animation rides on top. */
	.medallion[data-voice-state='recording'] .disc {
		filter: hue-rotate(170deg) saturate(0.9);
	}

	/* Sköll speaking: a dark overlay swallows the disc center (the sun devoured) while an inset
	   ember rim glows — a brightness + shape signal, so the state never reads by color alone.
	   Hidden in every other state. */
	.eclipse-shadow {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(3, 3, 8, 0.92) 36%,
			rgba(3, 3, 8, 0.55) 60%,
			transparent 78%
		);
		box-shadow: inset 0 0 12px 2px rgba(200, 71, 63, 0.9);
		opacity: 0;
		transition: opacity 0.3s ease;
	}

	.medallion[data-voice-state='skoll-speaking'] .eclipse-shadow {
		opacity: 1;
	}

	/* The ember itself prowls: a bright hotspot near the rim rotates around the eclipse edge, so the
	   RED moves — not the rim glyphs (those spin only while thinking). The dark center holds still;
	   only the ember travels the circle. */
	.medallion[data-voice-state='skoll-speaking'] .eclipse-shadow::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: radial-gradient(
			circle at 50% 9%,
			rgba(232, 104, 78, 0.95) 0%,
			rgba(200, 71, 63, 0.35) 13%,
			transparent 24%
		);
		animation: ember-orbit 3.4s linear infinite;
	}

	@keyframes ember-orbit {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes sprite-level {
		from {
			background-position-x: 0%;
		}
		to {
			background-position-x: 100%;
		}
	}

	.rune-ring {
		position: absolute;
		inset: 0;
	}

	.ring-rune {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 1rem;
		height: 1rem;
		margin: -0.5rem;
		transform: rotate(calc(var(--i) * var(--ring-step))) translateY(calc(var(--ring-r) * -1));
		/* The card glyphs are carved-stone dark; re-tint them aged gold for the rim. */
		--rune-tint: invert(0.78) sepia(0.55) saturate(4) hue-rotate(-18deg);
		filter: var(--rune-tint);
		opacity: 0.2;
		transition:
			opacity 0.25s ease,
			filter 0.25s ease;
	}

	/* Idle: the etched mic glyph marks "hold to speak"; denied dims and strikes it. */
	.mic-glyph {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 1.6rem;
		height: 1.6rem;
		transform: translate(-50%, -50%);
		stroke: rgba(233, 200, 119, 0.9);
		fill: none;
		stroke-width: 1.6;
		stroke-linecap: round;
		opacity: 0;
		transition: opacity 0.25s ease;
	}

	.medallion[data-voice-state='idle'] .mic-glyph {
		opacity: 0.85;
	}

	.mic-strike {
		display: none;
	}

	/* Denied: the struck glyph is the shape signal that this is the seal, not idle — and the
	   cursor drops the hold affordance with it. */
	.medallion[data-voice-state='denied'] {
		cursor: default;
	}

	.medallion[data-voice-state='denied'] .mic-glyph {
		opacity: 0.45;
	}

	.medallion[data-voice-state='denied'] .mic-strike {
		display: inline;
	}

	/* Idle: disc unveiled, corona breathing slowly — ready to hear you. */
	.medallion[data-voice-state='idle'] .corona {
		animation: corona-breathe 4.2s ease-in-out infinite;
	}

	/* Recording: corona flares bright and pulses fast — the rite is hearing you; rim runes ignite. */
	.medallion[data-voice-state='recording'] .corona {
		animation: corona-pulse 0.9s ease-in-out infinite;
		opacity: 0.7;
	}

	.medallion[data-voice-state='recording'] .ring-rune {
		opacity: 0.7;
		filter: var(--rune-tint) drop-shadow(0 0 4px rgba(150, 185, 225, 0.8));
	}

	/* Thinking: the rune ring orbits slowly while the words are read. */
	.medallion[data-voice-state='thinking'] .corona {
		opacity: 0.3;
	}

	.medallion[data-voice-state='thinking'] .rune-ring {
		animation: ring-orbit 16s linear infinite;
	}

	.medallion[data-voice-state='thinking'] .ring-rune {
		opacity: 0.55;
	}

	/* Speaking: the sun breathes from the inside — the disc cycles its brightness strip, the same inner
	   pulse as recording (gold/ember, not blue). The corona drops to a faint halo so the movement reads
	   ON the disc, not as an outer glow. Reduced motion holds the disc on its peak. */
	.medallion[data-voice-state='speaking'] .disc,
	.medallion[data-voice-state='skoll-speaking'] .disc {
		animation: sprite-level 1.3s steps(12, jump-none) infinite alternate;
	}

	.medallion[data-voice-state='speaking'] .corona,
	.medallion[data-voice-state='skoll-speaking'] .corona {
		opacity: 0.2;
	}

	.medallion[data-voice-state='speaking'] .ring-rune,
	.medallion[data-voice-state='skoll-speaking'] .ring-rune {
		opacity: 0.55;
	}

	@keyframes corona-breathe {
		0%,
		100% {
			opacity: 0.22;
		}
		50% {
			opacity: 0.48;
		}
	}

	@keyframes corona-pulse {
		0%,
		100% {
			opacity: 0.38;
			transform: scale(1);
		}
		50% {
			opacity: 0.82;
			transform: scale(1.03);
		}
	}

	@keyframes ring-orbit {
		to {
			transform: rotate(360deg);
		}
	}

	/* Static glow intensities replace the pulses and orbit. The theme's global near-zero
	   durations aren't enough here: a frozen keyframe could park at its dimmest frame, so the
	   animations are removed and each state gets a fixed intensity. The disc freezes on its inline
	   static frame (spriteLevel). */
	@media (prefers-reduced-motion: reduce) {
		.medallion[data-voice-state] .corona,
		.medallion[data-voice-state] .rune-ring,
		.medallion[data-voice-state] .disc {
			animation: none;
		}

		.medallion[data-voice-state='idle'] .corona {
			opacity: 0.38;
		}

		.medallion[data-voice-state='recording'] .corona {
			opacity: 0.72;
		}

		.medallion[data-voice-state='recording'] .ring-rune {
			opacity: 0.85;
		}

		.medallion[data-voice-state='skoll-speaking'] .eclipse-shadow::after {
			animation: none;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
