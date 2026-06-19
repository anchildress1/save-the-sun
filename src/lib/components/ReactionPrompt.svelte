<script lang="ts">
	import type { Reaction } from '$lib/server/engine/engine';
	import type { ReactionChoice } from '$lib/server/engine/reactions';

	// The human-side interrupt prompt: shown when Sköll Asks, so the witch can overhear (Scry) or
	// silence (Hex) the question — or pass. Spent reactions stay visible but disabled.
	// busy seals every choice while the rite is mid-move — a clicked reaction must not race a
	// voiced ask's implicit auto-pass for the session lock.
	let {
		held,
		onReact,
		busy = false
	}: {
		held: Record<Reaction, boolean>;
		onReact: (choice: ReactionChoice) => void;
		busy?: boolean;
	} = $props();

	// One source for each choice's tooltip and its described-by. The active buttons carry a title for
	// mouse users; aria-describedby reads the same hint to keyboard/screen-reader users — exactly when
	// the window is open and the hint matters most, not only on hover.
	const HINTS = {
		Scry: 'When your rival asks, hear the answer too.',
		Hex: "When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted.",
		Pass: 'When your rival asks, let the question stand.'
	} as const;
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
			title={HINTS.Scry}
			aria-describedby="reaction-hint-scry"
			disabled={busy || !held.Scry}
			onclick={() => onReact('Scry')}
		>
			Scry
		</button>
		<button
			class="btn btn--primary reaction-choice"
			class:reaction-choice--spent={!held.Hex}
			type="button"
			title={HINTS.Hex}
			aria-describedby="reaction-hint-hex"
			disabled={busy || !held.Hex}
			onclick={() => onReact('Hex')}
		>
			Hex
		</button>
		<button
			class="btn btn--secondary"
			type="button"
			title={HINTS.Pass}
			aria-describedby="reaction-hint-pass"
			disabled={busy}
			onclick={() => onReact('Pass')}>Pass</button
		>
	</div>
	<span id="reaction-hint-scry" class="sr-only">{HINTS.Scry}</span>
	<span id="reaction-hint-hex" class="sr-only">{HINTS.Hex}</span>
	<span id="reaction-hint-pass" class="sr-only">{HINTS.Pass}</span>
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

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
