<script lang="ts">
	import { onMount } from 'svelte';
	import { runes } from '$lib/board';

	let canvas: HTMLCanvasElement;
	let crossedRunes = $state(new Set<number>());

	const WIDTH = 1600;
	const HEIGHT = 900;
	const COLS = 6;
	const ROWS = 4;
	const MARGIN = 40;
	const GAP = 20;

	const CARD_W = (WIDTH - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
	const CARD_H = (HEIGHT - 2 * MARGIN - (ROWS - 1) * GAP) / ROWS;

	function toggleRune(id: number) {
		if (crossedRunes.has(id)) {
			crossedRunes.delete(id);
		} else {
			crossedRunes.add(id);
		}
	}

	function draw() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Clear background
		ctx.fillStyle = '#0a0a0a';
		ctx.fillRect(0, 0, WIDTH, HEIGHT);

		runes.forEach((rune, i) => {
			const col = i % COLS;
			const row = Math.floor(i / COLS);

			const x = MARGIN + col * (CARD_W + GAP);
			const y = MARGIN + row * (CARD_H + GAP);

			const isCrossed = crossedRunes.has(rune.id);

			drawCard(ctx, rune, x, y, CARD_W, CARD_H, isCrossed);
		});
	}

	function drawCard(
		ctx: CanvasRenderingContext2D,
		rune: (typeof runes)[0],
		x: number,
		y: number,
		w: number,
		h: number,
		isCrossed: boolean
	) {
		ctx.save();
		ctx.translate(x, y);

		// Card background
		ctx.fillStyle = isCrossed ? '#151515' : '#1e1e1e';
		ctx.strokeStyle = isCrossed ? '#333' : '#444';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.roundRect(0, 0, w, h, 6);
		ctx.fill();
		ctx.stroke();

		ctx.globalAlpha = isCrossed ? 0.3 : 1.0;

		// Glyph
		ctx.fillStyle = '#fff';
		ctx.font = 'bold 50px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(rune.glyph, w / 2, 45);

		// Name & Meaning
		ctx.font = 'bold 16px sans-serif';
		ctx.fillText(rune.name, w / 2, 90);

		ctx.font = 'italic 12px sans-serif';
		ctx.fillStyle = '#aaa';
		ctx.fillText(rune.meaning, w / 2, 110);

		// Traits background area
		ctx.fillStyle = isCrossed ? '#0f0f0f' : '#161616';
		ctx.beginPath();
		ctx.roundRect(10, 130, w - 20, h - 140, 4);
		ctx.fill();

		ctx.fillStyle = '#ccc';
		ctx.font = '12px sans-serif';
		ctx.textAlign = 'left';

		const pipChar = rune.fill === 'Light' ? '○' : '●';
		let pips = '';
		for (let p = 0; p < rune.power; p++) pips += pipChar;

		const leftX = 20;
		let textY = 148;
		const lineH = 18;

		ctx.fillText(`Power ${rune.power} ${pips}`, leftX, textY);
		textY += lineH;

		ctx.fillText(`Element: ${rune.element}`, leftX, textY);
		textY += lineH;

		ctx.fillText(`Fill: ${rune.fill} ${pipChar}`, leftX, textY);
		textY += lineH;

		ctx.fillText(`Color: ${rune.color}`, leftX, textY);
		ctx.fillStyle = mapColor(rune.color);
		ctx.beginPath();
		ctx.arc(leftX + 85, textY - 4, 5, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 1;
		ctx.stroke();

		if (isCrossed) {
			ctx.globalAlpha = 0.8;
			ctx.strokeStyle = '#660000';
			ctx.lineWidth = 3;
			ctx.beginPath();
			ctx.moveTo(w * 0.2, h * 0.2);
			ctx.lineTo(w * 0.8, h * 0.8);
			ctx.moveTo(w * 0.8, h * 0.2);
			ctx.lineTo(w * 0.2, h * 0.8);
			ctx.stroke();
		}

		ctx.restore();
	}

	function mapColor(colorName: string) {
		const c = colorName.toLowerCase();
		if (c === 'gold') return '#ffd700';
		if (c === 'silver') return '#c0c0c0';
		if (c === 'black') return '#000000';
		return c; // red, green, blue
	}

	$effect(() => {
		// Trigger reactivity when size changes
		crossedRunes.size;
		draw();
	});

	onMount(() => {
		// Needs to run after fonts might load, so let's use a slight delay or Document.fonts
		if (typeof document !== 'undefined' && document.fonts) {
			document.fonts.ready.then(draw);
		} else {
			draw();
		}
	});
</script>

<div class="board-container">
	<canvas bind:this={canvas} width={WIDTH} height={HEIGHT}></canvas>

	<div class="overlay-grid">
		{#each runes as rune (rune.id)}
			<button
				class="rune-overlay-btn"
				aria-label="{rune.name}, {rune.meaning}. Element: {rune.element}, Power: {rune.power}, Fill: {rune.fill}, Color: {rune.color}. {crossedRunes.has(
					rune.id
				)
					? 'Crossed off. Click to restore.'
					: 'Click to cross off.'}"
				onclick={() => toggleRune(rune.id)}
			>
				<span class="visually-hidden">{rune.name}</span>
			</button>
		{/each}
	</div>
</div>

<style>
	.board-container {
		position: relative;
		width: 100%;
		max-width: 1200px;
		margin: 0 auto;
		aspect-ratio: 16 / 9;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
		background: #0a0a0a;
		border-radius: 8px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
	}

	.overlay-grid {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		grid-template-rows: repeat(4, 1fr);

		/* padding = MARGIN / (WIDTH or HEIGHT) * 100% */
		/* gap = GAP / (WIDTH or HEIGHT) * 100% */
		padding: calc(40 / 900 * 100%) calc(40 / 1600 * 100%);
		gap: calc(20 / 900 * 100%) calc(20 / 1600 * 100%);
	}

	.rune-overlay-btn {
		appearance: none;
		background: transparent;
		border: 2px solid transparent;
		cursor: pointer;
		width: 100%;
		height: 100%;
		border-radius: 6px; /* slightly smaller than drawn radius */
		outline: none;
	}

	.rune-overlay-btn:focus-visible {
		border-color: #fff;
		box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.2);
	}

	.visually-hidden {
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
