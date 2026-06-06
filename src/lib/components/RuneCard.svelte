<script lang="ts">
	import type { Rune } from '$lib/board';

	let {
		rune,
		crossed = false,
		armed = false,
		onAction
	}: {
		rune: Rune;
		crossed?: boolean;
		armed?: boolean;
		onAction: (id: number) => void;
	} = $props();

	function handleClick() {
		onAction(rune.id);
	}

	const colorMap: Record<string, string> = {
		Blue: '#204BC9',
		Red: '#D43131',
		Green: '#299C41',
		Silver: '#E0E0E0',
		Gold: '#E8B831',
		Black: '#4a4a4a'
	};

	const elementIconMap: Record<string, string> = {
		Sun: '☼',
		Fire: '🜂',
		Air: '🜁',
		Water: '🜄',
		Earth: '🜃',
		Spirit: '✧'
	};
</script>

<button
	class="rune-card"
	class:crossed
	class:armed
	onclick={handleClick}
	aria-label={armed
		? `Select ${rune.name} as cast target`
		: crossed
			? `Restore ${rune.name}`
			: `Cross off ${rune.name}`}
>
	<div class="card-inner">
		<!-- Top Meta: Number & Color Orb -->
		<div class="meta-row top">
			<span class="rune-id">{rune.id}</span>
			<div class="color-orb" style="--gem-color: {colorMap[rune.color] || '#fff'}"></div>
		</div>

		<!-- Central Content -->
		<div class="center-content">
			<div class="glyph">{rune.glyph}</div>
			<h3 class="name">{rune.name.toUpperCase()}</h3>
			<p class="meaning">{rune.meaning.toLowerCase()}</p>
		</div>

		<!-- Bottom Stats -->
		<div class="bottom-stats">
			<div class="stats-row">
				<div class="pips" aria-label="{rune.power} {rune.fill}">
					{#each Array(rune.power) as _, i (i)}
						<span class="pip {rune.fill.toLowerCase()}"></span>
					{/each}
				</div>
				<span class="stat-text silver">{rune.power} {rune.fill.toUpperCase()}</span>
			</div>

			<div class="stats-row">
				<div class="element-box stat-text gold">
					<span class="element-icon">{elementIconMap[rune.element] || '•'}</span>
					<span>{rune.element.toUpperCase()}</span>
				</div>
				<span class="stat-text blue-gold">{rune.color.toUpperCase()}</span>
			</div>
		</div>
	</div>

	<!-- Cross-off Overlay -->
	{#if crossed}
		<div class="cross-overlay"></div>
	{/if}

	<!-- Lighting Gradient overlay -->
	<div class="lighting-overlay"></div>
</button>

<style>
	.rune-card {
		position: relative;
		display: flex;
		flex-direction: column;
		background: #0b0e14; /* Deep dark background like POC */
		border: 1px solid #c5a559; /* Gold border */
		border-radius: 4px;
		padding: 0;
		color: #e0e0e0;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		transition:
			transform 0.2s cubic-bezier(0.2, 0, 0, 1),
			border-color 0.2s;
		min-height: 200px;
		font-family: 'Cinzel', Georgia, serif; /* Fallback to elegant serif */
	}

	.rune-card:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	.rune-card:hover {
		border-color: #e8b831;
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(197, 165, 89, 0.15);
	}

	.card-inner {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0.6rem;
		z-index: 2;
		position: relative;
	}

	/* Top Meta */
	.meta-row.top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.rune-id {
		font-size: 0.85rem;
		color: #c5a559;
		line-height: 1;
	}

	.color-orb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		/* Render a shiny gem */
		background: radial-gradient(circle at 35% 35%, #ffffff 0%, var(--gem-color) 40%, #000000 90%);
		box-shadow:
			0 0 3px var(--gem-color),
			inset 0 0 2px rgba(255, 255, 255, 0.4);
		border: 1px solid rgba(0, 0, 0, 0.5);
	}

	/* Center Content */
	.center-content {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		margin: 0.5rem 0;
	}

	.glyph {
		font-size: 3.5rem;
		line-height: 1;
		color: #c5a559;
		font-weight: 300;
		margin-bottom: 0.25rem;
	}

	.name {
		margin: 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: #c5a559;
		letter-spacing: 0.1em;
	}

	.meaning {
		margin: 0.15rem 0 0 0;
		font-size: 0.65rem;
		color: #d8d8d8;
		font-family: system-ui, sans-serif;
	}

	/* Bottom Stats */
	.bottom-stats {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-top: auto;
		padding-top: 0.5rem;
		border-top: 1px solid rgba(197, 165, 89, 0.2);
	}

	.stats-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.stat-text {
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		font-size: 0.6rem;
		letter-spacing: 0.05em;
	}

	.stat-text.silver {
		color: #d8d8d8;
	}

	.stat-text.gold {
		color: #c5a559;
	}

	.stat-text.blue-gold {
		/* A slightly muted gold/blue for the color text to match the POC */
		color: #9aa5b1;
	}

	.pips {
		display: flex;
		gap: 4px;
		align-items: center;
	}

	.pip {
		/* Reactive sizes but equal: using em makes them scale with font size */
		width: 0.5em;
		height: 0.5em;
		border-radius: 50%;
		border: 1px solid #d8d8d8;
		display: inline-block;
	}

	.pip.light {
		background: transparent;
	}

	.pip.dark {
		background: #d8d8d8;
	}

	.element-box {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.element-icon {
		font-size: 0.8rem;
		line-height: 1;
	}

	/* Cross-off State */
	.rune-card.crossed .card-inner {
		opacity: 0.25;
		filter: grayscale(80%) brightness(0.8);
	}

	.rune-card.crossed:hover .card-inner {
		opacity: 0.4;
	}

	/* Big X overlay to match POC */
	.cross-overlay {
		position: absolute;
		inset: 0;
		z-index: 3;
		background:
			linear-gradient(
				to bottom right,
				transparent 48%,
				rgba(160, 160, 160, 0.7) 49%,
				rgba(160, 160, 160, 0.7) 51%,
				transparent 52%
			),
			linear-gradient(
				to top right,
				transparent 48%,
				rgba(160, 160, 160, 0.7) 49%,
				rgba(160, 160, 160, 0.7) 51%,
				transparent 52%
			);
		pointer-events: none;
	}

	/* Armed State (Casting) */
	.rune-card.armed {
		border-color: #e8b831;
		box-shadow: 0 0 15px rgba(232, 184, 49, 0.2);
	}

	.rune-card.armed.crossed .card-inner {
		opacity: 1;
		filter: none;
	}

	/* Lighting Engine Overlay */
	.lighting-overlay {
		position: absolute;
		inset: 0;
		z-index: 1;
		background: radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.08) 0%, transparent 80%);
		mix-blend-mode: screen;
		pointer-events: none;
		opacity: 0.6;
		transition: opacity 0.3s ease;
	}

	.rune-card:hover .lighting-overlay {
		opacity: 1;
	}
</style>
