<script lang="ts">
	import RuneGrid from '$lib/components/RuneGrid.svelte';
	import { runes } from '$lib/board';
	import type { GameAction, ActionResult } from '$lib/server/engine/actions';
	import type { PageProps } from './$types';

	// data (incl. boardSeed) comes from +page.server.ts. No default — a missing load
	// should fail loudly, not silently fall back to a frozen board.
	let { data }: PageProps = $props();

	let castMode = $state(false);
	let selectedTargetId: number | null = $state(null);
	let askValue = $state('');
	let pending = $state(false);

	const READY = 'Twenty-four runes stand. None ruled out. Ask the Oracle.';

	// Tracks the loaded seed until a new game overrides it. A changed seed remounts RuneGrid
	// (via {#key}), clearing crossings and the armed target with it.
	let seedOverride: number | null = $state(null);
	let boardSeed = $derived(seedOverride ?? data.boardSeed);

	// The Oracle surface — one response at a time. Defaults read as ready, not blank (prd.md
	// S3). Your Ask shows the answer, which restates the trait. The interpretation echo is
	// reserved for the rival's Ask (you'd see his question, not his answer) — wired in S5/S6,
	// so it is deliberately not rendered for your own Ask today.
	let answer = $state(READY);

	let selectedRune = $derived(
		selectedTargetId === null ? null : (runes.find((r) => r.id === selectedTargetId) ?? null)
	);

	// Return type is derived from the action's `type`, so a caller can't request a
	// mismatched result shape.
	async function dispatch<T extends ActionResult['type']>(
		action: Extract<GameAction, { type: T }>
	): Promise<Extract<ActionResult, { type: T }>> {
		const res = await fetch('/api/action', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(action)
		});
		if (!res.ok) throw new Error(`Action rejected (${res.status})`);
		return res.json() as Promise<Extract<ActionResult, { type: T }>>;
	}

	async function submitAsk() {
		const question = askValue.trim();
		if (question === '') {
			// Refusal does not consume a turn (game-spec). Client-side gate, no dispatch.
			answer = 'Speak your question, witch.';
			return;
		}
		pending = true;
		try {
			const { oracle } = await dispatch({ type: 'Ask', player: 'Human', question });
			if (oracle.ok) {
				answer = oracle.answer;
				askValue = '';
			} else if (oracle.reason === 'refusal') {
				answer = oracle.line;
			} else {
				// not-your-turn means the engine has handed the turn to Sköll.
				answer =
					oracle.engineReason === 'not-your-turn'
						? 'The wolf is moving. Hold.'
						: 'The Oracle falls silent. Draw breath and try again.';
			}
		} catch (err) {
			// A real 500 here means something the server-side degradation did NOT catch — keep
			// a trace so it's distinguishable from an expected in-world refusal.
			console.error('[ui] Ask dispatch failed:', err);
			answer = 'The Oracle falls silent. Draw breath and try again.';
		} finally {
			pending = false;
		}
	}

	function armCast() {
		castMode = true;
		selectedTargetId = null;
	}

	function cancelCast() {
		castMode = false;
		selectedTargetId = null;
	}

	function handleTargetSelect(id: number) {
		selectedTargetId = id;
	}

	async function newGame() {
		pending = true;
		try {
			const res = await fetch('/api/new-game', { method: 'POST' });
			if (!res.ok) throw new Error(`New game rejected (${res.status})`);
			const { boardSeed: seed } = (await res.json()) as { boardSeed: number };
			seedOverride = seed; // remounts RuneGrid → crossings + armed target clear
			answer = READY;
			askValue = '';
			cancelCast();
		} catch (err) {
			console.error('[ui] New game failed:', err);
			answer = 'The Oracle falls silent. Draw breath and try again.';
		} finally {
			pending = false;
		}
	}

	async function commitCast() {
		if (selectedRune === null) return;
		pending = true;
		try {
			const { cast } = await dispatch({
				type: 'Cast',
				player: 'Human',
				runeName: selectedRune.name
			});
			if (cast.ok) {
				answer = cast.won ? 'The rune is true.' : 'The rune is not the one. The night holds.';
			} else {
				console.warn('[ui] Cast rejected by engine:', cast.reason);
				answer = 'The rite falters. The rune slips away.';
			}
		} catch (err) {
			console.error('[ui] Cast dispatch failed:', err);
			answer = 'The rite falters. The rune slips away.';
		} finally {
			pending = false;
			cancelCast();
		}
	}
</script>

<main>
	<header class="rite-header">
		<div class="title-block">
			<svg class="sun-sigil" viewBox="0 0 48 48" aria-hidden="true">
				<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
					<circle cx="24" cy="24" r="8" />
					{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
						<line
							x1="24"
							y1="24"
							x2={24 + 20 * Math.cos((i * Math.PI) / 6)}
							y2={24 + 20 * Math.sin((i * Math.PI) / 6)}
							transform-origin="24 24"
							opacity="0.85"
						/>
					{/each}
				</g>
			</svg>
			<div>
				<h1>Save the Sun</h1>
				<p class="tagline">A rite for the longest day.</p>
			</div>
		</div>

		<svg class="moon" viewBox="0 0 64 64" aria-hidden="true">
			<defs>
				<radialGradient id="moonFace" cx="40%" cy="35%" r="75%">
					<stop offset="0%" stop-color="#f4eede" />
					<stop offset="70%" stop-color="#cdd2dd" />
					<stop offset="100%" stop-color="#8b93a6" />
				</radialGradient>
			</defs>
			<circle cx="32" cy="32" r="22" fill="url(#moonFace)" />
			<circle cx="26" cy="24" r="3.4" fill="#b9bdc8" opacity="0.6" />
			<circle cx="40" cy="34" r="2.4" fill="#b9bdc8" opacity="0.5" />
			<circle cx="30" cy="40" r="1.8" fill="#b9bdc8" opacity="0.5" />
		</svg>

		<div class="header-controls">
			<button class="ghost new-game" type="button" onclick={newGame} disabled={pending}>
				Begin another night
			</button>
			<div class="turn-pill">Your move.</div>
		</div>
	</header>

	<p class="explainer">Ask. Cross off what it can't be. Cast when you're ready.</p>

	<div class="game-layout">
		<section class="board-section">
			{#key boardSeed}
				<RuneGrid {castMode} {boardSeed} onSelectTarget={handleTargetSelect} />
			{/key}
		</section>

		<aside class="oracle-panel">
			<h2 class="oracle-title">The Oracle</h2>

			<div class="oracle-frame">
				<p class="frame-text answer" data-testid="answer">{answer}</p>
			</div>

			<div class="reactions">
				<button type="button" disabled title="When your rival asks, hear the answer too.">
					Scry
				</button>
				<button
					type="button"
					disabled
					title="When your rival asks, silence the Oracle — their question dies."
				>
					Hex
				</button>
			</div>

			<form
				class="ask"
				onsubmit={(e) => {
					e.preventDefault();
					submitAsk();
				}}
			>
				<label for="oracle-ask">Ask the Oracle — element, power, light, or hue</label>
				<input
					id="oracle-ask"
					type="text"
					placeholder="Type your question…"
					bind:value={askValue}
					disabled={castMode || pending}
				/>
				<button class="primary" type="submit" disabled={castMode || pending}>Ask the Oracle</button>
			</form>

			<div class="cast">
				<span class="cast-label">Cast a Rune</span>
				{#if castMode}
					<p class="cast-hint" data-testid="cast-hint">
						{selectedRune ? `Cast ${selectedRune.name}?` : 'Choose a rune from the board.'}
					</p>
					<div class="cast-actions">
						<button
							class="primary"
							type="button"
							onclick={commitCast}
							disabled={!selectedRune || pending}
						>
							Name it
						</button>
						<button class="ghost" type="button" onclick={cancelCast}>Not yet</button>
					</div>
				{:else}
					<button class="primary cast-arm" type="button" onclick={armCast} disabled={pending}>
						Cast the rune
					</button>
				{/if}
			</div>

			<svg class="wolf" viewBox="0 0 200 110" aria-hidden="true">
				<circle cx="150" cy="30" r="20" fill="#2a3247" opacity="0.7" />
				<!-- howling wolf on a ridge -->
				<path
					d="M8 108 L60 108 C66 96 70 92 76 90 C78 78 82 70 88 64 C86 58 88 50 94 44 C92 40 92 34 96 30 C98 36 100 40 104 42 C108 50 110 58 110 66 C116 72 120 82 121 92 C126 96 130 102 134 108 L196 108 L196 110 L8 110 Z"
					fill="#0a0e1c"
				/>
			</svg>
		</aside>
	</div>
</main>

<style>
	main {
		max-width: 1600px;
		margin: 0 auto;
		min-height: 100vh;
		padding: 1.25rem 2rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.rite-header {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		padding-bottom: 0.4rem;
	}

	.title-block {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.sun-sigil {
		width: 46px;
		height: 46px;
		color: var(--gold);
		filter: drop-shadow(0 0 8px rgba(217, 169, 74, 0.5));
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.8rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--gold-bright);
		text-shadow: 0 0 18px rgba(217, 169, 74, 0.3);
	}

	.tagline {
		margin: 0.1rem 0 0;
		color: var(--ink-muted);
		font-style: italic;
		font-size: 0.85rem;
	}

	.moon {
		width: 58px;
		height: 58px;
		justify-self: center;
		filter: drop-shadow(0 0 16px rgba(220, 226, 240, 0.4));
	}

	.header-controls {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.turn-pill {
		font-family: var(--font-display);
		letter-spacing: 0.08em;
		color: var(--gold-bright);
		background: rgba(217, 169, 74, 0.08);
		border: 1px solid var(--gold-dim);
		border-radius: 999px;
		padding: 0.45rem 1.1rem;
		font-size: 0.85rem;
	}

	.explainer {
		margin: 0;
		text-align: center;
		color: var(--ink-muted);
		font-style: italic;
		font-size: 0.85rem;
		letter-spacing: 0.02em;
		border-top: 1px solid var(--gold-faint);
		border-bottom: 1px solid var(--gold-faint);
		padding: 0.45rem 0;
	}

	.game-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 360px;
		gap: 1.5rem;
		flex: 1;
		min-height: 0;
		margin-top: 0.4rem;
	}

	.board-section {
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	/* Oracle panel */
	.oracle-panel {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.1rem 1.1rem 0;
		background:
			radial-gradient(circle at 50% 0%, rgba(217, 169, 74, 0.06) 0%, transparent 40%),
			linear-gradient(180deg, var(--bg-panel) 0%, var(--bg-deep) 100%);
		border: 1px solid var(--gold-dim);
		border-radius: 10px;
		overflow: hidden;
	}

	.oracle-title {
		margin: 0.2rem 0 0.1rem;
		text-align: center;
		font-family: var(--font-display);
		font-size: 1.05rem;
		letter-spacing: 0.32em;
		text-transform: uppercase;
		color: var(--gold-bright);
	}

	.oracle-frame {
		border: 1px solid var(--gold-faint);
		border-radius: 6px;
		padding: 0.55rem 0.7rem;
		background: rgba(0, 0, 0, 0.25);
	}

	.frame-text {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.92rem;
		line-height: 1.4;
		color: var(--ink);
	}

	.frame-text.answer {
		color: var(--gold-bright);
	}

	.reactions {
		display: flex;
		gap: 0.6rem;
	}

	.reactions button {
		flex: 1;
		padding: 0.4rem;
		font-size: 0.72rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-faint);
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--gold-faint);
		border-radius: 5px;
		cursor: not-allowed;
	}

	.ask {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.ask label {
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-muted);
	}

	.ask input {
		padding: 0.65rem 0.7rem;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid var(--gold-dim);
		border-radius: 5px;
		color: var(--ink);
		font-size: 0.92rem;
	}

	.ask input:focus-visible {
		outline: none;
		border-color: var(--gold-bright);
		box-shadow: 0 0 0 2px rgba(217, 169, 74, 0.2);
	}

	.cast {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.cast-label {
		font-size: 0.62rem;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-muted);
	}

	.cast-hint {
		margin: 0;
		font-family: var(--font-display);
		color: var(--gold-bright);
		font-size: 0.9rem;
	}

	.cast-actions {
		display: flex;
		gap: 0.6rem;
	}

	/* The cast row splits its width evenly; flex: 1 lives here, not on the .ghost variant. */
	.cast-actions .primary,
	.cast-actions .ghost {
		flex: 1;
	}

	button.primary {
		padding: 0.65rem 0.9rem;
		font-family: var(--font-display);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		font-size: 0.82rem;
		color: var(--bg-deep);
		background: linear-gradient(180deg, var(--gold-bright), var(--gold));
		border: 1px solid var(--gold-bright);
		border-radius: 5px;
		cursor: pointer;
		transition:
			filter 0.2s ease,
			transform 0.1s ease;
	}

	button.primary:hover:not(:disabled) {
		filter: brightness(1.08);
	}

	button.primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	button.ghost {
		padding: 0.65rem 0.9rem;
		font-family: var(--font-display);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		font-size: 0.82rem;
		color: var(--ink-muted);
		background: transparent;
		border: 1px solid var(--gold-dim);
		border-radius: 5px;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 2px;
	}

	.wolf {
		width: 100%;
		height: auto;
		margin-top: auto;
		display: block;
	}
</style>
