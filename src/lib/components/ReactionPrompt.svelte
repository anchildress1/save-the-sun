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
			<button type="button" onclick={() => onReact('Scry')}>Scry</button>
		{/if}
		{#if held.Hex}
			<button type="button" onclick={() => onReact('Hex')}>Hex</button>
		{/if}
		<button class="ghost" type="button" onclick={() => onReact('Pass')}>Let it pass</button>
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
		background: rgba(0, 0, 0, 0.25);
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

	.choices button {
		flex: 1;
		padding: 0.45rem;
		font-family: var(--font-display);
		font-size: 0.78rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--bg-deep);
		background: linear-gradient(180deg, var(--gold-bright), var(--gold));
		border: 1px solid var(--gold-bright);
		border-radius: 5px;
		cursor: pointer;
	}

	.choices button.ghost {
		color: var(--ink-muted);
		background: transparent;
		border-color: var(--gold-dim);
	}

	.choices button:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 2px;
	}
</style>
