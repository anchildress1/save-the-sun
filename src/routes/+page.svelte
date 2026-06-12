<script lang="ts">
	import { untrack, tick, onMount } from 'svelte';
	import RuneGrid from '$lib/components/RuneGrid.svelte';
	import ReactionPrompt from '$lib/components/ReactionPrompt.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import EndScreen from '$lib/components/EndScreen.svelte';
	import EclipseMedallion from '$lib/components/EclipseMedallion.svelte';
	import type { MedallionState } from '$lib/components/medallionState';
	import { voiceSession, type VoiceEvent, type VoiceToolCall } from '$lib/voice/voiceSession';
	import { oracleBoardEcho } from '$lib/voice/oraclePersona';
	import { runes } from '$lib/board';
	import { readViewState, writeViewState } from '$lib/viewState';
	import appIcon from '$lib/assets-webp/ui/app-icon.webp?url&no-inline';
	// ?inline (against the repo's no-inline convention) on purpose: this 10KB sky is the LCP
	// element, and shipping it inside the HTML removes the fetch entirely — it paints at first render.
	import moonSplash from '$lib/assets-webp/banners/moon-splash-header.webp?inline';
	import skollBanner from '$lib/assets-webp/banners/skoll-banner.webp?url&no-inline';
	import introSplash from '$lib/assets-webp/banners/intro-splash.webp?url&no-inline';
	import uiDivider from '$lib/assets-webp/ui/divider.webp?url&no-inline';
	import dawnSplash from '$lib/assets-webp/banners/dawn-splash.webp?url&no-inline';
	import defeatSplash from '$lib/assets-webp/banners/defeat-splash.webp?url&no-inline';
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
		riteMoving: 'The rite is moving. Hold.',
		oracleSilent: "The Oracle falls silent — the rite can't reach Sól. Draw breath, and ask again.",
		castFalters: 'The rite falters. The rune slips away.',
		wrongCast: (name: string) => `${name} is not the one. The night holds.`,
		runeTrue: 'The rune is true.',
		yourMove: 'Your move.',
		skollMoves: 'Sköll moves.',
		wolfStalled: 'The wolf stalls in the dark. Rouse him to move.',
		scryHim: 'You lean into the dark and listen. His answer is yours too.',
		hexHim: "You close the Oracle's lips. His question dies unanswered — his turn with it.",
		passHim: 'You hold your hand. Let him have his answer.',
		// Sköll's skill plays, voiced in the Oracle's text (rite voice, third person — never his gloat).
		// Hex replaces the answer (the question died); the Scry note trails the answer he overheard.
		skollHexes: "Sköll closes the Oracle's lips. Your question dies in the dark.",
		skollScried: 'Sköll listened at the threshold — the answer is his too.',
		sunCrests: 'Sól crests the rim of the world.',
		skollTakes: 'Sköll takes the sun.',
		nightHolds: 'The night lies deep and unbroken.',
		nightThins: 'Gray bleeds into the dark.',
		nightDawn: 'Dawn gathers at the edge of the world.',
		chooseTarget: 'Choose a rune from the board.',
		desktopOnly: 'The rite needs a wider sky. Return on a desktop to take up the runes.',
		castPrompt: (name: string) => `Cast ${name}?`,
		// Spoken-move guards (S7): engine truth handed to the model when a voiced action can't
		// run — never shown in the panel, since no move was made.
		wolfAsking: "Sköll's question hangs. Scry, hex, or pass before another move.",
		noReactionWindow: 'Sköll asks nothing. There is no question to scry, hex, or pass.',
		riteDone: 'The longest day is decided. Begin another night to play again.',
		unknownRune: (name: string) => `No rune named ${name} lies on the board.`,
		// Cast lockout (S9, R5): while a cast's engine round-trip is in flight, every voiced
		// command answers with this and dispatches nothing — the cast completes regardless.
		castSacred: 'The cast is sacred. Hold.',
		// Spoken-move confirmations (S8): voiced by the Oracle as the tool result when a
		// destructive call arms the gate — like the guards, never shown in the panel.
		confirmHex: 'His question dies unanswered and the hex is spent. Say it plain: shall I hex him?',
		confirmCast: (name: string) =>
			`${name}, staked on the longest day — a cast does not unwrite. Say it plain: shall I cast it?`
	};

	let castMode = $state(false);
	let selectedTargetId: number | null = $state(null);
	let askValue = $state('');
	let pending = $state(false);
	let aiNoteButton: HTMLButtonElement | null = $state(null);
	let aiNotePopover: HTMLElement | null = $state(null);

	// Shown once over the live board, then remembered — a refresh resumes the same round, so the title
	// must not nag the returning player.
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
	// Asymptotic, capped: the moon fully sets only on a win (uncapped, toFixed(3) hits 1.000 ~turn 47).
	let nightT = $derived(humanWon ? 1 : Math.min(0.95, 1 - Math.pow(0.85, turns)));
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
	// stable per-round token (opaque, minted with the round) and restore it on mount.
	let roundIdOverride: string | null = $state(null);
	let roundId = $derived(roundIdOverride ?? data.roundId);
	let crossings = $state<number[]>([]);
	let restoreCrossed = $state<number[]>([]);
	// Gate persistence until the post-mount restore has run, so the empty pre-restore state can't
	// overwrite a saved round before it is read back.
	let restored = $state(false);

	// The Oracle surface — one response at a time. A resumed human win opens on its victory line so
	// the panel and pill agree; a Sköll win leaves the last voiced line alone (restored from the
	// saved view) — the end screen owns the defeat text, and the panel must not repeat it.
	let answer = $state(
		untrack(
			() => (data.state.status === 'won' && data.state.winner === 'Human' ? RITE.runeTrue : '') // blank until the Oracle has a response to voice (or the saved view restores one)
		)
	);

	$effect(() => {
		// Track the view; write only once restoration is done. `crossings` reassigns on every edit and
		// `answer` on every voiced line, so this captures both without an explicit call at each site.
		// Skip while Sköll is stalled: that's a transient error line whose companion `skollStalled`
		// (and its retry button) isn't persisted, and onMount re-drives his move anyway — so keep the
		// last good line in storage instead of resuming a dead-end error the engine has moved past.
		const snapshot = { crossings: [...crossings], answer, voiceInvited };
		if (restored && !skollStalled) writeViewState(roundId, snapshot);
	});

	let selectedRune = $derived(
		selectedTargetId === null ? null : (runes.find((r) => r.id === selectedTargetId) ?? null)
	);

	// The medallion mirrors the voice session. Its state is a superset of VoiceState:
	// 'skoll-speaking' arrives with the director, never from the session itself. The failure
	// notice renders by the medallion — not in the Oracle's answer frame, which is her voiced
	// surface and persists across reloads; a transient voice failure must do neither.
	let voiceState = $state<MedallionState>('asleep');
	let voiceAmplitude = $state(0);
	let voiceNotice = $state('');
	// Per round, persisted with the view (S6): the invitation speaks once per game, not per tap.
	let voiceInvited = $state(false);

	// S8: the armed confirmation for a destructive tool call (hex, cast_rune). `heard` flips when
	// the player speaks after arming — the confirming call is refused without it, so the model can
	// never execute both phases in one breath. `spoke` flips on the Oracle's first turn since
	// arming (the confirmation question itself); a second turn while it is set means the exchange
	// ended without the call (a decline), so the gate disarms.
	let voiceConfirm: { name: string; rune?: string; heard: boolean; spoke: boolean } | null = null;

	// S9 (R5): true only while a cast's engine round-trip is in flight — board- or voice-made.
	// The executor rejects every voiced command for this window; nothing can cancel the cast
	// itself (barge-in only stops her audio, and the session never aborts a running executor).
	let casting = false;

	function onVoiceEvent(event: VoiceEvent) {
		switch (event.type) {
			case 'hearing':
				voiceState = 'hearing';
				voiceAmplitude = event.amplitude;
				break;
			// Eclipsed (S4): terminal mic seal. The medallion renders it inert and the session
			// refuses further wakes; the notice set by the preceding error stays for the session.
			case 'asleep':
			case 'eclipsed':
				voiceState = event.type;
				voiceAmplitude = 0;
				// Silence timeout, sleep tap, or the seal: the exchange is over, nothing executes (R4).
				voiceConfirm = null;
				break;
			case 'waking':
				voiceState = 'waking';
				// Cleared as the retry STARTS, not on success: a stale failure line under a stirring
				// medallion contradicts it, and an identical re-failure must re-announce (same string
				// assigned over itself is no change — no narration).
				voiceNotice = '';
				break;
			case 'listening':
				// A no-audio model turn can settle straight from thinking to listening. If the
				// player already answered the confirmation and no matching tool call landed, it
				// was a decline or drift — do not leave the destructive gate armed.
				if (voiceConfirm?.spoke && voiceConfirm.heard) voiceConfirm = null;
				voiceState = event.type;
				break;
			case 'thinking':
				voiceState = event.type;
				break;
			case 'speaking':
				// Guarded by the mirror so only a fresh speaking TURN counts — the session never
				// re-emits an unchanged state, but the gate must not hang on that subtlety.
				if (voiceConfirm && voiceState !== 'speaking') {
					if (voiceConfirm.spoke) voiceConfirm = null;
					else voiceConfirm.spoke = true;
				}
				voiceState = event.type;
				break;
			case 'error':
				voiceNotice = event.notice;
				// The session emits asleep (or eclipsed, for mic failures) right after every error,
				// but settle locally too — a medallion stranded in waking would promise a
				// silence-tap it can't honor.
				voiceState = 'asleep';
				voiceAmplitude = 0;
				voiceConfirm = null;
				break;
			case 'transcript':
				// The player spoke after the confirmation question — the gate may now accept the
				// confirming call. Rendering belongs to S10.
				if (event.direction === 'in' && voiceConfirm) voiceConfirm.heard = true;
				break;
			default:
				event satisfies never; // a new S10/S13 event type must be handled, not dropped
		}
	}

	// Waking counts as awake: a tap during the permission+token+connect stretch reaches sleep(),
	// which cancels the pending wake — it is never silently dropped.
	async function toggleVoice() {
		if (voiceSession.state !== 'asleep') {
			voiceSession.sleep();
			return;
		}
		const invitation = !voiceInvited;
		await voiceSession.wake({ invitation });
		// Marked only after the wake lands: a failed or canceled first wake re-invites next tap.
		if (invitation && voiceSession.state !== 'asleep' && voiceSession.state !== 'eclipsed') {
			voiceInvited = true;
		}
	}

	// Return type is derived from the action's `type`, so a caller can't request a
	// mismatched result shape.
	async function dispatch<T extends GameAction['type']>(
		action: Extract<GameAction, { type: T }>
	): Promise<ActionResponse<T>> {
		// Any engine action — typed, clicked, or voiced — supersedes a pending confirmation (S8):
		// the board moved on, so a stale armed gate must never carry into a later exchange.
		voiceConfirm = null;
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
			// A Sköll win deliberately leaves the Oracle's last voiced line in place (the answer, and
			// his Scry note when he overheard it) — that line is the WHY of the loss, and the end
			// screen already owns the "Sköll takes the sun" text. Never double it into the panel.
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
		// Warm the end-screen splashes at idle — EndScreen mounts only when the round resolves,
		// and a cold fetch there pops the closing rite in late. Idle (or a generous timeout where
		// requestIdleCallback is missing) keeps them out of the first-paint contest.
		const warmEndSplashes = () => {
			for (const src of [dawnSplash, defeatSplash]) new Image().src = src;
		};
		if ('requestIdleCallback' in window) requestIdleCallback(warmEndSplashes);
		else setTimeout(warmEndSplashes, 1500);
		// Restore the resumed round's view over the server-hydrated engine state — crossings onto the
		// board, the last voiced line into the panel. Layered on top: the engine stays the source of
		// truth (turn pill, status, pending reaction), this only restores presentation. A blank stored
		// line never overwrites a server-derived one (e.g. a resumed won round's victory line).
		const saved = readViewState(roundId);
		if (saved) {
			restoreCrossed = saved.crossings;
			crossings = saved.crossings;
			if (saved.answer) answer = saved.answer;
			voiceInvited = saved.voiceInvited;
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
		const unsubscribeVoice = voiceSession.subscribe(onVoiceEvent);
		// S7: the model's tool calls run against this page's game. Registered before any wake can
		// happen (the medallion renders with this mount), so a call can never find no executor.
		voiceSession.setToolExecutor(executeVoiceTool);
		// The session is a module singleton and the eclipse seal (S4) survives unmount — a remount
		// must adopt the live state, or the medallion would promise a wake the session will refuse.
		voiceState = voiceSession.state;
		if (voiceState === 'eclipsed' && voiceSession.notice) {
			voiceNotice = voiceSession.notice;
		}
		return () => {
			window.removeEventListener('resize', onReposition);
			window.removeEventListener('scroll', onReposition, true);
			clearTimeout(aiNoteHideTimer); // don't let a scheduled hide fire after teardown
			unsubscribeVoice();
			voiceSession.setToolExecutor(null); // a dead page's game must not answer tool calls
			voiceSession.sleep(); // never leave the mic streaming with no UI attached
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
		showOnboarding = false;
		// A failed write just means the title shows again next load — degrade, don't break play.
		try {
			localStorage.setItem(ONBOARDED_KEY, '1');
		} catch {
			/* storage unavailable — non-fatal */
		}
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

	// One Ask path for the typed field and the spoken `ask` tool (S7): identical dispatch,
	// identical panel updates. `hers` marks lines the Oracle herself voices (answer, refusal) —
	// system lines stay text-only; `consumed` tells the typed path whether to clear the field.
	// Never throws: a failed dispatch settles the panel and reports the silent-Oracle line.
	async function performAsk(
		question: string
	): Promise<{ line: string; hers: boolean; consumed: boolean }> {
		try {
			const { oracle, state, skollVsYou } = await dispatch({
				type: 'Ask',
				player: 'Human',
				question
			});
			applyState(state);
			let outcome: { line: string; hers: boolean; consumed: boolean };
			if (skollVsYou?.reaction === 'Hex') {
				// The Oracle text names the Hex — the question died, so it replaces the answer.
				// Not hers to voice: his Hex closed her lips.
				outcome = { line: RITE.skollHexes, hers: false, consumed: true };
			} else if (skollVsYou?.reaction === 'Scry' && oracle?.ok) {
				// The Oracle still speaks your answer (he overheard it), with his Scry noted after it.
				outcome = { line: `${oracle.answer} ${RITE.skollScried}`, hers: true, consumed: true };
			} else if (oracle?.ok) {
				outcome = { line: oracle.answer, hers: true, consumed: true };
			} else if (oracle?.reason === 'refusal') {
				outcome = { line: oracle.line, hers: true, consumed: false };
			} else if (oracle) {
				// not-your-turn means the engine has handed the turn to Sköll.
				outcome = {
					line: oracle.engineReason === 'not-your-turn' ? RITE.wolfMoving : RITE.oracleSilent,
					hers: false,
					consumed: false
				};
			} else {
				// no oracle and not a Hex — unexpected; fail to a safe line
				outcome = { line: RITE.oracleSilent, hers: false, consumed: false };
			}
			answer = outcome.line;
			return outcome;
		} catch (err) {
			// A real 500 here means something the server-side degradation did NOT catch — keep
			// a trace so it's distinguishable from an expected in-world refusal.
			console.error('[ui] Ask dispatch failed:', err);
			answer = RITE.oracleSilent;
			return { line: RITE.oracleSilent, hers: false, consumed: false };
		}
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
			const outcome = await performAsk(question);
			if (outcome.consumed) askValue = '';
			// The witch typed instead of speaking; if the session is awake her answer is spoken
			// too (S7) — the session drops the direction unless it is idle.
			if (outcome.hers) voiceSession.direct(oracleBoardEcho(outcome.line));
			await advanceSkoll();
		} finally {
			pending = false;
		}
	}

	// Never throws — see performAsk.
	async function performReact(choice: ReactionChoice): Promise<string> {
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
			let line: string;
			if (skollReaction?.hexed) {
				line = RITE.hexHim;
				heldHex = false;
			} else if (skollReaction?.scried) {
				// §3: the Scry framing leads, then the answer he was owed — now yours too.
				line = `${RITE.scryHim} ${skollReaction.scried.answer}`;
				heldScry = false;
			} else {
				line = RITE.passHim; // a Pass, or a reaction that didn't land
			}
			answer = line;
			return line;
		} catch (err) {
			console.error('[ui] React dispatch failed:', err);
			answer = RITE.oracleSilent;
			return RITE.oracleSilent;
		}
	}

	async function submitReact(choice: ReactionChoice) {
		pending = true;
		try {
			await performReact(choice);
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

	// Returns whether the reset landed, so a caller can avoid advancing the view on a failed reset.
	async function newGame(): Promise<boolean> {
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
			voiceInvited = false; // a new round re-arms the Oracle's wake invitation
			// Also cancels an in-flight wake, so a slow first wake can't mark the fresh round invited.
			voiceSession.sleep();
			applyState(state);
			cancelCast();
			return true;
		} catch (err) {
			console.error(`[ui] New game failed (status ${res?.status ?? 'network'}):`, err);
			answer = RITE.oracleSilent;
			return false;
		} finally {
			pending = false;
		}
	}

	// Never throws — see performAsk.
	async function performCast(runeName: string): Promise<string> {
		casting = true;
		try {
			const { cast, state } = await dispatch({
				type: 'Cast',
				player: 'Human',
				runeName
			});
			applyState(state);
			let line: string;
			if (cast.ok) {
				line = cast.won ? RITE.runeTrue : RITE.wrongCast(runeName);
			} else {
				console.warn('[ui] Cast rejected by engine:', cast.reason);
				line = RITE.castFalters;
			}
			answer = line;
			return line;
		} catch (err) {
			console.error('[ui] Cast dispatch failed:', err);
			answer = RITE.castFalters;
			return RITE.castFalters;
		} finally {
			// Released here, not in the callers: the lockout covers exactly the cast dispatch.
			// The wolf's follow-on move falls under the ordinary pending guard.
			casting = false;
			cancelCast();
		}
	}

	async function commitCast() {
		if (selectedRune === null) return;
		pending = true;
		try {
			await performCast(selectedRune.name);
			await advanceSkoll();
		} finally {
			pending = false;
		}
	}

	// S7: the model's five declared actions land here — the SAME dispatch the buttons use, so a
	// voiced move and a clicked move are indistinguishable to the engine. The returned line is
	// the tool result the Oracle voices; guard lines report a move the board would not offer
	// (its button disabled or target missing) without touching the panel.
	const REACTION_TOOLS: Record<string, ReactionChoice> = { scry: 'Scry', hex: 'Hex', pass: 'Pass' };

	// S8 (R4): hex and cast_rune execute only through a spoken confirmation exchange, and the
	// gate is client-authoritative — the first call only arms it and hands back the question to
	// voice; nothing the model sends can reach the engine until the player has spoken since
	// arming. Returns the question while the gate holds, null once confirmed.
	function gateDestructive(armed: typeof voiceConfirm, name: string, rune?: string): string | null {
		if (armed && armed.name === name && armed.rune === rune && armed.heard) return null;
		// Not armed, an unheard double-call, or a different target: (re-)arm and ask again.
		voiceConfirm = { name, rune, heard: false, spoke: false };
		return name === 'hex' ? RITE.confirmHex : RITE.confirmCast(rune ?? '');
	}

	async function executeVoiceTool({ name, args }: VoiceToolCall): Promise<string> {
		// The armed exchange survives only into its own clean confirming call: any other outcome —
		// a different tool, a guard line, an unknown rune — means the reply went elsewhere, and a
		// stale affirmation must never carry over to execute a later call.
		const armed = voiceConfirm;
		voiceConfirm = null;
		// S9 (R5): the cast lockout outranks every guard and the gate — checked after the
		// capture above so the armed exchange still dies, but before anything else can answer.
		if (casting) return RITE.castSacred;
		if (name === 'ask') {
			const question = typeof args.question === 'string' ? args.question.trim() : '';
			if (question === '') return RITE.emptyAsk;
			if (pending) return RITE.riteMoving;
			if (skollAsking) return RITE.wolfAsking;
			if (!canAct) return roundOver ? RITE.riteDone : RITE.wolfMoving;
			pending = true;
			try {
				return (await performAsk(question)).line;
			} finally {
				// Not awaited: the tool result must reach the model now, not after the wolf's move.
				// pending holds until his move settles — the same lock window the buttons get.
				void advanceSkoll().finally(() => {
					pending = false;
				});
			}
		}
		// Own-property check: the name is model input, and `in` would let inherited keys
		// (toString, __proto__) fall through to a garbage React dispatch.
		if (Object.hasOwn(REACTION_TOOLS, name)) {
			if (pending) return RITE.riteMoving;
			if (!skollAsking) return RITE.noReactionWindow;
			// Guards first: confirming a move the board doesn't offer would be an empty promise.
			if (name === 'hex') {
				const question = gateDestructive(armed, 'hex');
				if (question) return question;
			}
			pending = true;
			try {
				return await performReact(REACTION_TOOLS[name]);
			} finally {
				pending = false;
			}
		}
		if (name === 'cast_rune') {
			const spoken = typeof args.rune === 'string' ? args.rune.trim() : '';
			if (spoken === '') return RITE.chooseTarget;
			const rune = runes.find((r) => r.name.toLowerCase() === spoken.toLowerCase());
			if (!rune) return RITE.unknownRune(spoken);
			if (pending) return RITE.riteMoving;
			if (skollAsking) return RITE.wolfAsking;
			if (!canAct) return roundOver ? RITE.riteDone : RITE.wolfMoving;
			// Confirmation is per-target: a different rune re-arms and asks again (S8).
			const question = gateDestructive(armed, 'cast_rune', rune.name);
			if (question) return question;
			pending = true;
			try {
				return await performCast(rune.name);
			} finally {
				void advanceSkoll().finally(() => {
					pending = false;
				});
			}
		}
		throw new Error(`unknown tool: ${name}`);
	}
</script>

<svelte:head>
	<!-- Assets the preload scanner can't see: the title splash mounts only after hydration
	     (Onboarding) and the divider hides behind a CSS var — both paint on first load, so
	     fetch them with the document instead of after it. -->
	<link rel="preload" as="image" type="image/webp" href={introSplash} />
	<link rel="preload" as="image" type="image/webp" href={uiDivider} />
</svelte:head>

<div class="desktop-notice" data-testid="desktop-notice">
	<p class="notice-title">Save the Sun</p>
	<p class="notice-line">{RITE.desktopOnly}</p>
</div>

<main style="--night-t: {nightT.toFixed(3)}">
	<header class="rite-header" style="--night-t: {nightT.toFixed(3)}">
		<!-- decoding=sync: the sky is inlined (no fetch), so async decode would only push the
		     LCP paint past first render for nothing. -->
		<img
			class="header-background-image"
			src={moonSplash}
			width="1600"
			height="187"
			alt=""
			aria-hidden="true"
			decoding="sync"
			fetchpriority="high"
		/>
		<div class="title-block">
			<img
				class="app-sigil"
				src={appIcon}
				width="96"
				height="96"
				alt=""
				aria-hidden="true"
				decoding="async"
			/>
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
				<p class="tagline">A rite for the longest day.</p>
				<p
					class="night-progress"
					class:won={humanWon}
					class:lost={skollWon}
					data-testid={roundOver ? 'outcome-line' : 'night-progress'}
				>
					{roundOver ? outcomeLine : nightProgress}
				</p>
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
		</div>

		{#if !showEndScreen}
			<div class="header-controls">
				<button
					class="btn btn--secondary"
					type="button"
					data-testid="show-instructions"
					onclick={showInstructions}
				>
					How the rite works
				</button>
				<button
					class="btn btn--secondary new-game"
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
			<div class="voice-stack">
				<EclipseMedallion state={voiceState} amplitude={voiceAmplitude} onToggle={toggleVoice} />
				<!-- Always mounted (a live region born with content is skipped by screen readers) and
				     absolutely positioned: appearing must never reflow the panel under the player. -->
				<p class="voice-notice" data-testid="voice-notice" role="status">{voiceNotice}</p>
			</div>

			<hr class="ornate-divider oracle-divider" aria-hidden="true" />

			<!-- One line: the Oracle's name leads, the turn pill + AI note trail it — the old
			     standalone pill row spent a full row the wolf needed. -->
			<div class="oracle-header">
				<h2 class="oracle-title">The Oracle</h2>
				<div class="turn-pill-row">
					<!-- role=status: turn changes are narrated politely without stealing focus (v1.5 SR pass). -->
					<div
						class="turn-pill"
						class:won={humanWon}
						class:lost={skollWon}
						data-testid="turn-pill"
						role="status"
					>
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
			</div>

			<!-- role=status: every Oracle answer and refusal is narrated as it is voiced. -->
			<div class="oracle-frame" role="status">
				<p class="frame-text answer" data-testid="answer">{answer}</p>
			</div>

			<h2 class="skoll-title" data-testid="skoll-title">Sköll</h2>
			<!-- role=status: Sköll's Ask is narrated when it lands — it opens the reaction window,
			     so a screen-reader player must hear it without hunting for the frame. -->
			<div class="skoll-frame" data-testid="skoll-frame" role="status">
				{#if skollEcho}
					<p class="skoll-echo" data-testid="skoll-echo">{skollEcho}</p>
				{/if}
			</div>

			{#if skollAsking}
				<ReactionPrompt held={{ Scry: heldScry, Hex: heldHex }} onReact={submitReact} />
			{:else}
				<div class="reactions" data-coach="reactions">
					<button
						class="btn btn--secondary reaction-btn"
						type="button"
						title="When your rival asks, hear the answer too."
						aria-describedby="scry-hint"
						disabled
					>
						Scry
					</button>
					<button
						class="btn btn--secondary reaction-btn"
						type="button"
						title="When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted."
						aria-describedby="hex-hint"
						disabled
					>
						Hex
					</button>
					<!-- title alone is unreliable for AT and disabled buttons aren't focusable; expose the
					     same guidance to assistive tech through described-by text. -->
					<span id="scry-hint" class="sr-only">When your rival asks, hear the answer too.</span>
					<span id="hex-hint" class="sr-only"
						>When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted.</span
					>
				</div>
			{/if}

			{#if skollStalled}
				<button
					class="btn btn--secondary rouse-wolf"
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
				<!-- Visible label is the terse "Ask"; the sr-only tail keeps the accessible name as
				     the full rite phrase without an aria-label that label-queries would double-match. -->
				<button
					class="btn btn--primary ask-submit"
					type="submit"
					disabled={castMode || pending || !canAct}
				>
					Ask<span class="sr-only"> the Oracle</span>
				</button>
			</form>

			<div class="cast" data-coach="cast">
				{#if castMode}
					<p class="cast-hint" data-testid="cast-hint">
						{selectedRune ? RITE.castPrompt(selectedRune.name) : RITE.chooseTarget}
					</p>
					<div class="cast-actions">
						<button
							class="btn btn--primary"
							type="button"
							onclick={commitCast}
							disabled={!selectedRune || pending}
						>
							Name it
						</button>
						<button class="btn btn--secondary" type="button" onclick={cancelCast}>Not yet</button>
					</div>
				{:else}
					<button
						class="btn btn--primary cast-arm"
						type="button"
						onclick={armCast}
						disabled={pending || !canAct}
					>
						Cast the rune
					</button>
				{/if}
			</div>

			<!-- Decorative, in flow: the wolf's nose rides just under the cast controls, and the
			     moon ghosts up from the banner's top edge behind them. -->
			<div class="skoll-art" aria-hidden="true">
				<img
					class="skoll-moon"
					src={skollBanner}
					width="768"
					height="1376"
					alt=""
					decoding="async"
					fetchpriority="low"
				/>
				<img
					class="skoll-banner"
					src={skollBanner}
					width="768"
					height="1376"
					alt=""
					decoding="async"
					fetchpriority="low"
				/>
			</div>
		</aside>
	</div>
</main>

{#if showEndScreen}
	<EndScreen outcome={endOutcome} onReplay={newGame} />
{/if}

{#if showOnboarding}
	<Onboarding onDone={finishOnboarding} start={onboardingStart} />
{/if}

<style>
	main {
		position: relative;
		max-width: 1600px;
		margin: 0 auto;
		min-height: 100svh;
		padding: 1.25rem 2rem 2rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		isolation: isolate;
		--skoll-saturation: 1.04;
		--skoll-brightness: 1.06;
		--skoll-contrast: 1.04;
	}

	main::before {
		content: '';
		position: fixed;
		inset: 0;
		z-index: -1;
		background:
			linear-gradient(
				160deg,
				rgba(220, 171, 73, 0.2) 0%,
				rgba(56, 79, 130, 0.18) 42%,
				rgba(6, 9, 18, 0) 72%
			),
			linear-gradient(
				180deg,
				rgba(16, 23, 43, 0.4) 0%,
				rgba(6, 9, 18, 0) 54%,
				rgba(220, 171, 73, 0.12) 100%
			);
		opacity: var(--night-t, 0);
		pointer-events: none;
		transition: opacity 1.2s ease;
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

	/* Dawn seeps up the header as turns pass — the sky warms instead of the board darkening. */
	.rite-header::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background:
			linear-gradient(
				160deg,
				rgba(220, 171, 73, 0.2) 0%,
				rgba(56, 79, 130, 0.18) 42%,
				rgba(6, 9, 18, 0) 72%
			),
			linear-gradient(180deg, rgba(6, 9, 18, 0) 0%, rgba(220, 171, 73, 0.14) 100%);
		opacity: var(--night-t, 0);
		pointer-events: none;
		transition: opacity 1.2s ease;
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

	/* 44px of sky hangs hidden above the header; sliding it down sets the painted moon as turns pass. */
	.header-background-image {
		position: absolute;
		inset: -44px 0 0;
		z-index: 0;
		width: 100%;
		height: calc(100% + 44px);
		object-fit: cover;
		object-position: 50% 50%;
		translate: 0 calc(var(--night-t, 0) * 44px);
		filter: saturate(1.04) brightness(0.92) contrast(1.02);
		pointer-events: none;
		transition: translate 1.2s ease;
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
	}

	/* The risen sun replaces the moon on a human win — the saved sun, warm and radiant. */
	.sun-risen {
		width: 58px;
		height: 58px;
		filter: drop-shadow(0 0 20px rgba(243, 196, 90, 0.6));
	}

	.night-progress {
		margin: 0.35rem 0 0;
		font-family: var(--font-story-body);
		font-style: italic;
		font-size: 0.88rem;
		color: var(--ink-muted);
		white-space: nowrap;
	}

	.night-progress.won {
		color: var(--gold-bright);
		text-shadow: 0 0 12px rgba(217, 169, 74, 0.4);
	}

	.night-progress.lost {
		color: var(--steel);
	}

	.header-controls {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	.turn-pill-row {
		display: inline-flex;
		align-items: center;
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

	/* The panel's own background already dims its top — anything heavier here reads as a dark
	   box behind the medallion. Only the gold crown halo and a whisper of depth. */
	.oracle-panel::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		background:
			linear-gradient(180deg, rgba(6, 9, 18, 0.28) 0%, transparent 65%),
			radial-gradient(circle at 50% 0%, rgba(217, 169, 74, 0.1) 0%, transparent 36%);
		pointer-events: none;
	}

	/* Bleeds past the panel padding; relative so the moon anchors to the banner, not the panel —
	   percentage-of-panel positioning put the moon behind the opaque wolf on tall viewports. */
	.skoll-art {
		position: relative;
		width: calc(100% + 2.2rem);
		margin: 0 -1.1rem;
	}

	.skoll-moon {
		position: absolute;
		bottom: calc(100% - 2rem);
		left: 0;
		width: 100%;
		height: 10rem;
		object-fit: cover;
		object-position: 50% 0%;
		opacity: 0.6;
		filter: brightness(1.35);
		mask-image: linear-gradient(180deg, transparent 0%, black 30%, black 80%, transparent 100%);
		-webkit-mask-image: linear-gradient(
			180deg,
			transparent 0%,
			black 30%,
			black 80%,
			transparent 100%
		);
		pointer-events: none;
	}

	.oracle-panel > :not(.skoll-art) {
		position: relative;
		z-index: 2;
	}

	.oracle-panel > .oracle-header {
		z-index: 4;
	}

	/* Name left, turn pill + AI note right — one line instead of two stacked rows. Wrap is
	   the escape hatch for the long end-of-round pill texts, not the everyday case. */
	.oracle-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.35rem 0.5rem;
	}

	/* Tighter type than the standalone titles: name + pill + note share ~325px. */
	.oracle-header .oracle-title {
		white-space: nowrap;
		font-size: 0.95rem;
		letter-spacing: 0.2em;
	}

	.voice-stack {
		position: relative;
	}

	/* Overlay pill under the disc: legible at body size, opaque backdrop, zero layout impact. */
	.voice-notice {
		position: absolute;
		inset: auto 0.25rem -0.5rem;
		margin: 0 auto;
		width: fit-content;
		max-width: 100%;
		padding: 0.4rem 0.8rem;
		text-align: center;
		font-family: var(--font-story-body);
		font-size: 0.95rem;
		line-height: 1.35;
		color: var(--ink);
		background: rgba(6, 9, 18, 0.92);
		border: 1px solid var(--gold-dim);
		border-radius: 8px;
		pointer-events: none;
		z-index: 5;
	}

	/* Empty = invisible but still in the tree: display:none would re-break SR announcement. */
	.voice-notice:empty {
		padding: 0;
		border: none;
	}

	.oracle-title {
		margin: 0;
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

	/* Left-aligned to mirror the Oracle's merged header line. */
	.skoll-title {
		margin: 0.2rem 0 0.1rem;
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

	/* One line: the field flexes, the terse Ask button rides beside it. */
	.ask {
		display: flex;
		align-items: stretch;
		gap: 0.45rem;
	}

	.ask input {
		flex: 1;
		min-width: 0;
	}

	.ask-submit {
		flex: none;
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

	.ask {
		/* Near-opaque, not the translucent inset: the field must read as a field over the
		   bottom-anchored wolf art, especially in the short embed panel. */
		--ask-field-bg: rgba(9, 13, 26, 0.88);
	}

	.ask input {
		padding: 0.65rem 0.7rem;
		background: var(--ask-field-bg);
		border: 1px solid rgba(233, 200, 119, 0.4);
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
		-webkit-box-shadow: 0 0 0 1000px var(--ask-field-bg) inset;
		caret-color: var(--ink);
		transition: background-color 9999s ease-in-out 0s;
	}

	.ask input:-webkit-autofill:focus {
		-webkit-box-shadow:
			var(--focus-ring),
			0 0 0 1000px var(--ask-field-bg) inset;
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
		background: linear-gradient(180deg, rgba(6, 9, 18, 0.98), rgba(3, 5, 10, 0.98));
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
		display: block;
		width: 100%;
		/* The bottom band of the art, sized so the wolf's nose tip sits at the top edge —
		   directly under the cast controls in flow. */
		height: 28.25rem;
		object-fit: cover;
		object-position: 50% 100%;
		filter: saturate(var(--skoll-saturation)) brightness(var(--skoll-brightness))
			contrast(var(--skoll-contrast));
		mask-image: linear-gradient(180deg, transparent 0%, black 8%, black 94%, transparent 100%);
		-webkit-mask-image: linear-gradient(
			180deg,
			transparent 0%,
			black 8%,
			black 94%,
			transparent 100%
		);
		pointer-events: none;
	}

	/* The one deliberate floor: below 750px the rite steps aside; 750px+ gets a compact
	   embedded layout so the playable board works in narrow embeds. */
	.desktop-notice {
		display: none;
	}

	@media (min-width: 750px) and (max-width: 1279.98px) {
		main {
			max-width: 100%;
			min-height: 100svh;
			padding: 0.75rem;
			gap: 0.5rem;
		}

		.rite-header {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'title night'
				'controls controls';
			gap: 0.65rem;
			min-height: auto;
			padding: 0.7rem;
		}

		.title-block {
			grid-area: title;
			min-width: 0;
			gap: 0.6rem;
		}

		.app-sigil {
			width: 56px;
			height: 56px;
		}

		h1 {
			font-size: 1.55rem;
		}

		.tagline {
			font-size: 0.85rem;
		}

		.night-block {
			grid-area: night;
		}

		.night-progress {
			font-size: 0.78rem;
		}

		.header-controls {
			grid-area: controls;
			justify-self: stretch;
			justify-content: flex-end;
			flex-wrap: wrap;
			gap: 0.55rem;
		}

		.header-controls .btn {
			min-height: 2.45rem;
			padding: 0.58rem 0.9rem;
			font-size: 0.72rem;
		}

		.game-layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.75rem;
		}

		.board-section {
			justify-content: flex-start;
		}

		.board-section :global(.rune-grid) {
			--rune-grid-columns: 4;
			--rune-grid-max-inline-size: 55.1rem;
			--rune-card-padding: 0.62rem 0.64rem 0.82rem;
			--rune-card-middle-gap: 0.34rem;
			--rune-card-name-size: 0.92rem;
			--rune-card-name-line-height: 1.05;
			--rune-card-meaning-size: 0.68rem;
			--rune-power-gap: 0.04rem;
			--rune-power-label-size: 0.62rem;
			--pip-icon-size: 14px;
			--symbol-box-height: 2.8rem;
			--symbol-image-width: auto;
			--symbol-image-height: 2.8rem;
			--symbol-image-max-width: 58%;
			--symbol-image-max-height: 100%;
		}

		.oracle-panel {
			--speaker-title-size: 0.92rem;
			--speaker-title-tracking: 0.24em;
			--frame-pad: 0.48rem 0.6rem;
			--frame-min-h: 2.35rem;
			--reaction-min-h: 2.45rem;
			--reaction-font: 0.72rem;

			/* The rite's controls lead in the single-column embed; the board follows. */
			order: -1;
			gap: 0.6rem;
			padding: 0.85rem 0.9rem 0;
		}

		.frame-text,
		.skoll-echo {
			font-size: 0.92rem;
			line-height: 1.4;
		}

		.skoll-banner {
			height: 16rem;
		}
	}

	@media (max-width: 749.98px) {
		main {
			display: none;
		}

		.desktop-notice {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 1rem;
			/* svh, not vh: this is the mobile surface, where a vh floor hides the tagline
			   behind the collapsed address bar. */
			min-height: 100svh;
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
