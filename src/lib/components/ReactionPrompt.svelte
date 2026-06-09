<script lang="ts">
	import type { Reaction } from '$lib/server/engine/engine';
	import type { ReactionChoice } from '$lib/server/engine/reactions';

	// The human-side interrupt prompt: shown when Sköll Asks, so the witch can overhear (Scry) or
	// silence (Hex) the question — or let it pass. Only held reactions are offered (a spent one vanishes).
	let {
		held,
		onReact
	}: {
		held: Record<Reaction, boolean>;
		onReact: (choice: ReactionChoice) => void;
	} = $props();
</script>

<div class="reaction-prompt" role="group" aria-label="Sköll asks. Answer it?">
	<p class="prompt" data-testid="reaction-prompt">Sköll asks. Answer it?</p>
	<div class="choices">
		{#if held.Scry}
			<button
				class="ritual-button ritual-button--primary"
				type="button"
				onclick={() => onReact('Scry')}
			>
				Scry
			</button>
		{/if}
		{#if held.Hex}
			<button
				class="ritual-button ritual-button--primary"
				type="button"
				onclick={() => onReact('Hex')}
			>
				Hex
			</button>
		{/if}
		<button
			class="ritual-button ritual-button--ghost"
			type="button"
			onclick={() => onReact('Pass')}
		>
			Let it pass
		</button>
	</div>
</div>

<style>
	.reaction-prompt {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--gold-dim);
		border-radius: 6px;
		background: var(--surface-inset);
	}

	.prompt {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.92rem;
		color: var(--gold-bright);
	}

	.choices {
		display: flex;
		gap: 0.6rem;
	}

	/* Sizing from host-panel tokens so the active prompt matches the inert held-charges row; the
	   fallbacks keep this renderable on its own. */
	.choices button {
		flex: 1;
		min-height: var(--reaction-min-h, 2.65rem);
		font-size: var(--reaction-font, 0.78rem);
	}
</style>
