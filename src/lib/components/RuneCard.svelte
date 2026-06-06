<script lang="ts">
	import type { Rune } from '$lib/board';
	import { gemColor, elementIcon } from './runeVisuals';

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

	let gem = $derived(gemColor(rune.color));
	let icon = $derived(elementIcon(rune.element));
	let pips = $derived(Array.from({ length: rune.power }, (_, i) => i));
	let fillWord = $derived(rune.fill === 'Light' ? 'light' : 'dark');
</script>

<button
	class="rune-card"
	class:crossed
	class:armed
	data-rune-id={rune.id}
	data-rune-name={rune.name}
	onclick={() => onAction(rune.id)}
	style="--gem: {gem};"
	aria-label={armed
		? `Select ${rune.name} as cast target, ${rune.power} ${fillWord} power`
		: crossed
			? `Restore ${rune.name}, ${rune.power} ${fillWord} power`
			: `Cross off ${rune.name}, ${rune.power} ${fillWord} power`}
>
	<div class="ambient" aria-hidden="true"></div>

	<header class="card-top">
		<span class="name">{rune.name}</span>
		<!-- Color shown once: the dot plus its name (no-color-alone), top-right. The
		     rune id is not shown — it is an internal index, not player information. -->
		<span class="color-mark">
			<span class="gem" aria-hidden="true"></span>
			<span class="color-name">{rune.color}</span>
		</span>
	</header>

	<div class="middle">
		<span class="glyph">{rune.glyph}</span>
		<span class="meaning">{rune.meaning}</span>
	</div>

	<footer class="traits">
		<span class="trait element"
			><span class="ic" aria-hidden="true">{icon}</span>{rune.element}</span
		>
		<!-- Pips ARE the power value: count = power, fill = light/dark (white = light,
		     black = dark). The "POWER" label names the trait; the value is shown by the pip
		     count and narrated in the accessible name as "{n} {light|dark} power". -->
		<span class="trait power">
			<span class="pips" aria-hidden="true">
				{#each pips as i (i)}
					<span class="pip" class:dark={rune.fill === 'Dark'}></span>
				{/each}
			</span>
			<span class="power-label">power</span>
		</span>
	</footer>

	{#if crossed}
		<span class="strike s1" aria-hidden="true"></span>
		<span class="strike s2" aria-hidden="true"></span>
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
		border: 1px solid var(--gold-dim);
		border-radius: 7px;
		color: var(--ink);
		background:
			radial-gradient(circle at 50% 18%, rgba(255, 255, 255, 0.04) 0%, transparent 55%),
			linear-gradient(180deg, var(--bg-card-top) 0%, var(--bg-card-bottom) 100%);
		box-shadow:
			0 6px 18px rgba(0, 0, 0, 0.45),
			inset 0 0 0 1px rgba(255, 255, 255, 0.02);
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
		opacity: 0.16;
		mix-blend-mode: screen;
		pointer-events: none;
	}
	.rune-card:hover .ambient {
		opacity: 0.28;
	}

	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.4rem;
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
		color: var(--ink-muted);
		line-height: 1;
	}

	.gem {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.7), var(--gem) 60%);
		box-shadow:
			0 0 8px var(--gem),
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

	.glyph {
		font-family: var(--font-display);
		font-size: clamp(2.4rem, 3.8vw, 3.6rem);
		line-height: 1;
		color: var(--gold-bright);
		text-shadow:
			0 0 10px rgba(217, 169, 74, 0.55),
			0 0 26px rgba(217, 169, 74, 0.25);
	}

	.name {
		font-family: var(--font-display);
		font-size: 0.82rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--gold);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meaning {
		font-size: 0.66rem;
		font-style: italic;
		color: var(--ink-muted);
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* One row: element (left) + power (right). Hue moved up by the color dot, so the
	   line has room even for 6-pip earth runes. */
	.traits {
		position: relative;
		z-index: 2;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.3rem;
		padding-top: 0.36rem;
		border-top: 1px solid var(--gold-faint);
		font-size: 0.7rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		color: var(--ink-muted);
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
		color: var(--gold-bright);
		font-size: 0.88rem;
	}

	.pips {
		display: inline-flex;
		gap: 2px;
	}

	/* Pips show power count; fill encodes light/dark — white = light, black = dark.
	   The dark pip gets a light ring so it doesn't vanish into the navy card. */
	.pip {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.92);
	}
	.pip.dark {
		background: #0c0c12;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
	}

	/* Crossed-off: dim the content, keep the strike vivid. */
	.rune-card.crossed {
		border-color: rgba(255, 255, 255, 0.06);
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

	.strike {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 132%;
		height: 2px;
		background: var(--strike);
		box-shadow: 0 0 8px rgba(200, 71, 63, 0.7);
		z-index: 5;
		pointer-events: none;
	}
	.s1 {
		transform: translate(-50%, -50%) rotate(32deg);
	}
	.s2 {
		transform: translate(-50%, -50%) rotate(-32deg);
	}

	/* Armed for cast: gold halo, content restored even if crossed. */
	.rune-card.armed {
		border-color: var(--gold-bright);
		box-shadow:
			0 0 0 1px var(--gold-bright),
			0 0 22px rgba(217, 169, 74, 0.35);
	}
	.rune-card.armed .ambient {
		opacity: 0.3;
	}
	.rune-card.armed.crossed .card-top,
	.rune-card.armed.crossed .middle,
	.rune-card.armed.crossed .traits {
		opacity: 1;
		filter: none;
	}
</style>
