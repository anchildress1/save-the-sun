<script lang="ts">
	import {
		MEDALLION_ANNOUNCEMENT,
		MEDALLION_LABEL,
		RING_RUNES,
		SPRITE_COLS,
		flareLevel,
		spriteFrame,
		type MedallionState
	} from './medallionState';
	import { RUNE_SYMBOL_ASSET } from './runeVisuals';
	import spriteSheet from '$lib/assets-webp/ui/voice-medallion-sprite.webp?url&no-inline';

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
	let frame = $derived(spriteFrame(current, flare));
	let spriteCol = $derived(frame % SPRITE_COLS);
	let spriteRow = $derived(Math.floor(frame / SPRITE_COLS));

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
		style="--flare: {flare}; --ring-step: {360 /
			RING_RUNES.length}deg; --sprite-col: {spriteCol}; --sprite-row: {spriteRow}"
		onclick={onToggle}
	>
		<span class="visual" aria-hidden="true">
			<span class="corona"></span>
			<span class="clip">
				<!-- The disc renders the voice sprite sheet (docs/ui-image-resources.md): static
				     frame per state, flare-indexed on hearing, stepped loop while a voice plays. -->
				<span class="disc" style="background-image: url({spriteSheet})"></span>
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
				<span class="shadow-bite"></span>
				<svg class="mic-glyph" viewBox="0 0 28 28">
					<rect x="11" y="4" width="6" height="11" rx="3" />
					<path d="M7.5 13a6.5 6.5 0 0 0 13 0" />
					<line x1="14" y1="19.5" x2="14" y2="23" />
					<line x1="10.5" y1="23" x2="17.5" y2="23" />
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
	/* The Oracle panel dims its own top with a ::before overlay (z-index 1) and raises its
	   children above it — but that page-scoped selector can't reach this component's markup,
	   so the medallion must claim its own place above the veil or it renders under it. */
	.medallion-wrap {
		position: relative;
		z-index: 2;
		display: flex;
		justify-content: center;
	}

	.medallion {
		--size: 7.5rem;
		--ring-r: 2.8rem;
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
		inset: -16%;
		border-radius: 50%;
		background: radial-gradient(
			circle,
			rgba(var(--corona-rgb), 0.85) 0%,
			rgba(var(--corona-rgb), 0.3) 46%,
			transparent 72%
		);
		opacity: 0.08;
		transition: opacity 0.25s ease;
	}

	/* The disc clips the bite and the eyes; the corona stays outside so its glow can spill. */
	.clip {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		overflow: hidden;
	}

	/* The voice sprite sheet: 8×6 frames, sized so exactly one frame fills the disc. The
	   background-position fractions are (count - 1) because N background-position stops span
	   0–100% in N-1 steps. Inline --sprite-col/--sprite-row pick the static frame; the looping
	   states' animations below override it (animations outrank inline styles in the cascade). */
	.disc {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background-size: 800% 600%;
		background-position: calc(var(--sprite-col) * 100% / 7) calc(var(--sprite-row) * 100% / 5);
	}

	/* One pass through the sheet is one authored glow cycle (dim→bright→dim): the x animation
	   walks a row's 8 columns, the y animation drops a row each x cycle — 6× the x duration. */
	.medallion[data-voice-state='listening'] .disc {
		animation:
			sprite-x 0.8s steps(8, jump-none) infinite,
			sprite-y 4.8s steps(6, jump-none) infinite;
	}

	.medallion[data-voice-state='speaking'] .disc,
	.medallion[data-voice-state='skoll-speaking'] .disc {
		animation:
			sprite-x 0.25s steps(8, jump-none) infinite,
			sprite-y 1.5s steps(6, jump-none) infinite;
	}

	/* Ember shift for the wolf — paired with the eyes below, never the only signal. */
	.medallion[data-voice-state='skoll-speaking'] .disc {
		filter: hue-rotate(-40deg) saturate(1.25);
	}

	@keyframes sprite-x {
		from {
			background-position-x: 0%;
		}
		to {
			background-position-x: 100%;
		}
	}

	@keyframes sprite-y {
		from {
			background-position-y: 0%;
		}
		to {
			background-position-y: 100%;
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
		--rune-tint: invert(0.78) sepia(0.55) saturate(4) hue-rotate(-18deg) brightness(1.15);
		filter: var(--rune-tint);
		opacity: 0.34;
		transition:
			opacity 0.25s ease,
			filter 0.25s ease;
	}

	/* Asleep: Sköll's shadow bites into the disc — the partial eclipse. closest-side pins the
	   shadow circle to the element box (farthest-corner math made it swallow half the face),
	   and the offset leaves only a crescent overlapping; the edge stays near-crisp because a
	   soft falloff reads as a blurry drop shadow, not an eclipse. */
	.shadow-bite {
		position: absolute;
		top: -52%;
		left: -52%;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: radial-gradient(
			circle closest-side,
			rgba(5, 7, 14, 0.88) 97%,
			rgba(5, 7, 14, 0) 100%
		);
		opacity: 0;
		transition: opacity 0.25s ease;
	}

	.medallion[data-voice-state='asleep'] .shadow-bite {
		opacity: 1;
	}

	/* Even asleep the gold must read at a glance — the medallion is the voice's front door. */
	.medallion[data-voice-state='asleep'] .corona {
		opacity: 0.22;
	}

	/* Asleep: the etched mic glyph is the discoverability cue. */
	.mic-glyph {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 1.6rem;
		height: 1.6rem;
		transform: translate(-50%, -50%);
		stroke: rgba(233, 200, 119, 0.85);
		fill: none;
		stroke-width: 1.6;
		stroke-linecap: round;
		opacity: 0;
		transition: opacity 0.25s ease;
	}

	.medallion[data-voice-state='asleep'] .mic-glyph {
		opacity: 1;
	}

	/* Waking: the shadow half-lifts and the corona kindles — static (no animation), so the
	   permission-prompt stretch reads as pending without needing a reduced-motion variant. */
	.medallion[data-voice-state='waking'] .shadow-bite {
		opacity: 0.45;
	}

	.medallion[data-voice-state='waking'] .corona {
		opacity: 0.3;
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
		transform: scale(calc(1 + var(--flare) * 0.07));
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
			transform: scale(1.05);
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
		   freezes on its inline static frame (spriteFrame's reduced-motion fallback). */
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
