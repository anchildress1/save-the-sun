<script lang="ts">
	import { untrack, tick, onMount } from 'svelte';
	import RuneGrid from '$lib/components/RuneGrid.svelte';
	import ReactionPrompt from '$lib/components/ReactionPrompt.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import EndScreen from '$lib/components/EndScreen.svelte';
	import { runes } from '$lib/board';
	import { readViewState, writeViewState } from '$lib/viewState';
	import appIcon from '$lib/assets/ui/app-icon.png';
	import moonSplash from '$lib/assets/banners/moon-splash-header.jpg';
	import skollBanner from '$lib/assets/banners/skoll-banner.jpg';
	import type {
		GameAction,
		ActionResponse,
		GameState,
		Player,
		SkollTurn,
		AdvanceResponse
	} from '$lib/server/engine/actions';
	import type { ReactionChoice } from '$lib/server/engine/reactions';
	import type { PageProps } from './$types';

	// data (incl. boardSeed) comes from +page.server.ts. No default — a missing load
	// should fail loudly, not silently fall back to a frozen board.
	let { data }: PageProps = $props();

	// Every in-world line the Rite swaps in at runtime, in one place (canonical copy: ux-copy.md).
	const RITE = {
		emptyAsk: 'Speak your question, witch.',
		wolfMoving: 'The wolf is moving. Hold.',
		oracleSilent: 'The Oracle falls silent. Draw breath and try again.',
		castFalters: 'The rite falters. The rune slips away.',
		wrongCast: 'The rune is not the one. The night holds.',
		runeTrue: 'The rune is true.',
		yourMove: 'Your move.',
		skollMoves: 'Sköll moves.',
		wolfStalled: 'The wolf stalls in the dark. Rouse him to move.',
		hexHim: "You close the Oracle's lips. His question dies unanswered — his turn with it.",
		passHim: 'You hold your hand. Let him have his answer.',
		// Sköll's skill plays, voiced in the Oracle's text (rite voice, third person — never his gloat).
		// Hex replaces the answer (the question died); the Scry note trails the answer he overheard.
		skollHexes: "Sköll closes the Oracle's lips. Your question dies unanswered.",
		skollScried: 'Sköll listened at the threshold — the answer is his too.',
		sunCrests: 'Sól crests the rim of the world.',
		skollTakesSun: 'Sköll takes the sun. The longest day never breaks. The year falls to dark.',
		skollTakes: 'Sköll takes the sun.',
		nightHolds: 'The night lies deep and unbroken.',
		nightThins: 'Gray bleeds into the dark.',
		nightDawn: 'Dawn gathers at the edge of the world.',
		chooseTarget: 'Choose a rune from the board.',
		desktopOnly:
			'The rite needs a wider sky. Save the Sun is cast on a desktop — return on a larger screen to take up the runes.',
		castPrompt: (name: string) => `Cast ${name}?`
	};

	let castMode = $state(false);
	let selectedTargetId: number | null = $state(null);
	let askValue = $state('');
	let pending = $state(false);
	let aiNoteButton: HTMLButtonElement | null = $state(null);
	let aiNotePopover: HTMLElement | null = $state(null);

	// The title greets every load — the returning player is nagged by design. The flag is only a
	// suppression hook for automated runs (tests/e2e seed it); production never persists it, so onMount
	// shows the title each time.
	const ONBOARDED_KEY = 'save-the-sun:onboarded';
	let showOnboarding = $state(false);
	let onboardingStart = $state<'title' | 'tour'>('title');

	// A round can resume on Sköll's parked Ask, so the prompt + the human's still-held charges hydrate
	// from the load (the window lives server-side). The engine stays authoritative, so they can't over-grant.
	let skollEcho = $state(untrack(() => data.pendingReaction?.echo ?? ''));
	let skollAsking = $state(untrack(() => data.pendingReaction != null));
	let heldScry = $state(untrack(() => data.pendingReaction?.held.Scry ?? true));
	let heldHex = $state(untrack(() => data.pendingReaction?.held.Hex ?? true));
	// His turn stalled (an Advance request failed); it's still his turn server-side, so the controls
	// stay locked — the retry lets the human rouse him rather than being soft-locked.
	let skollStalled = $state(false);

	// Turn state mirrors the engine, hydrated from the load (not guessed) so a resumed round renders
	// true on load, then fed by each action.
	let activePlayer = $state<Player>(untrack(() => data.state.activePlayer));
	let roundStatus = $state<'active' | 'won'>(untrack(() => data.state.status));
	let turns = $state<number>(untrack(() => data.state.turns));
	let winner = $state<Player | null>(untrack(() => data.state.winner));
	let roundOver = $derived(roundStatus === 'won');
	// A human win adds a risen sun marker; a Sköll win leaves only the moonlit night and defeat line.
	let humanWon = $derived(roundOver && winner === 'Human');
	let skollWon = $derived(roundOver && winner === 'Sköll');
	let outcomeLine = $derived(humanWon ? RITE.sunCrests : RITE.skollTakes);
	// The end-screen rite takes over the moment the round resolves (S9). It owns the replay surface, so
	// the header's own controls fold away while it is up — one "Begin another night" on screen, not two.
	let showEndScreen = $derived(roundOver);
	let endOutcome = $derived<'win' | 'lose'>(humanWon ? 'win' : 'lose');
	let nightProgress = $derived(
		turns <= 2 ? RITE.nightHolds : turns <= 5 ? RITE.nightThins : RITE.nightDawn
	);
	// Cross-off is a private aid, never turn-gated — RuneGrid owns it and stays enabled through Sköll's turn.
	let canAct = $derived(activePlayer === 'Human' && !roundOver);
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

	// His box shows ONLY his templated question when he Asks, blank otherwise. The cast outcome derives
	// from engine truth (winner), so there's one source of "Sköll won," not two that can drift.
	function applySkoll(skoll: SkollTurn | undefined) {
		if (skoll === undefined) return;
		if (skoll.asks) {
			skollEcho = skoll.asks.echo;
			skollAsking = true;
		} else {
			skollEcho = '';
			skollAsking = false;
		}
	}

	// A changed seed remounts RuneGrid (via {#key}), discarding its crossings; cast arming is cleared
	// separately by cancelCast().
	let seedOverride: number | null = $state(null);
	let boardSeed = $derived(seedOverride ?? data.boardSeed);

	// View-state resume (S8.5): the engine resumes server-side, but the client's presentation — the
	// crossings and the voiced Oracle line — is otherwise thrown away on reload. Persist it keyed by a
	// stable per-round token (boardSeed reshuffles, so it can't be the key) and restore it on mount.
	let roundIdOverride: string | null = $state(null);
	let roundId = $derived(roundIdOverride ?? data.roundId);
	let crossings = $state<number[]>([]);
	let restoreCrossed = $state<number[]>([]);
	// Gate persistence until the post-mount restore has run, so the empty pre-restore state can't
	// overwrite a saved round before it is read back.
	let restored = $state(false);

	// The Oracle surface — one response at a time. A resumed won round opens on its victory line so the
	// panel and pill agree.
	let answer = $state(
		untrack(() =>
			data.state.status !== 'won'
				? '' // blank until the Oracle has a response to voice
				: data.state.winner === 'Sköll'
					? RITE.skollTakesSun
					: RITE.runeTrue
		)
	);

	$effect(() => {
		// Track the view; write only once restoration is done. `crossings` reassigns on every edit and
		// `answer` on every voiced line, so this captures both without an explicit call at each site.
		// Skip while Sköll is stalled: that's a transient error line whose companion `skollStalled`
		// (and its retry button) isn't persisted, and onMount re-drives his move anyway — so keep the
		// last good line in storage instead of resuming a dead-end error the engine has moved past.
		const snapshot = { crossings: [...crossings], answer };
		if (restored && !skollStalled) writeViewState(roundId, snapshot);
	});

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

	// Sköll's move is its own request, fired after any action that hands him the turn — so the
	// human's answer paints first (the `tick`), then his move loads under a live "Sköll moves."
	// pill. Self-contained error handling: a failed Advance must never clobber the answer the human
	// just earned, so it logs and leaves the turn with Sköll rather than throwing to the caller.
	async function advanceSkoll() {
		// Skip when it isn't his turn, or when his Ask is already parked awaiting the human's
		// reaction — advancing then is a server no-op, and the prompt is already up.
		if (roundStatus !== 'active' || activePlayer !== 'Sköll' || skollAsking) return;
		await tick();
		try {
			const res = await fetch('/api/action', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: 'Advance' })
			});
			if (!res.ok) throw new Error(`Advance rejected (${res.status})`);
			const { skoll, state } = (await res.json()) as AdvanceResponse;
			applyState(state);
			applySkoll(skoll);
			// Defeat line is sourced from engine truth (winner), not the cast DTO — one source, no drift.
			if (winner === 'Sköll') answer = RITE.skollTakesSun;
			skollStalled = false;
		} catch (err) {
			// A failed Advance leaves the turn with Sköll, so the controls stay locked. Surface an
			// in-world line AND a retry, or the human is soft-locked with only a console trace.
			console.error('[ui] Sköll advance failed:', err);
			answer = RITE.wolfStalled;
			skollStalled = true;
		}
	}

	// A load can land on Sköll's turn — drive it so the game never opens stuck on "Sköll moves" (his
	// own guard no-ops otherwise). Wrapped so the async return isn't mistaken for an onMount cleanup.
	onMount(() => {
		advanceSkoll();
		// Restore the resumed round's view over the server-hydrated engine state — crossings onto the
		// board, the last voiced line into the panel. Layered on top: the engine stays the source of
		// truth (turn pill, status, pending reaction), this only restores presentation. A blank stored
		// line never overwrites a server-derived one (e.g. a resumed won round's victory line).
		const saved = readViewState(roundId);
		if (saved) {
			restoreCrossed = saved.crossings;
			crossings = saved.crossings;
			if (saved.answer) answer = saved.answer;
		}
		restored = true;
		// Storage can throw (private mode) — first-run is the safe default, so show it then.
		try {
			showOnboarding = localStorage.getItem(ONBOARDED_KEY) === null;
		} catch {
			showOnboarding = true;
		}

		function onReposition() {
			if (aiNotePopover?.matches(':popover-open')) positionAiNotePopover();
		}
		window.addEventListener('resize', onReposition);
		window.addEventListener('scroll', onReposition, true);
		return () => {
			window.removeEventListener('resize', onReposition);
			window.removeEventListener('scroll', onReposition, true);
			clearTimeout(aiNoteHideTimer); // don't let a scheduled hide fire after teardown
		};
	});

	let aiNoteHideTimer: ReturnType<typeof setTimeout> | undefined;

	function showAiNote() {
		clearTimeout(aiNoteHideTimer);
		if (aiNotePopover && !aiNotePopover.matches(':popover-open')) {
			positionAiNotePopover();
			aiNotePopover.showPopover();
		}
	}

	function hideAiNote() {
		clearTimeout(aiNoteHideTimer);
		if (aiNotePopover?.matches(':popover-open')) aiNotePopover.hidePopover();
	}

	// Debounced so crossing the gap from the button onto the displaced popover doesn't close it.
	function scheduleHideAiNote() {
		clearTimeout(aiNoteHideTimer);
		aiNoteHideTimer = setTimeout(hideAiNote, 120);
	}

	function positionAiNotePopover() {
		if (!aiNoteButton || !aiNotePopover) return;
		const margin = 16;
		const gap = 8;
		const button = aiNoteButton.getBoundingClientRect();
		const width = Math.min(320, window.innerWidth - margin * 2);
		const left = Math.max(
			margin,
			Math.min(button.left + button.width / 2 - width / 2, window.innerWidth - width - margin)
		);
		const top = Math.min(button.bottom + gap, window.innerHeight - margin);
		aiNotePopover.style.setProperty('--ai-note-left', `${left}px`);
		aiNotePopover.style.setProperty('--ai-note-top', `${top}px`);
		aiNotePopover.style.setProperty('--ai-note-width', `${width}px`);
	}

	function finishOnboarding() {
		// Not persisted — the title nags every load by design (the flag is only a test suppression hook).
		showOnboarding = false;
	}

	function showInstructions() {
		onboardingStart = 'tour';
		showOnboarding = true;
	}

	// The wordmark is the way back to the intro splash. Non-destructive: it only raises the title over
	// the live round (the engine state is untouched), so "Light the fire." drops the player back into the
	// same round they left.
	function returnToTitle() {
		onboardingStart = 'title';
		showOnboarding = true;
	}

	async function submitAsk() {
		const question = askValue.trim();
		if (question === '') {
			// An empty Ask never consumes a turn — gated client-side, no dispatch.
			answer = RITE.emptyAsk;
			return;
		}
		pending = true;
		try {
			const { oracle, state, skollVsYou } = await dispatch({
				type: 'Ask',
				player: 'Human',
				question
			});
			applyState(state);
			if (skollVsYou?.reaction === 'Hex') {
				// The Oracle text names the Hex — the question died, so it replaces the answer.
				answer = RITE.skollHexes;
				askValue = '';
			} else if (skollVsYou?.reaction === 'Scry' && oracle?.ok) {
				// The Oracle still speaks your answer (he overheard it), with his Scry noted after it.
				answer = `${oracle.answer} ${RITE.skollScried}`;
				askValue = '';
			} else if (oracle?.ok) {
				answer = oracle.answer;
				askValue = '';
			} else if (oracle?.reason === 'refusal') {
				answer = oracle.line;
			} else if (oracle) {
				// not-your-turn means the engine has handed the turn to Sköll.
				answer = oracle.engineReason === 'not-your-turn' ? RITE.wolfMoving : RITE.oracleSilent;
			} else {
				answer = RITE.oracleSilent; // no oracle and not a Hex — unexpected; fail to a safe line
			}
			await advanceSkoll();
		} catch (err) {
			// A real 500 here means something the server-side degradation did NOT catch — keep
			// a trace so it's distinguishable from an expected in-world refusal.
			console.error('[ui] Ask dispatch failed:', err);
			answer = RITE.oracleSilent;
		} finally {
			pending = false;
		}
	}

	async function submitReact(choice: ReactionChoice) {
		pending = true;
		try {
			const { state, skollReaction } = await dispatch({
				type: 'React',
				player: 'Human',
				reaction: choice
			});
			applyState(state);
			skollAsking = false;
			skollEcho = '';
			// Key on what the engine actually DID (skollReaction), not what was requested — a Scry/Hex
			// can fail (e.g. no charge after a desync), which the server resolves as a Pass. Spend the
			// charge only when the reaction truly landed, so the UI never diverges from engine truth.
			if (skollReaction?.hexed) {
				answer = RITE.hexHim;
				heldHex = false;
			} else if (skollReaction?.scried) {
				answer = skollReaction.scried.answer;
				heldScry = false;
			} else {
				answer = RITE.passHim; // a Pass, or a reaction that didn't land
			}
		} catch (err) {
			console.error('[ui] React dispatch failed:', err);
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

	// RuneGrid owns the crossings; mirror them here so the persistence effect captures each edit.
	function handleCrossChange(ids: number[]) {
		crossings = ids;
	}

	async function newGame() {
		pending = true;
		let res: Response | undefined;
		try {
			res = await fetch('/api/new-game', { method: 'POST' });
			if (!res.ok) throw new Error(`New game rejected (${res.status})`);
			const {
				boardSeed: seed,
				roundId: nextRoundId,
				state
			} = (await res.json()) as {
				boardSeed: number;
				roundId: string;
				state: GameState;
			};
			// A 200 with no usable seed/token would leave the view keyed to the OLD round while the
			// server reset — treat it as a hard failure, not a silent no-op that mis-keys persistence.
			if (!Number.isFinite(seed)) throw new Error('New game response missing boardSeed');
			if (!nextRoundId) throw new Error('New game response missing roundId');
			seedOverride = seed; // remounts RuneGrid → its internal crossedOff clears
			// Re-key the persisted view to the new round and drop the old crossings: restoreCrossed = []
			// keeps the remounted grid from re-seeding, the `crossings` mirror resets so the persist
			// effect overwrites the single record with the fresh round's empty state — stale marks never
			// resume. (`crossings` here is the parent's mirror, distinct from the grid's own crossedOff.)
			roundIdOverride = nextRoundId;
			restoreCrossed = [];
			crossings = [];
			answer = '';
			askValue = '';
			skollEcho = '';
			skollAsking = false;
			heldScry = true;
			heldHex = true;
			applyState(state);
			cancelCast();
		} catch (err) {
			console.error(`[ui] New game failed (status ${res?.status ?? 'network'}):`, err);
			answer = RITE.oracleSilent;
		} finally {
			pending = false;
		}
	}

	// "Leave the fire." — step back from the closing rite to the threshold. A fresh round is prepared
	// behind the title (so the resolved one is discarded, not re-entered), then the title screen returns.
	async function leaveFire() {
		await newGame();
		onboardingStart = 'title';
		showOnboarding = true;
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
			await advanceSkoll();
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
		<img
			class="header-background-image"
			src={moonSplash}
			alt=""
			aria-hidden="true"
			decoding="async"
		/>
		<div class="title-block">
			<img class="app-sigil" src={appIcon} alt="" aria-hidden="true" decoding="async" />
			<div>
				<h1>
					<button
						class="title-home"
						type="button"
						onclick={returnToTitle}
						aria-label="Save the Sun — return to the title"
					>
						Save the Sun
					</button>
				</h1>
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

		{#if !showEndScreen}
			<div class="header-controls">
				<button
					class="ghost ritual-button ritual-button--ghost"
					type="button"
					data-testid="show-instructions"
					onclick={showInstructions}
				>
					How the rite works
				</button>
				<button
					class="ghost new-game ritual-button ritual-button--ghost"
					type="button"
					onclick={newGame}
					disabled={pending}
				>
					Begin another night
				</button>
			</div>
		{/if}
	</header>

	<div class="game-layout">
		<section class="board-section" data-coach="board">
			{#key boardSeed}
				<RuneGrid
					{castMode}
					{boardSeed}
					{restoreCrossed}
					onSelectTarget={handleTargetSelect}
					onCrossChange={handleCrossChange}
				/>
			{/key}
		</section>

		<aside class="oracle-panel">
			<img class="skoll-banner" src={skollBanner} alt="" aria-hidden="true" decoding="async" />

			<div class="turn-pill-row">
				<div class="turn-pill" class:won={humanWon} class:lost={skollWon} data-testid="turn-pill">
					{turnPill}
				</div>
				<span class="ai-note-wrap">
					<button
						class="ai-note-btn"
						type="button"
						aria-describedby="ai-note"
						aria-label="About the Gemini AI behind the Oracle and Sköll"
						bind:this={aiNoteButton}
						onmouseenter={showAiNote}
						onmouseleave={scheduleHideAiNote}
						onfocus={showAiNote}
						onblur={hideAiNote}
						onkeydown={(e) => {
							if (e.key === 'Escape') hideAiNote();
						}}
					>
						i
					</button>
					<span
						id="ai-note"
						role="tooltip"
						class="ai-note-pop"
						popover="manual"
						bind:this={aiNotePopover}
						onmouseenter={showAiNote}
						onmouseleave={scheduleHideAiNote}
					>
						The Oracle and Sköll are live Gemini AI driving answers and rival moves. They can
						misread, misplay, and make mistakes; the rules and rune data are exact.
					</span>
				</span>
			</div>

			<hr class="ornate-divider oracle-divider" aria-hidden="true" />

			<h2 class="oracle-title">The Oracle</h2>
			<div class="oracle-frame">
				<p class="frame-text answer" data-testid="answer">{answer}</p>
			</div>

			<h2 class="skoll-title" data-testid="skoll-title">Sköll</h2>
			<div class="skoll-frame" data-testid="skoll-frame">
				{#if skollEcho}
					<p class="skoll-echo" data-testid="skoll-echo">{skollEcho}</p>
				{/if}
			</div>

			{#if skollAsking}
				<ReactionPrompt held={{ Scry: heldScry, Hex: heldHex }} onReact={submitReact} />
			{:else}
				<div class="reactions" data-coach="reactions">
					<button class="ritual-button ritual-button--ghost reaction-btn" type="button" disabled>
						Scry
					</button>
					<button class="ritual-button ritual-button--ghost reaction-btn" type="button" disabled>
						Hex
					</button>
				</div>
			{/if}

			{#if skollStalled}
				<button
					class="rouse-wolf ritual-button ritual-button--ghost"
					type="button"
					data-testid="rouse-wolf"
					onclick={advanceSkoll}
					disabled={pending}
				>
					Rouse the wolf
				</button>
			{/if}

			<form
				class="ask"
				data-coach="ask"
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
					autocomplete="off"
					bind:value={askValue}
					disabled={castMode || pending || !canAct}
				/>
				<button
					class="ritual-button ritual-button--primary"
					type="submit"
					disabled={castMode || pending || !canAct}
				>
					Ask the Oracle
				</button>
			</form>

			<div class="cast" data-coach="cast">
				{#if castMode}
					<p class="cast-hint" data-testid="cast-hint">
						{selectedRune ? RITE.castPrompt(selectedRune.name) : RITE.chooseTarget}
					</p>
					<div class="cast-actions">
						<button
							class="ritual-button ritual-button--primary"
							type="button"
							onclick={commitCast}
							disabled={!selectedRune || pending}
						>
							Name it
						</button>
						<button class="ritual-button ritual-button--ghost" type="button" onclick={cancelCast}>
							Not yet
						</button>
					</div>
				{:else}
					<button
						class="cast-arm ritual-button ritual-button--primary"
						type="button"
						onclick={armCast}
						disabled={pending || !canAct}
					>
						Cast the rune
					</button>
				{/if}
			</div>
		</aside>
	</div>
</main>

{#if showEndScreen}
	<EndScreen outcome={endOutcome} onReplay={newGame} onLeave={leaveFire} />
{/if}

{#if showOnboarding}
	<Onboarding onDone={finishOnboarding} start={onboardingStart} />
{/if}

<style>
	main {
		position: relative;
		max-width: 1600px;
		margin: 0 auto;
		min-height: 100vh;
		padding: 1.25rem 2rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		isolation: isolate;
		--skoll-saturation: 1.04;
		--skoll-brightness: 1.06;
		--skoll-contrast: 1.04;
	}

	.rite-header {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		min-height: 7rem;
		padding: 0.8rem 1rem;
		overflow: hidden;
		border: 1px solid rgba(217, 169, 74, 0.18);
		border-radius: 10px;
		background: var(--bg-deep);
		isolation: isolate;
	}

	.rite-header::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background:
			linear-gradient(
				90deg,
				rgba(6, 9, 18, 0.82) 0%,
				rgba(6, 9, 18, 0.26) 42%,
				rgba(6, 9, 18, 0.78) 100%
			),
			linear-gradient(180deg, rgba(6, 9, 18, 0.16) 0%, rgba(6, 9, 18, 0.52) 100%);
		pointer-events: none;
	}

	.ornate-divider {
		position: relative;
		z-index: 2;
		width: 100%;
		height: 2.3rem;
		margin: -0.25rem 0 -0.35rem;
		border: 0;
		background: var(--ui-divider) center / 100% 100% no-repeat;
		pointer-events: none;
	}

	.oracle-divider {
		align-self: stretch;
		height: 1.25rem;
		margin: -0.15rem 0 0.05rem;
		opacity: 0.92;
	}

	.rite-header > :not(.header-background-image) {
		position: relative;
		z-index: 2;
	}

	.header-background-image {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: 50% 50%;
		filter: saturate(1.04) brightness(0.92) contrast(1.02);
		pointer-events: none;
	}

	.title-block {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.app-sigil {
		width: 72px;
		height: 72px;
		object-fit: contain;
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 10px rgba(217, 169, 74, 0.28));
	}

	h1 {
		margin: 0;
		font-family: var(--font-story-title);
		font-size: 2rem;
		font-weight: 400;
		letter-spacing: 0.04em;
		color: var(--gold-bright);
		text-shadow: 0 0 18px rgba(217, 169, 74, 0.3);
	}

	/* The wordmark doubles as the home affordance — back to the intro splash. Inherits the h1 look so it
	   reads as the title, not a button. */
	.title-home {
		font: inherit;
		letter-spacing: inherit;
		color: inherit;
		text-shadow: inherit;
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		transition: color 0.2s ease;
	}

	.title-home:hover {
		color: var(--gold);
	}

	.title-home:focus-visible {
		outline: none;
		border-radius: 4px;
		box-shadow: var(--focus-ring);
	}

	.tagline {
		margin: 0.1rem 0 0;
		font-family: var(--font-story-body);
		color: var(--ink-muted);
		font-style: italic;
		font-size: 0.95rem;
	}

	.night-block {
		justify-self: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
	}

	/* The risen sun replaces the moon on a human win — the saved sun, warm and radiant. */
	.sun-risen {
		width: 58px;
		height: 58px;
		filter: drop-shadow(0 0 20px rgba(243, 196, 90, 0.6));
	}

	.night-progress {
		margin: 0;
		font-family: var(--font-story-body);
		font-style: italic;
		font-size: 0.95rem;
		color: var(--ink-muted);
		white-space: nowrap;
	}

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

	.turn-pill-row {
		align-self: stretch;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		position: relative;
		z-index: 4;
	}
	.turn-pill {
		align-self: center;
		font-family: var(--font-display);
		letter-spacing: 0.08em;
		text-align: center;
		color: var(--gold-bright);
		background: rgba(217, 169, 74, 0.08);
		border: 1px solid var(--gold-dim);
		border-radius: 999px;
		padding: 0.45rem 1.1rem;
		font-size: 0.85rem;
	}

	.turn-pill.won {
		color: var(--bg-deep);
		background: linear-gradient(180deg, var(--gold-bright), var(--gold));
		border-color: var(--gold-bright);
		box-shadow: 0 0 18px rgba(217, 169, 74, 0.4);
	}

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

	.oracle-panel {
		--speaker-title-size: 1.05rem;
		--speaker-title-tracking: 0.32em;
		--frame-pad: 0.55rem 0.7rem;
		--frame-min-h: 2.6rem;
		--frame-radius: 6px;
		--reaction-min-h: 2.65rem;
		--reaction-font: 0.78rem;

		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.1rem 1.1rem 0;
		background:
			linear-gradient(
				180deg,
				rgba(6, 9, 18, 0.9) 0%,
				rgba(6, 9, 18, 0.64) 48%,
				rgba(6, 9, 18, 0.16) 100%
			),
			var(--bg-deep);
		border: 1px solid var(--gold-dim);
		border-radius: 10px;
		overflow: hidden;
		isolation: isolate;
	}

	.oracle-panel::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background:
			linear-gradient(
				180deg,
				rgba(6, 9, 18, 0.78) 0%,
				rgba(6, 9, 18, 0.5) 44%,
				rgba(6, 9, 18, 0.08) 76%,
				transparent 100%
			),
			radial-gradient(circle at 50% 0%, rgba(217, 169, 74, 0.1) 0%, transparent 36%);
		pointer-events: none;
	}

	.oracle-panel > :not(.skoll-banner) {
		position: relative;
		z-index: 2;
	}

	.oracle-panel > .turn-pill-row {
		z-index: 4;
	}

	.oracle-title {
		margin: 0.2rem 0 0.1rem;
		text-align: center;
		font-family: var(--font-display);
		font-size: var(--speaker-title-size);
		letter-spacing: var(--speaker-title-tracking);
		text-transform: uppercase;
		color: var(--gold-bright);
	}

	.oracle-frame {
		min-height: var(--frame-min-h);
		padding: var(--frame-pad);
		border: 1px solid var(--gold-faint);
		border-radius: var(--frame-radius);
		background: var(--surface-inset);
	}

	.frame-text {
		margin: 0;
		font-family: var(--font-story-body);
		font-size: 1rem;
		line-height: 1.5;
		color: var(--ink);
	}

	.frame-text.answer {
		color: var(--gold-bright);
	}

	.skoll-title {
		margin: 0.2rem 0 0.1rem;
		text-align: center;
		font-family: var(--font-display);
		font-size: var(--speaker-title-size);
		letter-spacing: var(--speaker-title-tracking);
		text-transform: uppercase;
		color: var(--steel);
	}

	.skoll-frame {
		min-height: var(--frame-min-h);
		padding: var(--frame-pad);
		border: 1px solid var(--steel-line);
		border-radius: var(--frame-radius);
		background:
			radial-gradient(circle at 50% 0%, var(--steel-glow) 0%, transparent 60%), var(--surface-inset);
	}

	.skoll-echo {
		margin: 0;
		font-family: var(--font-story-body);
		font-size: 1rem;
		line-height: 1.45;
		color: var(--ink);
	}

	.reactions {
		display: flex;
		gap: 0.6rem;
	}

	.reaction-btn {
		flex: 1;
		min-height: var(--reaction-min-h);
		font-size: var(--reaction-font);
	}

	.reaction-btn:disabled {
		color: var(--ink);
		border-color: var(--gold-dim);
		filter: none;
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
		background: var(--surface-inset);
		border: 1px solid var(--gold-dim);
		border-radius: 5px;
		color: var(--ink);
		font-size: 0.92rem;
	}

	.ask input:focus-visible {
		outline: none;
		border-color: var(--gold-bright);
		box-shadow: var(--focus-ring);
	}

	.ask input:-webkit-autofill,
	.ask input:-webkit-autofill:hover,
	.ask input:-webkit-autofill:active {
		-webkit-text-fill-color: var(--ink);
		-webkit-box-shadow: 0 0 0 1000px var(--surface-inset) inset;
		caret-color: var(--ink);
		transition: background-color 9999s ease-in-out 0s;
	}

	.ask input:-webkit-autofill:focus {
		-webkit-box-shadow:
			var(--focus-ring),
			0 0 0 1000px var(--surface-inset) inset;
	}

	.cast {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
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

	.cast-actions > button {
		flex: 1;
	}

	/* AI-fallibility note: a meta affordance (not the rite's voice), opened as a browser popover. */
	.ai-note-wrap {
		display: inline-flex;
	}
	.ai-note-btn {
		inline-size: 1.5rem;
		block-size: 1.5rem;
		display: inline-grid;
		place-items: center;
		padding: 0;
		border: 1px solid var(--gold-dim);
		border-radius: 999px;
		background: rgba(6, 9, 18, 0.45);
		color: var(--ink-muted);
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-weight: 700;
		line-height: 1;
		text-transform: none;
		letter-spacing: 0;
		cursor: help;
	}

	.ai-note-btn:hover,
	.ai-note-btn:focus-visible {
		color: var(--gold-bright);
		border-color: var(--gold-bright);
		background: rgba(217, 169, 74, 0.08);
	}

	.ai-note-btn:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.ai-note-pop {
		position: fixed;
		inset: unset;
		top: var(--ai-note-top, 0);
		left: var(--ai-note-left, 0);
		width: var(--ai-note-width, 20rem);
		box-sizing: border-box;
		margin: 0;
		padding: 0.7rem 0.9rem;
		border: 1px solid var(--gold-dim);
		border-radius: 0.5rem;
		background: var(--bg-panel);
		color: var(--ink);
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.35;
		text-align: start;
		text-transform: none;
		letter-spacing: 0;
		white-space: normal;
		opacity: 0;
		visibility: hidden;
		transform: translateY(-0.25rem);
		transition:
			opacity 0.12s ease,
			transform 0.12s ease;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
	}

	.ai-note-pop:popover-open {
		opacity: 1;
		visibility: visible;
		transform: translateY(0);
	}

	.skoll-banner {
		position: absolute;
		inset: auto 0 0;
		z-index: 0;
		display: block;
		width: 100%;
		height: min(92%, 54rem);
		object-fit: cover;
		object-position: 50% 0%;
		filter: saturate(var(--skoll-saturation)) brightness(var(--skoll-brightness))
			contrast(var(--skoll-contrast));
		mask-image: linear-gradient(180deg, transparent 0%, black 7%, black 100%);
		-webkit-mask-image: linear-gradient(180deg, transparent 0%, black 7%, black 100%);
		pointer-events: none;
	}

	/* The one deliberate width breakpoint: below the 1280px minimum the rite steps aside for this
	   notice rather than reflowing. The desktop layout above the floor stays intrinsic. */
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
			font-family: var(--font-story-title);
			font-size: 2.4rem;
			letter-spacing: 0.04em;
			color: var(--gold-bright);
			text-shadow: 0 0 18px rgba(217, 169, 74, 0.3);
		}

		.notice-line {
			margin: 0;
			max-width: 40ch;
			font-family: var(--font-story-body);
			font-style: italic;
			font-size: 1rem;
			line-height: 1.5;
			color: var(--ink-muted);
		}
	}
</style>
