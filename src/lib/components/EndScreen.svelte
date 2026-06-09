<script lang="ts">
	import { onMount } from 'svelte';
	import dawnSplash from '$lib/assets/banners/dawn-splash.jpg';
	import defeatSplash from '$lib/assets/banners/defeat-splash.jpg';

	// The round's closing rite (ux-copy.md §4). Full-bleed cinematic overlay: the splash fills the
	// viewport, the in-world lines stage in one beat at a time (instant under reduced motion), and the
	// two CTAs close it. `onReplay` starts a fresh round; `onLeave` returns to the title.
	let {
		outcome,
		onReplay,
		onLeave
	}: { outcome: 'win' | 'lose'; onReplay: () => void; onLeave: () => void } = $props();

	// Each outcome owns its art, its staged lines (last = the heaviest, the dialog's label), and the
	// exact replay label — canonical copy lives in ux-copy.md §4.
	const SCENE = {
		win: {
			splash: dawnSplash,
			lines: [
				'The rune is true.',
				'Sól crests the rim of the world.',
				'The offering is made. The longest day breaks — and the light is yours to keep.'
			],
			replay: 'Begin another night'
		},
		lose: {
			splash: defeatSplash,
			lines: ['Sköll takes the sun. The longest day never breaks. The year falls to dark.'],
			replay: 'Stand against him again'
		}
	} as const;

	let scene = $derived(SCENE[outcome]);

	onMount(() => {
		// Lock scroll behind the full-bleed overlay (mirrors Onboarding).
		const bodyOverflow = document.body.style.overflow;
		const rootOverflow = document.documentElement.style.overflow;
		document.body.style.overflow = 'hidden';
		document.documentElement.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = bodyOverflow;
			document.documentElement.style.overflow = rootOverflow;
		};
	});

	// Focus trap: the resolved board behind stays interactive (cross-off is never turn-gated), so keep
	// Tab cycling inside the terminal dialog. Focus lands on the primary CTA. No Escape exit — the round
	// is over and the only ways on are the two CTAs.
	function trapFocus(node: HTMLElement) {
		const focusable = () =>
			Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled])'));
		focusable()[0]?.focus();

		function onKeydown(e: KeyboardEvent) {
			if (e.key !== 'Tab') return;
			const els = focusable();
			if (els.length === 0) return;
			const first = els[0];
			const last = els[els.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}

		node.addEventListener('keydown', onKeydown);
		return { destroy: () => node.removeEventListener('keydown', onKeydown) };
	}

	// The last line is the dialog's accessible name (Sól's blessing on a win, the defeat toll on a loss).
	let labelId = $derived('end-screen-line-' + (scene.lines.length - 1));
</script>

<div
	class="end-screen"
	class:win={outcome === 'win'}
	class:lose={outcome === 'lose'}
	data-testid="end-screen"
	data-outcome={outcome}
	role="dialog"
	aria-modal="true"
	aria-labelledby={labelId}
	use:trapFocus
>
	<img class="splash" src={scene.splash} alt="" aria-hidden="true" decoding="async" />
	<div class="scrim" aria-hidden="true"></div>

	<div class="rite">
		<div class="lines">
			{#each scene.lines as line, i (i)}
				<p
					class="line"
					class:final={i === scene.lines.length - 1}
					id="end-screen-line-{i}"
					style="--i:{i}"
				>
					{line}
				</p>
			{/each}
		</div>

		<div class="actions" style="--i:{scene.lines.length}">
			<button
				class="ritual-button ritual-button--primary"
				type="button"
				data-testid="end-replay"
				onclick={onReplay}
			>
				{scene.replay}
			</button>
			<button
				class="ritual-button ritual-button--ghost"
				type="button"
				data-testid="end-leave"
				onclick={onLeave}
			>
				Leave the fire.
			</button>
		</div>
	</div>
</div>

<style>
	.end-screen {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		padding: clamp(2rem, 8vh, 6rem) 2rem clamp(3rem, 10vh, 6rem);
		overflow: hidden;
		isolation: isolate;
	}

	.splash {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: 50% 45%;
	}

	/* Darken toward the bottom so the lines + CTAs read over the art without washing the scene out. */
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
	}

	.win .scrim {
		background: linear-gradient(
			180deg,
			rgba(6, 9, 18, 0.12) 0%,
			rgba(6, 9, 18, 0.34) 46%,
			rgba(6, 9, 18, 0.86) 100%
		);
	}

	.lose .scrim {
		background: linear-gradient(
			180deg,
			rgba(6, 9, 18, 0.34) 0%,
			rgba(6, 9, 18, 0.52) 42%,
			rgba(6, 9, 18, 0.92) 100%
		);
	}

	.rite {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.6rem;
		max-width: 46rem;
		text-align: center;
	}

	.lines {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.line {
		margin: 0;
		font-family: var(--font-story-body);
		font-size: 1.35rem;
		line-height: 1.5;
		color: var(--ink);
		text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85);
		opacity: 0;
		transform: translateY(0.6rem);
		animation: rise 0.8s ease forwards;
		animation-delay: calc(var(--i) * 0.7s);
	}

	/* Sól's blessing / the defeat toll — the heaviest beat, lifted in weight and warmth. */
	.line.final {
		font-family: var(--font-story-title);
		font-size: 1.7rem;
		letter-spacing: 0.02em;
	}

	.win .line.final {
		color: var(--gold-bright);
		text-shadow: 0 0 26px rgba(217, 169, 74, 0.5);
	}

	.lose .line.final {
		color: var(--steel);
		text-shadow: 0 0 22px rgba(139, 147, 166, 0.32);
	}

	.actions {
		display: flex;
		gap: 0.9rem;
		flex-wrap: wrap;
		justify-content: center;
		opacity: 0;
		animation: rise 0.8s ease forwards;
		animation-delay: calc(var(--i) * 0.7s);
	}

	.actions > button {
		min-width: 12rem;
	}

	@keyframes rise {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Motion is decorative — under a reduced-motion preference the whole rite is present at once. */
	@media (prefers-reduced-motion: reduce) {
		.line,
		.actions {
			opacity: 1;
			transform: none;
			animation: none;
		}
	}
</style>
