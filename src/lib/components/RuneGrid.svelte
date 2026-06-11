<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { shuffledBoard } from '$lib/boardOrder';
	import RuneCard from './RuneCard.svelte';
	import gsap from 'gsap';

	// boardSeed is required (no default): a missing seed should surface, not silently fall
	// back to a frozen order and hide a load/SSR-wiring bug.
	let {
		castMode = false,
		boardSeed,
		onSelectTarget,
		restoreCrossed = [],
		onCrossChange
	}: {
		castMode?: boolean;
		boardSeed: number;
		onSelectTarget: (id: number) => void;
		restoreCrossed?: number[];
		onCrossChange?: (ids: number[]) => void;
	} = $props();

	// Shuffled on-screen order, fixed per seed. Depends only on boardSeed, so cross-off
	// updates never reshuffle the board.
	let board = $derived(shuffledBoard(boardSeed));

	// Local state for crossed-off runes
	let crossedOff = new SvelteSet<number>();
	// The armed cast target — only this card highlights; the rest of the board is untouched.
	let selectedId: number | null = $state(null);
	let gridContainer: HTMLElement;

	let seeded = false;
	$effect(() => {
		if (seeded || restoreCrossed.length === 0) return;
		for (const id of restoreCrossed) crossedOff.add(id);
		seeded = true;
	});

	// Leaving cast mode (commit or cancel) clears the highlight.
	$effect(() => {
		if (!castMode) selectedId = null;
	});

	function clearCardAnimation(card: Element) {
		gsap.killTweensOf(card);
		gsap.set(card, {
			clearProps: 'transform,filter,--card-action-scale,--card-action-brightness'
		});
	}

	function handleRuneAction(id: number) {
		if (castMode) {
			selectedId = id;
			onSelectTarget(id);
			return;
		}

		const card = gridContainer.querySelector(`.rune-card[data-rune-id="${id}"]`);
		if (card) clearCardAnimation(card);

		// Normal cross-off mode
		if (crossedOff.has(id)) {
			crossedOff.delete(id);
		} else {
			crossedOff.add(id);

			// Cross-off stinger animation
			if (card) {
				gsap.fromTo(
					card,
					{ '--card-action-scale': 0.95, '--card-action-brightness': 1.5 },
					{
						'--card-action-scale': 1,
						'--card-action-brightness': 1,
						duration: 0.3,
						ease: 'power2.out',
						clearProps: '--card-action-scale,--card-action-brightness'
					}
				);
			}
		}
		onCrossChange?.([...crossedOff]);
	}

	onMount(() => {
		// Entrance stagger. Uses `from` so the grid's resting state is fully visible if JS
		// or GSAP never runs. Skipped under reduced-motion.
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) return;
		const cards = gridContainer.querySelectorAll('.rune-card-wrapper');
		try {
			gsap.from(cards, {
				y: 20,
				opacity: 0,
				duration: 0.6,
				stagger: 0.03,
				ease: 'power2.out',
				clearProps: 'opacity,transform'
			});
		} catch (err) {
			// `from` writes opacity:0 immediately and clears it on completion — a throw
			// mid-flight would strand cards invisible. Strip the inline styles so the CSS
			// resting state shows, and surface the failure. The board must never go blank.
			cards.forEach((card) => card.removeAttribute('style'));
			console.error('Rune entrance animation failed; board forced visible.', err);
		}
	});
</script>

<!-- 
  Hero SVG Filters - Dormant in steady state. 
  Referenced via CSS during transient events like cast stingers.
-->
<svg width="0" height="0" class="sr-only">
	<defs>
		<filter id="hero-displacement">
			<feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" result="noise" />
			<feDisplacementMap
				in="SourceGraphic"
				in2="noise"
				scale="10"
				xChannelSelector="R"
				yChannelSelector="G"
			/>
		</filter>
	</defs>
</svg>

<div class="rune-grid" data-testid="rune-grid" bind:this={gridContainer}>
	{#each board as rune (rune.id)}
		<div class="rune-card-wrapper">
			<RuneCard
				{rune}
				crossed={crossedOff.has(rune.id)}
				armed={castMode}
				selected={castMode && selectedId === rune.id}
				onAction={handleRuneAction}
			/>
		</div>
	{/each}
</div>

<style>
	.rune-grid {
		display: grid;
		/* minmax(0, 1fr), not 1fr: each card's nowrap trait row has a wide min-content,
		   and plain 1fr lets columns blow out past their share (cards overflow into the
		   Oracle panel and come out uneven). minmax(0,…) caps them to equal cells. */
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 0.7rem;
		width: 100%;
		/* start (not stretch): let each card's aspect-ratio set its height so every
		   card is identical, instead of rows stretching to their tallest card. */
		align-items: start;
		/* Establish a positioning context for any future background mood layers */
		position: relative;
	}

	.rune-card-wrapper {
		/* Stable positioning wrapper for the staggered entrance. Centering keeps capped
		   embed cards from clinging to one side of an oversized grid cell. */
		display: flex;
		justify-content: center;
		width: 100%;
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
		border-width: 0;
	}
</style>
