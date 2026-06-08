<script lang="ts">
	import type { Rune } from '$lib/board';
	import {
		gemColor,
		elementIcon,
		runeSymbolAsset,
		colorIconAsset,
		CARD_BACKGROUND_ASSET
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
	let cardStyle = $derived(`--gem: ${gem}; --card-background: url("${CARD_BACKGROUND_ASSET}");`);
	let pips = $derived(Array.from({ length: rune.power }, (_, i) => i));
	let fillWord = $derived(rune.fill.toLowerCase());
	let symbolFailed = $state(false);
	let colorIconFailed = $state(false);
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
	<div class="ambient" aria-hidden="true"></div>

	<header class="card-top">
		<span class="trait element"
			><span class="ic" aria-hidden="true">{icon}</span>{rune.element}</span
		>
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
		<!-- Pips are aria-hidden, so they carry power for sighted players only: pip count =
		     power, pip fill = light/dark (white fill = light, black fill = dark). The numeric
		     value is never written; screen-reader players get it from the button's accessible
		     name ("{n} {light|dark} power"). The label beside the pips names the trait. -->
		<span class="trait power">
			<span class="pips" aria-hidden="true">
				{#each pips as i (i)}
					<span class="pip" class:dark={rune.fill === 'Dark'}></span>
				{/each}
			</span>
			<span class="power-label">power</span>
		</span>
	</footer>

	<!-- Chalk-style X: corner-to-corner diagonals inset so they reach toward the edges
	     without touching them. Stays visible in cast mode so the player keeps sight of every
	     elimination while choosing what to cast — a crossed rune is still legal to cast. -->
	{#if crossed}
		<svg class="strikeout" viewBox="0 0 80 100" preserveAspectRatio="none" aria-hidden="true">
			<line x1="5" y1="6" x2="75" y2="94" />
			<line x1="75" y1="6" x2="5" y2="94" />
		</svg>
	{/if}
</button>

<style>
	.rune-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		/* width:100% + min-width:0 — a <button> defaults to fit-content, and its nowrap
		   trait row sets a wide min-content; min-width:0 lets the card shrink to its grid
		   cell (overflow is clipped) so all 24 cards are identical. */
		width: 100%;
		min-width: 0;
		aspect-ratio: 4 / 5;
		padding: 0.5rem 0.55rem;
		text-align: left;
		cursor: pointer;
		overflow: hidden;
		border: 1px solid var(--stone-edge);
		border-radius: 7px;
		color: var(--stone-ink);
		background:
			radial-gradient(circle at 50% 16%, rgba(255, 255, 255, 0.22) 0%, transparent 55%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.18) 100%),
			var(--card-background) center / 100% 100% no-repeat,
			linear-gradient(180deg, var(--stone-top) 0%, var(--stone-bottom) 100%);
		box-shadow:
			0 6px 18px rgba(0, 0, 0, 0.45),
			inset 0 0 0 1px rgba(255, 255, 255, 0.08);
		transition:
			transform 0.25s cubic-bezier(0.2, 0, 0, 1),
			border-color 0.25s ease,
			box-shadow 0.25s ease;
	}

	.rune-card:hover {
		transform: translateY(-3px);
		border-color: var(--gold);
		box-shadow:
			0 10px 26px rgba(0, 0, 0, 0.6),
			0 0 16px rgba(217, 169, 74, 0.18);
	}

	.rune-card:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 2px;
	}

	.ambient {
		position: absolute;
		inset: -30% -10% auto -10%;
		height: 90%;
		background: radial-gradient(circle at 50% 0%, var(--gem) 0%, transparent 62%);
		opacity: 0.18;
		/* multiply, not screen: on the light stone a colour tint must darken, not wash out. */
		mix-blend-mode: multiply;
		pointer-events: none;
	}
	.rune-card:hover .ambient {
		opacity: 0.3;
	}

	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.4rem;
		/* element (left) + colour (right) share this small uppercase label style */
		font-size: 0.62rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--stone-ink-muted);
		position: relative;
		z-index: 2;
	}

	.color-mark {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.22rem;
	}

	.color-name {
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--stone-ink-muted);
		line-height: 1;
	}

	.color-icon-image {
		display: block;
		width: 22px;
		height: 22px;
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
		width: min(74%, 4.75rem);
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
		color: var(--stone-ink);
		text-shadow:
			0 1px 0 rgba(255, 255, 255, 0.3),
			0 -1px 1px rgba(0, 0, 0, 0.28);
	}

	.name {
		max-width: 100%;
		font-family: var(--font-display);
		font-size: 0.9rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--stone-ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Smaller, quieter line under the name. */
	.meaning {
		max-width: 100%;
		font-size: 0.62rem;
		font-style: italic;
		color: var(--stone-ink-muted);
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
		gap: 0.3rem;
		padding-top: 0.36rem;
		border-top: 1px solid rgba(0, 0, 0, 0.18);
		font-size: 0.7rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--stone-ink-muted);
		overflow: hidden;
	}

	.trait {
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
		white-space: nowrap;
		min-width: 0;
	}
	.trait.element {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.ic {
		color: var(--stone-ink-muted);
		font-size: 0.82rem;
	}

	.pips {
		display: inline-flex;
		gap: 2px;
	}

	/* Pips show power count; fill encodes light/dark literally — white fill = light, black
	   fill = dark — both legible directly on the gray stone card. The white pip keeps a thin
	   dark rim so it reads against the stone. */
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
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 5;
		pointer-events: none;
	}
	/* Round caps read as a chalk stroke, dark so it reads on the light stone; vector-effect
	   keeps the line an even thickness despite the non-uniform viewBox scaling. */
	.strikeout line {
		stroke: var(--stone-strike);
		stroke-width: 2.5;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}

	/* The chosen cast target: gold halo on that one card only — the rest of the board is
	   unchanged, crossings and all. Its content is restored to readable even if crossed
	   (you can read what you're about to cast); the X stays so you still see it was ruled out. */
	.rune-card.selected {
		border-color: var(--gold-bright);
		box-shadow:
			0 0 0 1px var(--gold-bright),
			0 0 22px rgba(217, 169, 74, 0.35);
	}
	.rune-card.selected .ambient {
		opacity: 0.3;
	}
	.rune-card.selected.crossed .card-top,
	.rune-card.selected.crossed .middle,
	.rune-card.selected.crossed .traits {
		opacity: 1;
		filter: none;
	}
</style>
