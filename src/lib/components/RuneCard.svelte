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
		<!-- Top Meta -->
		<div class="meta-row top">
			<span class="element" title="{rune.element} Element">{rune.element}</span>
			<span class="power" aria-label="Power {rune.power}">
				{#each [0, 1, 2, 3, 4] as i (i)}
					<span class="pip" class:filled={i < rune.power}></span>
				{/each}
			</span>
		</div>

		<!-- Central Glyph -->
		<div class="glyph-container">
			<div class="glyph">{rune.glyph}</div>
		</div>

		<!-- Identity -->
		<div class="identity">
			<h3 class="name">{rune.name}</h3>
			<p class="meaning">{rune.meaning}</p>
		</div>

		<!-- Bottom Meta -->
		<div class="meta-row bottom">
			<span class="polarity" class:dark={rune.fill === 'Dark'}>{rune.fill}</span>
			<div class="color-swatch-container" title="Color: {rune.color}">
				<div class="color-swatch" style="--swatch-color: {rune.color.toLowerCase()}"></div>
				<span class="sr-only">{rune.color}</span>
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
		background: #0f0f11;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		padding: 0;
		color: #e0e0e0;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
		min-height: 180px;
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			sans-serif;
	}

	.rune-card:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}

	.rune-card:hover {
		border-color: #4a4a4a;
		transform: translateY(-2px);
	}

	.card-inner {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0.75rem;
		z-index: 2;
		position: relative;
	}

	/* Top Meta */
	.meta-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.75rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.power {
		display: flex;
		gap: 2px;
	}

	.pip {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		border: 1px solid #666;
	}

	.pip.filled {
		background: #ccc;
		border-color: #ccc;
	}

	/* Glyph */
	.glyph-container {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0.5rem 0;
	}

	.glyph {
		font-size: 3rem;
		line-height: 1;
		color: #eee;
		font-weight: 300;
	}

	/* Identity */
	.identity {
		margin-bottom: 0.75rem;
	}

	.name {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: #fff;
		letter-spacing: 0.02em;
	}

	.meaning {
		margin: 0.25rem 0 0 0;
		font-size: 0.8rem;
		color: #999;
		font-style: italic;
	}

	/* Bottom Meta */
	.polarity.dark {
		color: #666;
	}

	.color-swatch-container {
		display: flex;
		align-items: center;
	}

	.color-swatch {
		width: 12px;
		height: 12px;
		border-radius: 2px;
		background-color: var(--swatch-color);
		border: 1px solid rgba(255, 255, 255, 0.2);
	}

	/* Cross-off State */
	.rune-card.crossed .card-inner {
		opacity: 0.3;
		filter: grayscale(100%);
	}

	.rune-card.crossed:hover .card-inner {
		opacity: 0.5;
	}

	.cross-overlay {
		position: absolute;
		inset: 0;
		z-index: 3;
		background: linear-gradient(
			to bottom right,
			transparent 48%,
			rgba(200, 0, 0, 0.5) 49%,
			rgba(200, 0, 0, 0.5) 51%,
			transparent 52%
		);
		pointer-events: none;
	}

	/* Armed State (Casting) */
	.rune-card.armed {
		border-color: #888;
	}

	.rune-card.armed:hover {
		border-color: #fff;
		box-shadow: 0 0 12px rgba(255, 255, 255, 0.1);
	}

	.rune-card.armed.crossed .card-inner {
		/* Bring back full opacity if it's targeted during cast mode */
		opacity: 1;
		filter: none;
	}

	/* Lighting Engine Overlay */
	.lighting-overlay {
		position: absolute;
		inset: 0;
		z-index: 1;
		background: radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.05) 0%, transparent 70%);
		mix-blend-mode: screen;
		pointer-events: none;
		opacity: 0.5;
		transition: opacity 0.3s ease;
	}

	.rune-card:hover .lighting-overlay {
		opacity: 1;
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
