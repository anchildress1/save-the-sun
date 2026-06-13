<script lang="ts">
	import { onMount } from 'svelte';
	import {
		MEDALLION_ANNOUNCEMENT,
		MEDALLION_LABEL,
		RING_RUNES,
		SPRITE_LEVELS,
		flareLevel,
		spriteLevel,
		type MedallionState
	} from './medallionState';
	import { RUNE_SYMBOL_ASSET } from './runeVisuals';
	import levelStrip from '$lib/assets-webp/ui/voice-medallion-levels.webp?url&no-inline';

	// Presentation + toggle only: the page owns the voiceSession subscription and decides what
	// `state` means, so the S13 director can drive skoll-speaking through the same prop.
	// (Aliased locally: a binding literally named `state` collides with the $state rune.)
	let {
		state: current,
		amplitude = 0,
		onToggle
	}: {
		state: MedallionState;
		amplitude?: number;
		onToggle: () => void;
	} = $props();

	let flare = $derived(flareLevel(amplitude));
	let level = $derived(spriteLevel(current, flare));

	// The strip loads at idle, never against the LCP fetch — the perf gate holds the line.
	// Until it lands the glow layers carry the medallion alone.
	let stripUrl = $state('');
	onMount(() => {
		const load = () => (stripUrl = levelStrip);
		// The timeout bounds a page that never goes idle — the art must still arrive.
		if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 1500 });
		else setTimeout(load, 500);
	});

	// Sticky: states mapped to null announce nothing, so the last meaningful line holds and the
	// region only re-announces when its content actually changes (no listening↔hearing chatter).
	let announced = $state('');
	$effect(() => {
		const line = MEDALLION_ANNOUNCEMENT[current];
		if (line) announced = line;
	});
</script>

<div class="medallion-wrap">
	<button
		class="medallion"
		type="button"
		data-testid="eclipse-medallion"
		data-voice-state={current}
		aria-label={MEDALLION_LABEL[current]}
		aria-disabled={current === 'eclipsed'}
		style="--flare: {flare}; --ring-step: {360 /
			RING_RUNES.length}deg; --sprite-level: {level}; --sprite-size: {SPRITE_LEVELS *
			100}%; --sprite-peak: {SPRITE_LEVELS - 1}"
		onclick={() => {
			// Sealed for the session (S4): the tap must die here, whatever the page wires in.
			if (current !== 'eclipsed') onToggle();
		}}
	>
		<span class="visual" aria-hidden="true">
			<span class="corona"></span>
			<span class="clip">
				<!-- The disc renders the 12-level volume strip (docs/ui-image-resources.md): static
				     level per state, flare-indexed on hearing, ping-pong loop while a voice plays. -->
				<span class="disc" style={stripUrl ? `background-image: url(${stripUrl})` : ''}></span>
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
				<span class="wolf-eyes">
					<span class="eye eye--left"></span>
					<span class="eye eye--right"></span>
				</span>
			</span>
		</span>
	</button>
	<span class="sr-only" role="status" data-testid="medallion-status">{announced}</span>
</div>

<style>
	.medallion-wrap {
		display: flex;
		justify-content: center;
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
	}

	/* Ember palette is never the only Sköll signal — the wolf's eyes open below. */
	.medallion[data-voice-state='skoll-speaking'] {
		--corona-rgb: 200, 71, 63;
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
	.medallion[data-voice-state='listening'] .disc {
		animation: sprite-level 2.2s steps(12, jump-none) infinite alternate;
	}

	.medallion[data-voice-state='speaking'] .disc,
	.medallion[data-voice-state='skoll-speaking'] .disc {
		animation: sprite-level 0.75s steps(12, jump-none) infinite alternate;
	}

	/* Ember shift for the wolf — paired with the eyes below, never the only signal. */
	.medallion[data-voice-state='skoll-speaking'] .disc {
		filter: hue-rotate(-40deg) saturate(1.25);
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

	/* Asleep: the sprite's dim eclipsed-sun frame IS the partial eclipse — a CSS shadow on top
	   of it read as a black blob, so the etched mic glyph alone marks the rest state. */
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

	.medallion[data-voice-state='asleep'] .mic-glyph {
		opacity: 1;
	}

	.mic-strike {
		display: none;
	}

	/* Eclipsed (S4): the dim rest frame holds, but the struck glyph is the shape signal that
	   this is the seal, not sleep — and the cursor drops the tap affordance with it. */
	.medallion[data-voice-state='eclipsed'] {
		cursor: default;
	}

	.medallion[data-voice-state='eclipsed'] .mic-glyph {
		opacity: 0.45;
	}

	.medallion[data-voice-state='eclipsed'] .mic-strike {
		display: inline;
	}

	/* Waking: the corona kindles — static (no animation), so the permission-prompt stretch
	   reads as pending without needing a reduced-motion variant. */
	.medallion[data-voice-state='waking'] .corona {
		opacity: 0.18;
	}

	/* Listening: disc unveiled, corona breathing slow. */
	.medallion[data-voice-state='listening'] .corona {
		animation: corona-breathe 4.2s ease-in-out infinite;
	}

	.medallion[data-voice-state='listening'] .ring-rune {
		opacity: 0.3;
	}

	/* Hearing: corona flares with the player's voice; rim runes ignite. */
	.medallion[data-voice-state='hearing'] .corona {
		opacity: calc(0.34 + var(--flare) * 0.56);
		/* Flare scale capped to the pulse ceiling so a loud voice can't push the glow past the frame. */
		transform: scale(calc(1 + var(--flare) * 0.03));
		transition:
			opacity 0.12s linear,
			transform 0.12s linear;
	}

	.medallion[data-voice-state='hearing'] .ring-rune {
		opacity: calc(0.55 + var(--flare) * 0.45);
		filter: var(--rune-tint) drop-shadow(0 0 4px rgba(217, 169, 74, 0.8));
	}

	/* Thinking: the rune ring orbits slowly. */
	.medallion[data-voice-state='thinking'] .corona {
		opacity: 0.3;
	}

	.medallion[data-voice-state='thinking'] .rune-ring {
		animation: ring-orbit 16s linear infinite;
	}

	.medallion[data-voice-state='thinking'] .ring-rune {
		opacity: 0.55;
	}

	/* Speaking: the corona pulses — gold for the Oracle, ember for the wolf. */
	.medallion[data-voice-state='speaking'] .corona,
	.medallion[data-voice-state='skoll-speaking'] .corona {
		animation: corona-pulse 1.15s ease-in-out infinite;
	}

	/* Sköll: eyes open at the disc edge — a shape signal, independent of the ember color. */
	.wolf-eyes {
		opacity: 0;
		transition: opacity 0.25s ease;
	}

	.medallion[data-voice-state='skoll-speaking'] .wolf-eyes {
		opacity: 1;
	}

	.eye {
		position: absolute;
		top: 22%;
		width: 0.85rem;
		height: 0.4rem;
		background: #ff7a5e;
		box-shadow: 0 0 6px rgba(255, 122, 94, 0.9);
		border-radius: 50% 50% 50% 50% / 75% 75% 25% 25%;
	}

	.eye--left {
		left: 22%;
		transform: rotate(-14deg);
	}

	.eye--right {
		left: 58%;
		transform: rotate(14deg);
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

	/* Static glow intensities replace pulse, orbit, and the amplitude flare (R6). The theme's
	   global near-zero durations aren't enough here: a frozen keyframe could park at its dimmest
	   frame, so the animations are removed and each state gets a fixed intensity. */
	@media (prefers-reduced-motion: reduce) {
		/* Selector specificity must match the per-state rules above, or their animation
		   shorthand would win and the pulse/orbit would survive reduced motion. The disc
		   freezes on its inline static frame (spriteLevel's reduced-motion fallback). */
		.medallion[data-voice-state] .corona,
		.medallion[data-voice-state] .rune-ring,
		.medallion[data-voice-state] .disc {
			animation: none;
		}

		.medallion[data-voice-state='listening'] .corona {
			opacity: 0.38;
		}

		.medallion[data-voice-state='hearing'] .corona {
			opacity: 0.62;
			transform: none;
		}

		.medallion[data-voice-state='hearing'] .ring-rune {
			opacity: 0.85;
		}

		.medallion[data-voice-state='speaking'] .corona,
		.medallion[data-voice-state='skoll-speaking'] .corona {
			opacity: 0.7;
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
