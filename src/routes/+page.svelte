<script lang="ts">
	import CanvasBoard from '$lib/components/CanvasBoard.svelte';
</script>

<main>
	<header>
		<div>
			<h1>Save the Sun</h1>
			<p>A rite for the longest day.</p>
		</div>
		<div class="night-progress">The dark holds.</div>
		<div class="turn-pill">Your move.</div>
	</header>

	<div class="game-layout">
		<section class="board-section">
			<CanvasBoard />
		</section>

		<aside class="right-column">
			<div class="rite-transcript">
				<p>Twenty-four runes stand. None ruled out. Ask the Oracle.</p>
			</div>

			<div class="reactions-panel">
				<button disabled>Scry</button>
				<button disabled>Hex</button>
			</div>

			<div class="ask-panel">
				<label for="oracle-ask">Ask the Oracle — one sign at a time</label>
				<input type="text" id="oracle-ask" placeholder="e.g. Is it a water rune?" />
			</div>

			<div class="cast-panel">
				<button class="cast-btn">Cast the rune</button>
			</div>
		</aside>
	</div>
</main>

<style>
	:global(body) {
		background-color: #050505;
		color: #e0e0e0;
		margin: 0;
		font-family:
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			Roboto,
			sans-serif;
	}

	main {
		padding: 1rem 2rem;
		max-width: 1600px;
		margin: 0 auto;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		border-bottom: 1px solid #333;
		padding-bottom: 1rem;
	}

	h1 {
		margin: 0 0 0.25rem 0;
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: #fff;
	}

	header p {
		margin: 0;
		color: #888;
		font-size: 0.9rem;
	}

	.night-progress {
		font-style: italic;
		color: #aaa;
	}

	.turn-pill {
		background: #222;
		padding: 0.5rem 1rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: bold;
		color: #fff;
		border: 1px solid #444;
	}

	.game-layout {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 2rem;
		flex: 1;
		min-height: 0;
	}

	.board-section {
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.right-column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		background: #111;
		border: 1px solid #222;
		border-radius: 8px;
		padding: 1.5rem;
	}

	.rite-transcript {
		flex: 1;
		background: #0a0a0a;
		border: 1px inset #222;
		border-radius: 4px;
		padding: 1rem;
		color: #ccc;
		font-family: serif;
		font-size: 1.1rem;
		line-height: 1.5;
	}

	.reactions-panel {
		display: flex;
		gap: 1rem;
	}

	.reactions-panel button {
		flex: 1;
		padding: 0.5rem;
		background: #1a1a1a;
		border: 1px solid #333;
		color: #666;
		border-radius: 4px;
	}

	.ask-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ask-panel label {
		font-size: 0.85rem;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.ask-panel input {
		padding: 0.75rem;
		background: #1a1a1a;
		border: 1px solid #444;
		color: #fff;
		border-radius: 4px;
		font-size: 1rem;
	}

	.ask-panel input:focus {
		outline: none;
		border-color: #fff;
	}

	.cast-btn {
		width: 100%;
		padding: 1rem;
		background: #333;
		color: #fff;
		border: 1px solid #555;
		border-radius: 4px;
		font-size: 1rem;
		font-weight: bold;
		cursor: pointer;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.cast-btn:hover {
		background: #444;
	}
</style>
