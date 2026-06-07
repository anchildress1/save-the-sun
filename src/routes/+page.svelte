<script lang="ts">
	import { untrack } from 'svelte';
	import RuneGrid from '$lib/components/RuneGrid.svelte';
	import { runes } from '$lib/board';
	import type { GameAction, ActionResponse, GameState, Player } from '$lib/server/engine/actions';
	import type { PageProps } from './$types';

	// data (incl. boardSeed) comes from +page.server.ts. No default — a missing load
	// should fail loudly, not silently fall back to a frozen board.
	let { data }: PageProps = $props();

	// Every in-world line the Rite swaps in at runtime, in one place (ux-copy.md). Static chrome
	// (title, button labels) stays inline in the template; these are the lines the Oracle panel,
	// the turn pill, and the cast prompt show as play resolves.
	const RITE = {
		ready: 'Twenty-four runes stand. None ruled out. Ask the Oracle.',
		emptyAsk: 'Speak your question, witch.',
		wolfMoving: 'The wolf is moving. Hold.',
		oracleSilent: 'The Oracle falls silent. Draw breath and try again.',
		castFalters: 'The rite falters. The rune slips away.',
		wrongCast: 'The rune is not the one. The night holds.',
		runeTrue: 'The rune is true.',
		yourMove: 'Your move.',
		skollMoves: 'Sköll moves.',
		// Resolution lines (ux-copy.md §4) — voiced in the header when a round ends. A human win
		// raises the sun under sunCrests; a Sköll win keeps the moon under the defeat line.
		sunCrests: 'Sól crests the rim of the world.',
		skollTakesSun: 'Sköll takes the sun. The longest day never breaks. The year falls to dark.',
		skollTakes: 'Sköll takes the sun.',
		// Night-progress chrome (ux-copy.md §6), keyed to elapsed turns — cosmetic, no timer.
		nightHolds: 'The night lies deep and unbroken.',
		nightThins: 'Gray bleeds into the dark.',
		nightDawn: 'Dawn gathers at the edge of the world.',
		chooseTarget: 'Choose a rune from the board.',
		// Best-on-desktop notice (R10) — shown below the 1280px minimum; the rite does not reflow.
		desktopOnly:
			'The rite needs a wider sky. Save the Sun is cast on a desktop — return on a larger screen to take up the runes.',
		castPrompt: (name: string) => `Cast ${name}?`
	};

	let castMode = $state(false);
	let selectedTargetId: number | null = $state(null);
	let askValue = $state('');
	let pending = $state(false);

	// Turn state mirrors the engine, hydrated from the load on mount and fed by each action
	// response after. Hydrating (not guessing 'Human'/'active') is what keeps a resumed round —
	// including one already won — truthful on load. The server's pre-Sköll shim hands play back
	// to the human in v1, so activePlayer reads 'Human' in real play; the 'Sköll' branch goes
	// live when S6 lands.
	let activePlayer = $state<Player>(untrack(() => data.state.activePlayer));
	let roundStatus = $state<'active' | 'won'>(untrack(() => data.state.status));
	let turns = $state<number>(untrack(() => data.state.turns));
	let winner = $state<Player | null>(untrack(() => data.state.winner));
	let roundOver = $derived(roundStatus === 'won');
	// A resolved round is a win for whoever cast true. The header swaps the moon for a risen sun
	// on a human win and voices the resolution line (ux-copy.md §4); a Sköll win (mocked in v1,
	// live in S6) keeps the moon under the defeat line.
	let humanWon = $derived(roundOver && winner === 'Human');
	let skollWon = $derived(roundOver && winner === 'Sköll');
	// Header carries the short tag; the Oracle panel carries the full resolution sentence.
	let outcomeLine = $derived(humanWon ? RITE.sunCrests : RITE.skollTakes);
	// Night-progress phase by elapsed turns (cosmetic): holds 0–2, thins 3–5, dawn 6+.
	let nightProgress = $derived(
		turns <= 2 ? RITE.nightHolds : turns <= 5 ? RITE.nightThins : RITE.nightDawn
	);
	// Ask and Cast are turn-gated; cross-off is a private aid and is never gated (RuneGrid owns
	// it and stays enabled through Sköll's turn — game-spec "private aid").
	let canAct = $derived(activePlayer === 'Human' && !roundOver);
	// Won rounds read as resolved, not as a phantom turn. A human win lights the victory line; a
	// Sköll win reads the defeat (the Oracle panel carries the fuller resolution line).
	let turnPill = $derived(
		humanWon
			? RITE.runeTrue
			: skollWon
				? RITE.skollTakes
				: activePlayer === 'Human'
					? RITE.yourMove
					: RITE.skollMoves
	);

	function applyState(state: GameState) {
		activePlayer = state.activePlayer;
		roundStatus = state.status;
		turns = state.turns;
		winner = state.winner;
	}

	// Tracks the loaded seed until a new game overrides it. A changed seed remounts RuneGrid
	// (via {#key}), discarding its crossings and highlight; the parent's cast arming is
	// cleared separately by cancelCast().
	let seedOverride: number | null = $state(null);
	let boardSeed = $derived(seedOverride ?? data.boardSeed);

	// The Oracle surface — one response at a time. Defaults read as ready, not blank (prd.md
	// S3); a resumed won round opens on its victory line so the panel and pill agree. Your Ask
	// shows the answer, which restates the trait. The interpretation echo is reserved for the
	// rival's Ask (you'd see his question, not his answer) — wired in S5/S6, so it is
	// deliberately not rendered for your own Ask today.
	let answer = $state(
		untrack(() =>
			data.state.status !== 'won'
				? RITE.ready
				: data.state.winner === 'Sköll'
					? RITE.skollTakesSun
					: RITE.runeTrue
		)
	);

	let selectedRune = $derived(
		selectedTargetId === null ? null : (runes.find((r) => r.id === selectedTargetId) ?? null)
	);

	// Return type is derived from the action's `type`, so a caller can't request a
	// mismatched result shape.
	async function dispatch<T extends GameAction['type']>(
		action: Extract<GameAction, { type: T }>
	): Promise<ActionResponse<T>> {
		const res = await fetch('/api/action', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(action)
		});
		if (!res.ok) throw new Error(`Action rejected (${res.status})`);
		return res.json() as Promise<ActionResponse<T>>;
	}

	async function submitAsk() {
		const question = askValue.trim();
		if (question === '') {
			// Refusal does not consume a turn (game-spec). Client-side gate, no dispatch.
			answer = RITE.emptyAsk;
			return;
		}
		pending = true;
		try {
			const { oracle, state } = await dispatch({ type: 'Ask', player: 'Human', question });
			applyState(state);
			if (oracle.ok) {
				answer = oracle.answer;
				askValue = '';
			} else if (oracle.reason === 'refusal') {
				answer = oracle.line;
			} else {
				// not-your-turn means the engine has handed the turn to Sköll.
				answer = oracle.engineReason === 'not-your-turn' ? RITE.wolfMoving : RITE.oracleSilent;
			}
		} catch (err) {
			// A real 500 here means something the server-side degradation did NOT catch — keep
			// a trace so it's distinguishable from an expected in-world refusal.
			console.error('[ui] Ask dispatch failed:', err);
			answer = RITE.oracleSilent;
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
		let res: Response | undefined;
		try {
			res = await fetch('/api/new-game', { method: 'POST' });
			if (!res.ok) throw new Error(`New game rejected (${res.status})`);
			const { boardSeed: seed, state } = (await res.json()) as {
				boardSeed: number;
				state: GameState;
			};
			// A 200 with no usable seed would leave the board un-remounted while the server
			// reset — treat it as a hard failure, not a silent no-op.
			if (!Number.isFinite(seed)) throw new Error('New game response missing boardSeed');
			seedOverride = seed; // remounts RuneGrid → crossings + highlight clear
			answer = RITE.ready;
			askValue = '';
			applyState(state); // reset from engine truth, same as every other action
			cancelCast();
		} catch (err) {
			console.error(`[ui] New game failed (status ${res?.status ?? 'network'}):`, err);
			answer = RITE.oracleSilent;
		} finally {
			pending = false;
		}
	}

	async function commitCast() {
		if (selectedRune === null) return;
		pending = true;
		try {
			const { cast, state } = await dispatch({
				type: 'Cast',
				player: 'Human',
				runeName: selectedRune.name
			});
			applyState(state);
			if (cast.ok) {
				answer = cast.won ? RITE.runeTrue : RITE.wrongCast;
			} else {
				console.warn('[ui] Cast rejected by engine:', cast.reason);
				answer = RITE.castFalters;
			}
		} catch (err) {
			console.error('[ui] Cast dispatch failed:', err);
			answer = RITE.castFalters;
		} finally {
			pending = false;
			cancelCast();
		}
	}
</script>

<div class="desktop-notice" data-testid="desktop-notice">
	<p class="notice-title">Save the Sun</p>
	<p class="notice-line">{RITE.desktopOnly}</p>
</div>

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
				<p class="tagline">A race to beat Sköll and save the light.</p>
			</div>
		</div>

		<div class="night-block">
			{#if humanWon}
				<svg class="sun-risen" viewBox="0 0 64 64" aria-hidden="true">
					<defs>
						<radialGradient id="sunFace" cx="50%" cy="45%" r="60%">
							<stop offset="0%" stop-color="#fff3cf" />
							<stop offset="60%" stop-color="#f3c45a" />
							<stop offset="100%" stop-color="#d9a94a" />
						</radialGradient>
					</defs>
					<g stroke="#f3c45a" stroke-width="2.2" stroke-linecap="round">
						{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
							<line
								x1={32 + 16 * Math.cos((i * Math.PI) / 6)}
								y1={32 + 16 * Math.sin((i * Math.PI) / 6)}
								x2={32 + 22 * Math.cos((i * Math.PI) / 6)}
								y2={32 + 22 * Math.sin((i * Math.PI) / 6)}
							/>
						{/each}
					</g>
					<circle cx="32" cy="32" r="14" fill="url(#sunFace)" />
				</svg>
			{:else}
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
			{/if}
			<p
				class="night-progress"
				class:won={humanWon}
				class:lost={skollWon}
				data-testid={roundOver ? 'outcome-line' : 'night-progress'}
			>
				{roundOver ? outcomeLine : nightProgress}
			</p>
		</div>

		<div class="header-controls">
			<button class="ghost new-game" type="button" onclick={newGame} disabled={pending}>
				Begin another night
			</button>
			<div class="turn-pill" class:won={humanWon} class:lost={skollWon} data-testid="turn-pill">
				{turnPill}
			</div>
		</div>
	</header>

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
				<!-- The howto (which axes to ask about) lives in the onboarding popovers, not on the
				     board. Label kept for the field's accessible name only. -->
				<label class="sr-only" for="oracle-ask">Ask the Oracle</label>
				<input
					id="oracle-ask"
					type="text"
					placeholder="Type your question…"
					bind:value={askValue}
					disabled={castMode || pending || !canAct}
				/>
				<button class="primary" type="submit" disabled={castMode || pending || !canAct}>
					Ask the Oracle
				</button>
			</form>

			<div class="cast">
				<span class="cast-label">Cast a Rune</span>
				{#if castMode}
					<p class="cast-hint" data-testid="cast-hint">
						{selectedRune ? RITE.castPrompt(selectedRune.name) : RITE.chooseTarget}
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
					<button
						class="primary cast-arm"
						type="button"
						onclick={armCast}
						disabled={pending || !canAct}
					>
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

	.night-block {
		justify-self: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
	}

	.moon {
		width: 58px;
		height: 58px;
		filter: drop-shadow(0 0 16px rgba(220, 226, 240, 0.4));
	}

	/* The risen sun replaces the moon on a human win — the saved sun, warm and radiant. */
	.sun-risen {
		width: 58px;
		height: 58px;
		filter: drop-shadow(0 0 20px rgba(243, 196, 90, 0.6));
	}

	.night-progress {
		margin: 0;
		font-family: var(--font-display);
		font-style: italic;
		font-size: 0.78rem;
		letter-spacing: 0.06em;
		color: var(--ink-muted);
		white-space: nowrap;
	}

	/* Same slot, resolution register: gold for the win, the muted default holds for defeat. */
	.night-progress.won {
		color: var(--gold-bright);
		text-shadow: 0 0 12px rgba(217, 169, 74, 0.4);
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

	/* Resolved round: the pill stops reading as a turn and lights up as the victory state. */
	.turn-pill.won {
		color: var(--bg-deep);
		background: linear-gradient(180deg, var(--gold-bright), var(--gold));
		border-color: var(--gold-bright);
		box-shadow: 0 0 18px rgba(217, 169, 74, 0.4);
	}

	/* Defeat: the pill goes cold — no gold, no glow. */
	.turn-pill.lost {
		color: var(--ink-muted);
		background: rgba(120, 130, 150, 0.08);
		border-color: var(--ink-faint);
		box-shadow: none;
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

	/* Best-on-desktop notice (R10). Below the 1280px minimum the rite does not reflow — it steps
	   aside for this notice. This is the one deliberate width breakpoint; the desktop layout itself
	   stays intrinsic (no media queries above the floor). */
	.desktop-notice {
		display: none;
	}

	@media (max-width: 1279.98px) {
		main {
			display: none;
		}

		.desktop-notice {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 1rem;
			min-height: 100vh;
			padding: 2rem;
			text-align: center;
		}

		.notice-title {
			margin: 0;
			font-family: var(--font-display);
			font-size: 2rem;
			letter-spacing: 0.06em;
			color: var(--gold-bright);
			text-shadow: 0 0 18px rgba(217, 169, 74, 0.3);
		}

		.notice-line {
			margin: 0;
			max-width: 40ch;
			font-family: var(--font-display);
			font-style: italic;
			font-size: 1rem;
			line-height: 1.5;
			color: var(--ink-muted);
		}
	}
</style>
