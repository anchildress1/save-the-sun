<script lang="ts">
	import type { Reaction } from '$lib/server/engine/engine';
	import type { ReactionChoice } from '$lib/server/engine/reactions';

	// The human-side interrupt prompt: shown when Sköll Asks, so the witch can overhear (Scry) or
	// silence (Hex) the question — or pass. Spent reactions stay visible but disabled.
	let {
		held,
		onReact
	}: {
		held: Record<Reaction, boolean>;
		onReact: (choice: ReactionChoice) => void;
	} = $props();
</script>

<div
	class="reaction-prompt"
	role="group"
	aria-label="Sköll asks. Answer it?"
	data-testid="reaction-prompt"
>
	<div class="choices">
		<button
			class="btn btn--primary reaction-choice"
			class:reaction-choice--spent={!held.Scry}
			type="button"
			title="When your rival asks, hear the answer too."
			disabled={!held.Scry}
			onclick={() => onReact('Scry')}
		>
			Scry
		</button>
		<button
			class="btn btn--primary reaction-choice"
			class:reaction-choice--spent={!held.Hex}
			type="button"
			title="When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted."
			disabled={!held.Hex}
			onclick={() => onReact('Hex')}
		>
			Hex
		</button>
		<button class="btn btn--secondary" type="button" onclick={() => onReact('Pass')}> Pass </button>
	</div>
</div>

<style>
	.reaction-prompt {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--gold-dim);
		border-radius: 6px;
		background: var(--surface-inset);
	}

	.choices {
		display: flex;
		gap: 0.6rem;
	}

	.choices button {
		flex: 1;
		min-height: var(--reaction-min-h, 2.65rem);
		font-size: var(--reaction-font, 0.78rem);
	}

	.reaction-choice--spent {
		color: var(--ink-muted);
		border-color: var(--ink-faint);
		background: rgba(120, 130, 150, 0.06);
		box-shadow: none;
		opacity: 0.46;
		filter: grayscale(0.85) saturate(0.45);
		cursor: not-allowed;
	}
</style>
