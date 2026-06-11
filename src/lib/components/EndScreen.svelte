<script lang="ts">
	import { onMount } from 'svelte';
	import dawnSplash from '$lib/assets-webp/banners/dawn-splash.webp?url&no-inline';
	import defeatSplash from '$lib/assets-webp/banners/defeat-splash.webp?url&no-inline';

	// The round's closing rite (ux-copy.md §4): a full-bleed scene with the result stated as a descending
	// verse — a heavy lead line, then the quieter consequence — closed by a single CTA. `onReplay` starts
	// a fresh round. Lines stage in one beat at a time (instant under reduced motion).
	let { outcome, onReplay }: { outcome: 'win' | 'lose'; onReplay: () => void } = $props();

	// Each outcome owns its art, the canonical §4 copy split into a lead + the lines beneath (a `verse`
	// only the victory carries), and the exact replay label. The lead is the dialog's accessible name.
	const SCENE = {
		win: {
			splash: dawnSplash,
			lead: 'The rune is true.',
			verse: 'Sól crests the rim of the world.',
			coda: 'The offering is made. The longest day breaks — and the light is yours to keep.',
			replay: 'Begin another night'
		},
		lose: {
			splash: defeatSplash,
			lead: 'Sköll takes the sun.',
			verse: null,
			coda: 'The longest day never breaks. The year falls to dark.',
			replay: 'Stand against him again'
		}
	} as const;

	let scene = $derived(SCENE[outcome]);
	// Stagger index per element, skipping the absent verse so the coda never waits on an empty beat.
	let delays = $derived(
		scene.verse ? { verse: 1, coda: 2, actions: 3 } : { verse: 0, coda: 1, actions: 2 }
	);

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
	// Tab cycling inside the terminal dialog. Focus lands on the replay CTA. No Escape exit — the round
	// is over and the only way on is replay.
	function trapFocus(node: HTMLElement) {
		const focusable = () =>
			Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled])'));
		(node.querySelector<HTMLElement>('[data-testid="end-replay"]') ?? focusable()[0])?.focus();

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
</script>

<div
	class="end-screen"
	class:win={outcome === 'win'}
	class:lose={outcome === 'lose'}
	data-testid="end-screen"
	data-outcome={outcome}
	role="dialog"
	aria-modal="true"
	aria-labelledby="end-screen-lead"
	use:trapFocus
>
	<img
		class="splash"
		src={scene.splash}
		width="1440"
		height="900"
		alt=""
		aria-hidden="true"
		decoding="async"
	/>
	<div class="scrim" aria-hidden="true"></div>

	<div class="rite">
		<p class="line lead" id="end-screen-lead" style="--i:0">{scene.lead}</p>
		<hr class="rite-divider" aria-hidden="true" />
		{#if scene.verse}
			<p class="line verse" style="--i:{delays.verse}">{scene.verse}</p>
		{/if}
		<p class="line coda" style="--i:{delays.coda}">{scene.coda}</p>

		<div class="actions" style="--i:{delays.actions}">
			<button class="btn btn--primary" type="button" data-testid="end-replay" onclick={onReplay}>
				{scene.replay}
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
		justify-content: center;
		padding: clamp(1.5rem, 5vh, 3rem) 2rem clamp(2.5rem, 8vh, 5rem);
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

	/* Darken toward the bottom so the verse + CTAs read over the art without washing the scene out. */
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
	}

	.win .scrim {
		background: linear-gradient(
			180deg,
			rgba(6, 9, 18, 0.5) 0%,
			rgba(6, 9, 18, 0.22) 32%,
			rgba(6, 9, 18, 0.46) 64%,
			rgba(6, 9, 18, 0.9) 100%
		);
	}

	.lose .scrim {
		background: linear-gradient(
			180deg,
			rgba(6, 9, 18, 0.58) 0%,
			rgba(6, 9, 18, 0.4) 40%,
			rgba(6, 9, 18, 0.62) 70%,
			rgba(6, 9, 18, 0.94) 100%
		);
	}

	/* The rite sits centered over the art; a local halo keeps it legible over the bright dawn — no scrim. */
	.rite {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.1rem;
		max-width: 48rem;
		padding: 2rem 2.8rem;
		border-radius: 18px;
		text-align: center;
		background: radial-gradient(
			ellipse 92% 128% at 50% 50%,
			rgba(6, 9, 18, 0.66) 0%,
			rgba(6, 9, 18, 0.28) 58%,
			transparent 82%
		);
	}

	.lose .rite {
		background: radial-gradient(
			ellipse 92% 128% at 50% 50%,
			rgba(6, 9, 18, 0.78) 0%,
			rgba(6, 9, 18, 0.42) 58%,
			transparent 84%
		);
	}

	.line {
		margin: 0;
		opacity: 0;
		transform: translateY(0.6rem);
		animation: rise 0.8s ease forwards;
		animation-delay: calc(var(--i) * 0.7s);
		text-shadow: 0 2px 14px rgba(0, 0, 0, 0.88);
	}

	/* The heaviest beat — the proclamation, big and gold (POC). */
	.lead {
		font-family: var(--font-story-title);
		font-size: clamp(2.6rem, 6.5vw, 4.4rem);
		line-height: 1.04;
		letter-spacing: 0.02em;
		color: var(--gold-bright);
		text-shadow:
			0 2px 10px rgba(0, 0, 0, 0.8),
			0 0 38px rgba(217, 169, 74, 0.45);
	}

	.verse {
		font-family: var(--font-story-title);
		font-size: clamp(1.3rem, 3vw, 1.9rem);
		letter-spacing: 0.02em;
		color: var(--ink);
	}

	.coda {
		font-family: var(--font-story-body);
		font-size: clamp(1.02rem, 2.1vw, 1.28rem);
		line-height: 1.5;
		color: var(--ink-muted);
		max-width: 38rem;
	}

	.win .coda {
		color: var(--ink);
	}

	.rite-divider {
		width: min(24rem, 60%);
		height: 1.5rem;
		margin: 0.1rem 0 0.2rem;
		border: 0;
		background: var(--ui-divider) center / 100% 100% no-repeat;
		opacity: 0.85;
	}

	.actions {
		position: relative;
		z-index: 2;
		display: flex;
		gap: 0.9rem;
		flex-wrap: wrap;
		justify-content: center;
		opacity: 0;
		animation: rise 0.8s ease forwards;
		animation-delay: calc(var(--i) * 0.7s);
	}

	/* The closing rite scales its single CTA up — a container concern, not a button-class change. */
	.actions .btn {
		min-width: 15rem;
		padding: 0.9rem 1.8rem;
		font-size: 0.92rem;
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
