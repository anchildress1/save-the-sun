<script lang="ts">
	import { runes } from '$lib/board';
</script>

<main>
	<h1>Save the Sun</h1>
	<p>A rite for the longest day. (Hello World)</p>

	<section class="grid">
		{#each runes as rune (rune.id)}
			<div class="rune-card">
				<strong>{rune.glyph}</strong>
				<span class="rune-name">{rune.name}</span>
				<span class="rune-meaning">{rune.meaning}</span>
				<div class="rune-traits">
					<span>Power: {rune.power}</span>
					<span>Element: {rune.element}</span>
					<span>Fill: {rune.fill}</span>
					<span>Color: {rune.color}</span>
				</div>
			</div>
		{/each}
	</section>
</main>

<style>
	main {
		font-family: sans-serif;
		padding: 2rem;
		max-width: 800px;
		margin: 0 auto;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 1rem;
		margin-top: 2rem;
	}
	.rune-card {
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 1rem;
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.rune-card strong {
		font-size: 2rem;
	}
	.rune-name {
		font-weight: bold;
	}
	.rune-meaning {
		font-size: 0.8rem;
		color: #555;
	}
	.rune-traits {
		display: flex;
		flex-direction: column;
		font-size: 0.75rem;
		color: #333;
		background: #f9f9f9;
		padding: 0.5rem;
		border-radius: 4px;
	}
</style>
