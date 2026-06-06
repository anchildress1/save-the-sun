<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { shuffledBoard } from '$lib/boardOrder';
	import RuneCard from './RuneCard.svelte';
	import gsap from 'gsap';

	let {
		castMode = false,
		boardSeed = 0,
		onSelectTarget
	}: {
		castMode?: boolean;
		boardSeed?: number;
		onSelectTarget: (id: number) => void;
	} = $props();

	// Shuffled on-screen order, fixed per seed. Depends only on boardSeed, so cross-off
	// updates never reshuffle the board.
	let board = $derived(shuffledBoard(boardSeed));

	// Local state for crossed-off runes
	let crossedOff = new SvelteSet<number>();
	let gridContainer: HTMLElement;

	function handleRuneAction(id: number) {
		if (castMode) {
			onSelectTarget(id);
			return;
		}

		// Normal cross-off mode
		if (crossedOff.has(id)) {
			crossedOff.delete(id);
		} else {
			crossedOff.add(id);

			// Cross-off stinger animation
			const card = gridContainer.querySelector(`.rune-card[data-rune-id="${id}"]`);
			if (card) {
				gsap.fromTo(
					card,
					{ scale: 0.95, filter: 'brightness(1.5)' },
					{ scale: 1, filter: 'brightness(1)', duration: 0.3, ease: 'power2.out' }
				);
			}
		}
	}

	onMount(() => {
		// Entrance stagger. Uses `from` so the grid's resting state is fully visible —
		// if JS or GSAP never runs, the board still renders (degradation contract).
		// Skipped under reduced-motion.
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) return;
		const cards = gridContainer.querySelectorAll('.rune-card-wrapper');
		gsap.from(cards, {
			y: 20,
			opacity: 0,
			duration: 0.6,
			stagger: 0.03,
			ease: 'power2.out',
			clearProps: 'opacity,transform'
		});
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
		/* Stable positioning wrapper for the staggered entrance. Block (not flex/stretch)
		   so the card's aspect-ratio governs its height. Visible by default so a
		   failed/absent GSAP run never leaves the board blank. */
		display: block;
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
