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

		if (crossedOff.has(id)) {
			crossedOff.delete(id);
		} else {
			crossedOff.add(id);

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
		grid-template-columns: repeat(var(--rune-grid-columns, 6), minmax(0, 1fr));
		gap: var(--rune-grid-gap, 0.7rem);
		width: 100%;
		max-width: var(--rune-grid-max-inline-size, none);
		margin-inline: auto;
		/* start (not stretch): let each card's aspect-ratio set its height so every
		   card is identical, instead of rows stretching to their tallest card. */
		align-items: start;
		/* Establish a positioning context for any future background mood layers */
		position: relative;
	}

	.rune-card-wrapper {
		/* Stable positioning wrapper for the staggered entrance. Visible by default so a
		   failed/absent GSAP run never leaves the board blank. Also the card's size
		   container: the card's cqi-scaled internals track the grid cell, not the viewport. */
		display: block;
		container-type: inline-size;
	}
</style>
