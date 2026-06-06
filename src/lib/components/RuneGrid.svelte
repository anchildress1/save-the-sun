<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { runes } from '$lib/board';
	import RuneCard from './RuneCard.svelte';
	import gsap from 'gsap';

	let {
		castMode = false,
		onSelectTarget
	}: {
		castMode?: boolean;
		onSelectTarget: (id: number) => void;
	} = $props();

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
			const card = gridContainer.querySelector(`[data-rune-id="${id}"]`);
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
		// Entrance stagger animation
		const cards = gridContainer.querySelectorAll('.rune-card-wrapper');
		gsap.fromTo(
			cards,
			{ y: 20, opacity: 0 },
			{ y: 0, opacity: 1, duration: 0.6, stagger: 0.03, ease: 'power2.out' }
		);
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

<div class="rune-grid" bind:this={gridContainer}>
	{#each runes as rune (rune.id)}
		<div class="rune-card-wrapper" data-rune-id={rune.id}>
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
		grid-template-columns: repeat(6, 1fr);
		gap: 1rem;
		width: 100%;
		/* Establish a positioning context for any future background mood layers */
		position: relative;
	}

	.rune-card-wrapper {
		/* Used as a stable positioning wrapper for the staggered entrance */
		opacity: 0;
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
