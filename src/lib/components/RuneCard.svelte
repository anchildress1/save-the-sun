<script lang="ts">
	import type { Rune } from '$lib/board';
	import {
		gemColor,
		elementIcon,
		runeSymbolAsset,
		colorIconAsset,
		elementIconAsset,
		fillIconAsset,
		CARD_BACKGROUND_ASSET,
		CHALK_CROSS_ASSET
	} from './runeVisuals';

	let {
		rune,
		crossed = false,
		armed = false,
		selected = false,
		onAction
	}: {
		rune: Rune;
		crossed?: boolean;
		armed?: boolean;
		selected?: boolean;
		onAction: (id: number) => void;
	} = $props();

	let gem = $derived(gemColor(rune.color));
	let icon = $derived(elementIcon(rune.element));
	let symbol = $derived(runeSymbolAsset(rune.name));
	let colorIcon = $derived(colorIconAsset(rune.color));
	let elementIconImage = $derived(elementIconAsset(rune.element));
	let fillIcon = $derived(fillIconAsset(rune.fill));
	let cardStyle = $derived(`--gem: ${gem};`);
	let pips = $derived(Array.from({ length: rune.power }, (_, i) => i));
	let fillWord = $derived(rune.fill.toLowerCase());
	let symbolFailed = $state(false);
	let colorIconFailed = $state(false);
	let elementIconFailed = $state(false);
	let fillIconFailed = $state(false);
	let chalkCrossFailed = $state(false);
</script>

<button
	class="rune-card"
	class:crossed
	class:selected
	data-rune-id={rune.id}
	data-rune-name={rune.name}
	onclick={() => onAction(rune.id)}
	style={cardStyle}
	aria-label={armed
		? `Select ${rune.name} as cast target, ${rune.power} ${fillWord} power`
		: crossed
			? `Restore ${rune.name}, ${rune.power} ${fillWord} power`
			: `Cross off ${rune.name}, ${rune.power} ${fillWord} power`}
>
	<img
		class="card-background-image"
		src={CARD_BACKGROUND_ASSET}
		alt=""
		aria-hidden="true"
		decoding="async"
	/>
	<div class="ambient" aria-hidden="true"></div>

	<header class="card-top">
		<span class="trait element">
			{#if !elementIconFailed}
				<img
					class="element-icon-image"
					src={elementIconImage}
					alt=""
					aria-hidden="true"
					decoding="async"
					onerror={() => (elementIconFailed = true)}
				/>
			{:else}
				<span class="ic" aria-hidden="true">{icon}</span>
			{/if}
			<span class="element-name">{rune.element}</span>
		</span>
		<!-- Colour shown once: a gem dot beside its name (no-colour-alone), top-right. The
		     rune id is not shown — it is an internal index, not player information. -->
		<span class="color-mark">
			{#if !colorIconFailed}
				<img
					class="color-icon-image"
					src={colorIcon}
					alt=""
					aria-hidden="true"
					decoding="async"
					onerror={() => (colorIconFailed = true)}
				/>
			{:else}
				<span class="gem" aria-hidden="true"></span>
			{/if}
			<span class="color-name">{rune.color}</span>
		</span>
	</header>

	<div class="middle">
		<span class="symbol">
			{#if !symbolFailed}
				<img
					class="rune-symbol-image"
					src={symbol}
					alt=""
					aria-hidden="true"
					decoding="async"
					onerror={() => (symbolFailed = true)}
				/>
			{:else}
				<span class="glyph" aria-hidden="true">{rune.glyph}</span>
			{/if}
		</span>
		<span class="name">{rune.name}</span>
		<span class="meaning">{rune.meaning}</span>
	</div>

	<footer class="traits">
		<!-- Pips are aria-hidden, so they carry power for sighted players only. The numeric
		     value is never written; screen-reader players get it from the button's accessible
		     name ("{n} {light|dark} power"). The label beside the pips names the trait. -->
		<span class="trait power">
			<span class="pips" aria-hidden="true">
				{#each pips as i (i)}
					{#if !fillIconFailed}
						<img
							class="pip-image"
							src={fillIcon}
							alt=""
							aria-hidden="true"
							decoding="async"
							onerror={() => (fillIconFailed = true)}
						/>
					{:else}
						<span class="pip" class:dark={rune.fill === 'Dark'}></span>
					{/if}
				{/each}
			</span>
			<span class="power-label">power</span>
		</span>
	</footer>

	{#if crossed}
		{#if !chalkCrossFailed}
			<img
				class="strikeout"
				src={CHALK_CROSS_ASSET}
				alt=""
				aria-hidden="true"
				decoding="async"
				onerror={() => (chalkCrossFailed = true)}
			/>
		{:else}
			<span class="strikeout-fallback" aria-hidden="true">X</span>
		{/if}
	{/if}
</button>

<style>
	.rune-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0;
		/* width:100% + min-width:0 — a <button> defaults to fit-content, and its nowrap
		   trait row sets a wide min-content; min-width:0 lets the card shrink to its grid
		   cell (overflow is clipped) so all 24 cards are identical. */
		width: 100%;
		min-width: 0;
		aspect-ratio: 4 / 5;
		padding: 0.72rem 0.74rem 0.96rem;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		border: 1px solid transparent;
		border-radius: 7px;
		color: #f4ead6;
		background: transparent;
		box-shadow: none;
		text-shadow:
			0 1px 2px rgba(0, 0, 0, 0.75),
			0 0 8px rgba(0, 0, 0, 0.35);
		--card-text: #f4ead6;
		--card-label: #f3e8cf;
		--card-muted: #d9ccb0;
		--element-icon-size: 34px;
		--color-icon-size: 40px;
		--pip-icon-size: 18px;
		--stone-brightness: 1;
		--stone-contrast: 1;
		--card-glow-opacity: 0.14;
		transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1);
	}

	.rune-card:hover {
		transform: translateY(-3px);
		--stone-brightness: 1.07;
		--stone-contrast: 1.03;
		--card-glow-opacity: 0.24;
	}

	.rune-card:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 2px;
	}

	.card-background-image {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
		filter: brightness(var(--stone-brightness)) contrast(var(--stone-contrast));
		transition: filter 0.2s ease;
	}

	.ambient {
		position: absolute;
		inset: -30% -10% auto -10%;
		z-index: 1;
		height: 90%;
		background: radial-gradient(circle at 50% 0%, var(--gem) 0%, transparent 62%);
		opacity: var(--card-glow-opacity);
		mix-blend-mode: multiply;
		pointer-events: none;
	}

	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.12rem 0.1rem 0;
		/* element (left) + colour (right) share this small uppercase label style */
		font-size: 0.66rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--card-label);
		position: relative;
		z-index: 2;
	}

	.color-mark {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.16rem;
	}

	.trait.element {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.16rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.element-name,
	.color-name {
		font-size: 0.66rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--card-label);
		line-height: 1;
	}

	.color-icon-image {
		display: block;
		width: var(--color-icon-size);
		height: var(--color-icon-size);
		object-fit: contain;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45));
	}

	/* Fallback when an icon image cannot load; the visible colour name still carries the trait. */
	.gem {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.85), var(--gem) 65%);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.45),
			inset 0 0 2px rgba(0, 0, 0, 0.4);
	}

	.middle {
		position: relative;
		z-index: 2;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		text-align: center;
	}

	.symbol {
		display: grid;
		place-items: center;
		width: 100%;
		height: clamp(3.2rem, 5.7vw, 4.9rem);
	}

	.rune-symbol-image {
		display: block;
		width: min(68%, 4.35rem);
		height: 100%;
		object-fit: contain;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
	}

	/* Backup text when an image cannot load: same old carved glyph, only now it is Plan B
	   instead of the headline act. */
	.glyph {
		font-family: var(--font-display);
		font-size: clamp(2.4rem, 3.8vw, 3.6rem);
		line-height: 1;
		color: var(--card-text);
		text-shadow:
			0 1px 2px rgba(0, 0, 0, 0.75),
			0 0 8px rgba(0, 0, 0, 0.35);
	}

	.name {
		max-width: 100%;
		font-family: var(--font-display);
		font-size: 0.9rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--card-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Smaller, quieter line under the name. */
	.meaning {
		max-width: 100%;
		font-size: 0.74rem;
		font-style: italic;
		color: var(--card-muted);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Footer holds the power row only — element and colour live in the top corners. */
	.traits {
		position: relative;
		z-index: 2;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.35rem;
		padding-top: 0.28rem;
		border-top: 1px solid rgba(255, 244, 214, 0.24);
		font-size: 0.74rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--card-label);
		overflow: hidden;
	}

	.trait {
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
		white-space: nowrap;
		min-width: 0;
	}

	.trait.power {
		gap: 0.1rem;
		max-width: 100%;
	}
	.element-icon-image {
		display: block;
		width: var(--element-icon-size);
		height: var(--element-icon-size);
		flex: 0 0 var(--element-icon-size);
		object-fit: contain;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
	}

	.ic {
		color: var(--card-label);
		font-size: 0.82rem;
	}

	.pips {
		display: inline-flex;
		align-items: center;
		gap: 0;
		height: var(--pip-icon-size);
	}

	.power-label {
		font-size: 0.68rem;
		letter-spacing: 0.03em;
	}

	.pip-image {
		display: block;
		width: var(--pip-icon-size);
		height: var(--pip-icon-size);
		flex: 0 0 var(--pip-icon-size);
		object-fit: contain;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
	}

	/* Backup pips for fill-icon load failure; the light pip keeps a rim against the stone. */
	.pip {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--pip-light);
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
	}
	.pip.dark {
		background: var(--pip-dark);
		box-shadow: none;
	}

	/* Crossed-off: dim the content, keep the strike vivid. */
	.rune-card.crossed {
		border-color: rgba(0, 0, 0, 0.18);
	}
	.rune-card.crossed .card-top,
	.rune-card.crossed .middle,
	.rune-card.crossed .traits {
		opacity: 0.32;
		filter: grayscale(80%);
	}
	.rune-card.crossed .ambient {
		opacity: 0;
	}

	.strikeout {
		position: absolute;
		inset: 5% 4%;
		width: 92%;
		height: 90%;
		z-index: 5;
		object-fit: fill;
		opacity: 0.86;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
		pointer-events: none;
	}

	.strikeout-fallback {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: grid;
		place-items: center;
		color: rgba(255, 255, 255, 0.72);
		font-family: var(--font-display);
		font-size: 9rem;
		line-height: 1;
		pointer-events: none;
	}

	/* The chosen cast target: gold halo on that one card only — the rest of the board is
	   unchanged, crossings and all. Its content is restored to readable even if crossed
	   (you can read what you're about to cast); the X stays so you still see it was ruled out. */
	.rune-card.selected {
		--stone-brightness: 1.14;
		--stone-contrast: 1.06;
		--card-glow-opacity: 0.28;
	}
	.rune-card.selected.crossed .card-top,
	.rune-card.selected.crossed .middle,
	.rune-card.selected.crossed .traits {
		opacity: 1;
		filter: none;
	}
</style>
