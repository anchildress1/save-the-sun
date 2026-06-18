<script lang="ts">
	import { untrack, tick, onMount } from 'svelte';
	import RuneGrid from '$lib/components/RuneGrid.svelte';
	import ReactionPrompt from '$lib/components/ReactionPrompt.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import EndScreen from '$lib/components/EndScreen.svelte';
	import EclipseMedallion from '$lib/components/EclipseMedallion.svelte';
	import type { MedallionState } from '$lib/components/medallionState';
	import { readMuted, writeMuted } from '$lib/voice/outputMute';
	import {
		enableDelivery,
		disableDelivery,
		stopDelivery,
		deliver,
		whenDrained,
		subscribeDelivery,
		currentLevel,
		type DeliveryEvent
	} from '$lib/voice/delivery';
	import {
		startRecording,
		stopRecording,
		releaseRecorder,
		recorderSealed,
		closeRecorder
	} from '$lib/voice/recorder';
	import type { LineDescriptor } from '$lib/server/voice/lines';
	import { REACTION_LINES } from '$lib/voice/reactionLines';
	import { CAST_TRUE, CAST_FALTERS, wrongCastLine } from '$lib/voice/castLines';
	import { VOICED_SEQUENCE } from '$lib/voice/outcomeLines';
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
		oracleSilent: "The Oracle falls silent — the rite can't reach Sól.",
		castFalters: CAST_FALTERS,
		wrongCast: wrongCastLine,
		runeTrue: CAST_TRUE,
		yourMove: 'Your move.',
		skollMoves: 'Sköll moves.',
		wolfStalled: 'The wolf stalls — rouse him.',
		// Shared with the TTS allow-list so the panel text and the voiced line are one source.
		scryHim: REACTION_LINES['human-scry'],
		hexHim: REACTION_LINES['human-hex'],
		passHim: REACTION_LINES['human-pass'],
		// Sköll's skill plays, voiced in the Oracle's text (rite voice, third person — never his gloat).
		// Hex replaces the answer (the question died); the Scry note trails the answer he overheard.
		skollHexes: REACTION_LINES['skoll-hex'],
		skollScried: REACTION_LINES['skoll-scry'],
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
		wolfAsking: 'His question hangs — scry, hex, or pass.',
		noReactionWindow: 'Sköll asks nothing to scry, hex, or pass.',
		// A spoken reply to Sköll's question the model couldn't read as a reaction — ask again, spend nothing.
		reactUnclear: 'Scry, hex, or pass — or let his question stand.',
		castUnclear: 'Name a rune on the board to cast it — or cast by hand.',
		scrySpent: 'Your scrying is spent for the night.',
		hexSpent: 'Your hex is spent for the night.',
		riteDone: 'The longest day is decided — begin anew.',
		unknownRune: (name: string) => `No rune named ${name} lies on the board.`,
		// Cast lockout (S9, R5): while a cast's engine round-trip is in flight, every voiced
		// command answers with this and dispatches nothing — the cast completes regardless.
		castSacred: 'The cast is sacred. Hold.',
		// Spoken-move confirmations (S8): voiced by the Oracle as the tool result when a
		// destructive call arms the gate — like the guards, never shown in the panel.
		// Short by design: the exchanges recur, and a spoken preamble every time wears thin.
		// The irreversibility doctrine lives in the persona, not the question.
		confirmScry: 'Lean into the dark?',
		confirmHex: 'Seal his lips?',
		confirmCast: (name: string) => `Stake the round on ${name}?`,
		// Reaction affordance hints — one source for the title tooltip and the sr-only described-by.
		hintScry: 'When your rival asks, hear the answer too.',
		hintHex:
			"When your rival asks, seal the Oracle's lips — no answer comes, and his turn is wasted.",
		hintPass: 'When your rival asks, let the question stand.',
		// Hover hints for the shut Ask field — why it's closed and what to do first.
		askHintReact: 'Answer Sköll first — Scry, Hex, or Pass — then ask.',
		askHintCast: 'Name your rune or step back from the cast, then ask.',
		askHintPending: 'The rite is moving. Hold, then ask.',
		askHintWolf: 'Sköll is moving. Hold, then ask.',
		askHintOver: 'The rite is over.',
		// Output mute (R11): the toggle's accessible name carries the action plus the reassurance
		// that nothing is lost — the words still arrive in the panel.
		muteVoices: 'Silence the voices. Their words still appear in writing.',
		unmuteVoices: 'Let the voices be heard.',
		// Push-to-talk (R1): a denied or absent mic seals the medallion; the rite goes on by hand.
		micDenied: 'The fire cannot hear you. The rite continues by hand.',
		// A transient mic failure (not sealed) — the player can hold again to retry.
		micRetry: 'The fire flickered. Hold again to speak.'
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

	// A spoken reply to Sköll's question, classified server-side; `unclear` matches no reaction.
	type SpokenReaction = 'scry' | 'hex' | 'pass' | 'unclear';
	const SPOKEN_REACTION: Record<'scry' | 'hex' | 'pass', ReactionChoice> = {
		scry: 'Scry',
		hex: 'Hex',
		pass: 'Pass'
	};

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
	// A human win gilds the outcome line and finishes the dawn (nightT → 1); a Sköll win holds the
	// moonlit night and the defeat tag.
	let humanWon = $derived(roundOver && winner === 'Human');
	let skollWon = $derived(roundOver && winner === 'Sköll');
	let outcomeLine = $derived(humanWon ? RITE.sunCrests : RITE.skollTakes);
	// The end-screen rite takes over when the round resolves (S9). It owns the replay surface, so the
	// header's own controls fold away while it is up — one "Begin another night" on screen, not two.
	// Held back (`endHeld`) until the Oracle's last spoken line has drained, so the splash never stomps
	// her answer mid-sentence when Sköll's winning cast lands right behind it.
	let endHeld = $state(false);
	// A live Sköll cast must play like any other turn — his cast frame shows before the defeat splash.
	// With audio on, the spoken line paces that beat; with audio off there's nothing to wait on, so the
	// hold runs a fixed beat instead of revealing the splash at once. Set the round his cast lands,
	// cleared when the beat ends or the round leaves the won state.
	const SKOLL_CAST_BEAT_MS = 1800;
	let skollCastPending = $state(false);
	let showEndScreen = $derived(roundOver && !endHeld);
	let endOutcome = $derived<'win' | 'lose'>(humanWon ? 'win' : 'lose');

	// Voice the closing rite once the splash is up (ux-copy §4, ttd:22): the winner speaks ONE authored
	// in-character line — the Oracle's blessing on a win, Sköll's gloat on a loss — carried (signed) on
	// the resolving response. NOT a read of the fixed splash copy (the player reads that on screen). When
	// no authored line rode the response (authoring failed, or a resumed round), fall back to the fixed
	// punch beat. Once per round; reset by a new game.
	let outcomeVoiced = false;
	let endFlair = $state<LineDescriptor | null>(null);
	$effect(() => {
		// Flip the once-guard only when the speaker is open — so a resumed/won round cannot spend
		// its outcome voice before the browser gesture unlocks audio. The medallion follows the
		// delivery events (ember for Sköll's loss, gold for the Oracle's win).
		if (showEndScreen && !outcomeVoiced && audioOn && audioReady) {
			outcomeVoiced = true;
			if (endFlair) void deliver(endFlair);
			else
				for (const beat of VOICED_SEQUENCE[endOutcome])
					void deliver({ kind: 'outcome', result: endOutcome, beat });
		}
	});
	let nightProgress = $derived(
		turns <= 2 ? RITE.nightHolds : turns <= 5 ? RITE.nightThins : RITE.nightDawn
	);
	// Asymptotic, capped: the moon fully sets only on a win (uncapped, toFixed(3) hits 1.000 ~turn 47).
	let nightT = $derived(humanWon ? 1 : Math.min(0.95, 1 - Math.pow(0.85, turns)));
	// Cross-off is a private aid, never turn-gated — RuneGrid owns it and stays enabled through Sköll's turn.
	let canAct = $derived(activePlayer === 'Human' && !roundOver);
	// Why the Ask field is shut, most-actionable first — surfaced as its hover title so a disabled
	// field explains itself instead of just refusing the cursor. Empty when the field is live.
	let askHint = $derived(
		castMode
			? RITE.askHintCast
			: skollAsking
				? RITE.askHintReact
				: pending
					? RITE.askHintPending
					: !canAct
						? roundOver
							? RITE.askHintOver
							: RITE.askHintWolf
						: ''
	);
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
		// Hold the end-screen the instant the round resolves with audio on, synchronously — otherwise
		// the splash flashes for one frame before the post-render effect below can catch it. The effect
		// still owns releasing the hold once her last line has drained.
		if (state.status === 'won' && audioOn) endHeld = true;
	}

	// His box shows ONLY his templated question when he Asks, blank otherwise. The cast outcome derives
	// from engine truth (winner), so there's one source of "Sköll won," not two that can drift.
	function applySkoll(skoll: SkollTurn | undefined) {
		if (skoll === undefined) return;
		if (skoll.asks) {
			skollEcho = skoll.asks.echo;
			skollAsking = true;
		} else if (skoll.casts) {
			// His winning cast is a written game move (R10) — his box shows the line he speaks as the
			// night closes; the end screen rises behind it once it's been heard.
			skollEcho = skoll.casts.echo;
			skollAsking = false;
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
		const snapshot = { crossings: [...crossings], answer };
		if (restored && !skollStalled) writeViewState(roundId, snapshot);
	});

	// The most recent Oracle line's audio (or null when none/text-only). Not reactive — just a handle
	// the end-screen hold awaits so the splash never preempts her final answer.
	let answerAudio: Promise<void> | null = null;

	// A Sköll line generated before the speaker is open (a reload that resumes on his turn re-drives his
	// move in onMount, before the first gesture) is held here and voiced once audio is ready, so it isn't
	// spent into a no-op deliver() and lost while audio is on. Covers both his Ask and a winning Cast —
	// a resumed defeat must still replay "I name it…" once a gesture opens the speaker.
	let pendingSkollVoice: LineDescriptor | null = null;
	// Settles the promise voiceSkoll handed back for a queued line — resolved when flushPendingVoice
	// finally plays it (or when the line is dropped). Keeps `answerAudio` honest: the end-screen hold
	// waits for the real post-gesture playback, not a phantom resolve, so a resumed defeat plays his
	// cast before the splash instead of late over it.
	let pendingSkollResolve: (() => void) | null = null;
	function voiceSkoll(descriptor: LineDescriptor): Promise<void> {
		if (audioReady) return deliver(descriptor);
		if (!audioOn) return Promise.resolve();
		pendingSkollVoice = descriptor;
		return new Promise<void>((resolve) => {
			pendingSkollResolve = resolve;
		});
	}
	function flushPendingVoice() {
		if (pendingSkollVoice && audioReady) {
			const done = deliver(pendingSkollVoice);
			const settle = pendingSkollResolve;
			pendingSkollVoice = null;
			pendingSkollResolve = null;
			if (settle) void done.finally(settle);
		}
	}

	// Hold the end-screen splash so the resolving turn plays before it. Two ways to pace the hold:
	// audio drain (a voiced line is in flight) or a fixed beat (a live Sköll cast with audio off, which
	// has nothing to wait on but must still show his cast frame). A resumed or text-only win with no
	// line in flight shows the splash at once. Capped so a stuck synth can never strand it off-screen.
	$effect(() => {
		if (!roundOver) {
			endHeld = false;
			skollCastPending = false;
			return;
		}
		// answerAudio is a plain handle, not reactive; the effect re-runs on roundOver/audioOn/cast, by
		// when it's set.
		const holdForAudio = audioOn && answerAudio !== null;
		const holdForBeat = !audioOn && skollCastPending;
		if (!holdForAudio && !holdForBeat) {
			endHeld = false;
			return;
		}
		endHeld = true;
		let cancelled = false;
		const HOLD_CAP_MS = 8000;
		const release = () => {
			if (cancelled) return;
			endHeld = false;
			skollCastPending = false;
		};
		if (holdForBeat) {
			// Silent cast: a fixed beat to read his cast frame, then the splash.
			const timer = setTimeout(release, SKOLL_CAST_BEAT_MS);
			return () => {
				cancelled = true;
				clearTimeout(timer);
			};
		}
		// Voiced: wait for the line to stream in and drain, raced against a hard cap so a hung stream
		// can never strand the splash off-screen.
		Promise.race([
			(async () => {
				try {
					await answerAudio;
				} catch {
					/* a failed delivery never blocks the splash */
				}
				await whenDrained(HOLD_CAP_MS);
			})(),
			new Promise((resolve) => setTimeout(resolve, HOLD_CAP_MS))
		]).finally(release);
		return () => {
			cancelled = true;
		};
	});

	let selectedRune = $derived(
		selectedTargetId === null ? null : (runes.find((r) => r.id === selectedTargetId) ?? null)
	);

	// The medallion is the push-to-talk control: 'recording' while held, 'thinking' while the held
	// utterance is transcribed and asked, the spoken voice while a line plays (driven by delivery),
	// 'denied' if the mic is sealed, else 'idle'. No Live session — one held recording per Ask.
	let medalState = $state<MedallionState>('idle');
	// One quiet line when the mic is denied/absent; the button game is unaffected.
	let voiceNotice = $state('');
	// Audio preference + speaker readiness (voice-as-delivery). The preference can be on before the
	// browser lets us open an AudioContext; delivery should spend one-shot lines only once ready.
	let audioOn = $state(false);
	let audioReady = $state(false);
	let holdWanted = false;
	let holdSetupPending = false;
	// The hold's intent is fixed at PRESS, not release: whether Sköll's question hung then (reaction vs
	// Ask) and the round/turn at that moment. A button reaction or any action during the hold then
	// changes the live state but not these — so the clip resolves as what the player meant, or drops.
	let holdReacting = false;
	// A hold begun with a cast armed names the rune to commit (the deliberate arm is the safety step,
	// so a misheard question can never cast). Fixed at press like holdReacting.
	let holdCasting = false;
	// Bumped on every arm AND cancel, captured at the press: a transcription that resolves after the
	// player canceled (or canceled-then-re-armed) sees a changed generation and drops — a stale boolean
	// `castMode` would be true again after a re-arm and wrongly commit the abandoned utterance.
	let castArm = 0;
	let holdCastArm = 0;
	let holdToken = '';

	// Drive the medallion's voice from delivery playback: a line begins → its speaker; the queue
	// drains → back to idle (unless a hold/transcribe is mid-flight, which owns the state then).
	function onDeliveryEvent(event: DeliveryEvent) {
		// A live hold owns the medallion. A queued line (her answer finishing, his Ask beginning) can
		// emit 'speaking' while the player has already started a new hold — letting it overwrite
		// 'recording' would strand endHold (which finishes only from 'recording'), losing the utterance
		// and leaving the mic live. The hold restores the medallion itself on release.
		if (holdWanted || holdSetupPending) return;
		if (event.type === 'speaking') {
			medalState = event.voice === 'skoll' ? 'skoll-speaking' : 'speaking';
		} else if (medalState === 'speaking' || medalState === 'skoll-speaking') {
			medalState = 'idle';
		}
	}

	// Audio output toggle (the mute control). Turning it on opens the delivery speaker from this tap
	// — the gesture browsers require; off closes it so an audio-off board never POSTs to the TTS route.
	function toggleAudio() {
		if (!audioOn) {
			try {
				enableDelivery(); // must run inside the tap — opens the AudioContext
			} catch (err) {
				// Web Audio unsupported, or the browser's AudioContext cap is hit: stay in the silent
				// fallback rather than claiming audio is on with no speaker behind it.
				console.error('[ui] could not open the delivery speaker:', err);
				return;
			}
			audioOn = true;
			audioReady = true;
			flushPendingVoice(); // a resumed Sköll Ask held before audio was on now voices
		} else {
			audioOn = false;
			audioReady = false;
			pendingSkollVoice = null; // muted: drop the held line rather than voice it on a later unmute
			pendingSkollResolve?.(); // settle any end-screen waiter — the dropped line won't play now
			pendingSkollResolve = null;
			disableDelivery();
		}
		writeMuted(!audioOn);
	}

	// Push-to-talk (R1/R6). Hold the medallion (or Space) to record; the mic opens on first hold (one
	// prompt). A denial/absent mic seals it for the session — the medallion goes inert and the rite
	// continues by hand. Recording is independent of audio output: you can ask with the sound off.
	async function startHold() {
		if (recorderSealed()) {
			medalState = 'denied';
			return;
		}
		if (holdWanted || holdSetupPending || medalState === 'recording' || medalState === 'thinking') {
			return;
		}
		// Fix the hold's intent + freshness at the moment of the press. Reaction wins over cast (his
		// question is only open on his turn; cast is armed only on hers, so they never truly overlap).
		holdReacting = skollAsking;
		holdCasting = !skollAsking && castMode;
		holdCastArm = castArm;
		holdToken = `${roundId}:${turns}`;
		holdWanted = true;
		holdSetupPending = true;
		const verdict = await startRecording();
		holdSetupPending = false;
		if (!verdict.ok) {
			holdWanted = false;
			if (verdict.reason === 'audio') {
				// Transient (the recorder didn't seal it) — return to idle so the player can retry; the
				// 'denied' state would make the medallion inert and lock out a mic that still works.
				medalState = 'idle';
				voiceNotice = RITE.micRetry;
			} else {
				medalState = 'denied';
				voiceNotice = RITE.micDenied;
			}
			return;
		}
		if (!holdWanted) {
			await finishHold();
			return;
		}
		medalState = 'recording';
	}

	// Release: stop recording, transcribe the utterance, and run it as a normal Ask. A failed/empty
	// transcription degrades to nothing (no turn spent), never throws.
	async function endHold() {
		if (!holdWanted && !holdSetupPending && medalState !== 'recording') return;
		holdWanted = false;
		if (holdSetupPending || medalState !== 'recording') return;
		await finishHold();
	}

	async function finishHold() {
		// Intent + freshness were fixed at the press (holdReacting/holdToken), not here: a button reaction
		// or any action taken DURING the hold can't reclassify a held scry/hex/pass into an Ask, and the
		// stale clip is dropped rather than replayed into the moved turn.
		const reacting = holdReacting;
		const casting = holdCasting;
		const token = holdToken;
		const fresh = () => `${roundId}:${turns}` === token;
		medalState = 'thinking';
		try {
			const clip = await stopRecording();
			// Drop the mic the instant the clip is assembled — before the transcribe round-trip — so
			// Chrome's in-use indicator clears on release, not at the end of the turn.
			releaseRecorder();
			if (clip && reacting) {
				const choice = await classifyReactionUtterance(clip.wavBase64);
				if (fresh()) await respondReaction(choice);
			} else if (clip && casting) {
				// Armed by hand: the rune name alone casts (the arm already declared intent). Re-check the
				// arm generation AFTER the transcribe — "Not yet" (or a cancel-then-re-arm) bumps it, so an
				// irreversible cast can't land against an arm the player abandoned.
				const name = await classifyCastUtterance(clip.wavBase64);
				if (fresh() && castArm === holdCastArm) await respondCast(name);
			} else if (clip) {
				// A normal hold is a question — or a hands-free cast when the player explicitly names a
				// rune. The spoken words never fill the typing box (the route tees what was heard to
				// /debug). Re-check the gate after the async read: a hold begun during Sköll's turn must
				// not land once the lock frees and steal the next turn.
				const heard = await interpretUtterance(clip.wavBase64);
				if (fresh()) {
					if ('cast' in heard) {
						await respondCast(heard.cast);
					} else {
						const question = heard.text.trim();
						if (question !== '' && canAct && !pending && !castMode) {
							await runAsk(question, false);
						}
					}
				}
			}
		} catch (err) {
			console.error('[ui] push-to-talk failed:', err);
		}
		// If no line played (audio off, a silent turn, a guard), settle the medallion ourselves; a
		// delivered line already drove it to speaking → idle via onDeliveryEvent.
		if (medalState === 'thinking') medalState = 'idle';
	}

	// A hung transcribe fetch would strand the medallion in 'thinking' and block every later hold, so
	// each read is bounded — on timeout the AbortController trips and the call degrades like any failure.
	const TRANSCRIBE_TIMEOUT_MS = 15_000;

	async function postUtterance(body: object): Promise<Response | null> {
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), TRANSCRIBE_TIMEOUT_MS);
		try {
			return await fetch('/api/voice/transcribe', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: abort.signal
			});
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}

	// Read a normal hold: a question, or a hands-free cast when the player names a board rune. Sends the
	// board names so the server can match a spoken cast; a `cast` result (even '') means cast intent,
	// so it routes to respondCast rather than being re-read as a question. Degrades to an empty Ask.
	async function interpretUtterance(
		wavBase64: string
	): Promise<{ cast: string } | { text: string }> {
		const res = await postUtterance({ wavBase64, runes: runes.map((r) => r.name) });
		if (!res?.ok) return { text: '' };
		try {
			const data = (await res.json()) as { rune?: string; text?: string };
			return typeof data.rune === 'string' ? { cast: data.rune } : { text: data.text ?? '' };
		} catch {
			return { text: '' };
		}
	}

	// Classify a held reply to Sköll's hanging question into a reaction; `unclear` on any failure, so
	// a misheard or dropped call never silently spends a one-use charge.
	async function classifyReactionUtterance(wavBase64: string): Promise<SpokenReaction> {
		const res = await postUtterance({ wavBase64, mode: 'reaction' });
		if (!res?.ok) return 'unclear';
		try {
			return ((await res.json()) as { choice?: SpokenReaction }).choice ?? 'unclear';
		} catch {
			return 'unclear';
		}
	}

	// Match a held cast utterance to a board rune (server constrains the answer to the names we send);
	// '' on any failure or a name that isn't on the board, so a mishear never commits the cast.
	async function classifyCastUtterance(wavBase64: string): Promise<string> {
		const res = await postUtterance({ wavBase64, mode: 'cast', runes: runes.map((r) => r.name) });
		if (!res?.ok) return '';
		try {
			return ((await res.json()) as { rune?: string }).rune ?? '';
		} catch {
			return '';
		}
	}

	// Run a spoken reaction through the same dispatch the prompt buttons use. Guards mirror the
	// buttons: a spent scry/hex is refused (not silently passed), and an unread reply asks again
	// rather than guessing — only the pass is free, and nothing is staked on a mishear.
	async function respondReaction(choice: SpokenReaction) {
		// The window may have closed (a board click) or a move may be mid-flight while we classified.
		if (!skollAsking || pending) return;
		if (choice === 'unclear') {
			answer = RITE.reactUnclear;
			return;
		}
		if (choice === 'scry' && !heldScry) {
			answer = RITE.scrySpent;
			return;
		}
		if (choice === 'hex' && !heldHex) {
			answer = RITE.hexSpent;
			return;
		}
		pending = true;
		try {
			await performReact(SPOKEN_REACTION[choice]);
		} finally {
			pending = false;
		}
	}

	// Commit a spoken cast through the same path the board's "Name it" uses — whether armed by hand
	// first or named hands-free (the server only resolves a name on an explicit cast + exact board
	// match). Guards mirror the button: the turn must be live; a name that didn't resolve to a board
	// rune asks again rather than guessing, so the irreversible cast is never staked on a mishear.
	async function respondCast(name: string) {
		if (pending || !canAct) return;
		const rune = name ? runes.find((r) => r.name === name) : undefined;
		if (!rune) {
			answer = RITE.castUnclear;
			return;
		}
		selectedTargetId = rune.id;
		await commitCast();
	}

	// Build the descriptor for the Oracle's own spoken line (answer or refusal) so the delivery
	// layer can voice it via the server TTS route. System lines (Sköll's, the engine's) aren't hers.
	function oracleVoice(oracle: ActionResponse<'Ask'>['oracle']): LineDescriptor | null {
		if (!oracle) return null;
		// Refusal wins first: a result carrying a refusal must never voice an answer, even if it also
		// reads ok — a malformed both-state refuses rather than speaking a verdict it shouldn't.
		if ('refusal' in oracle) return { kind: 'refusal', refusal: oracle.refusal };
		if (oracle.ok) return { kind: 'answer', query: oracle.query, affirmative: oracle.affirmative };
		return null;
	}

	// Sköll's Ask descriptor — the server recomposes his line from the query, so the TTS route still
	// voices only a server-owned line, just in his voice.
	function skollVoice(query: unknown): LineDescriptor {
		return { kind: 'skoll-ask', query };
	}

	// Action/new-game hit Gemini (Ask interpret + Sköll move), so a hung request would strand `pending`
	// and lock the controls — each fetch is bounded, and on timeout the AbortController trips and the
	// call degrades through the existing catch paths. Generous because the model round-trip is the cost.
	const ACTION_TIMEOUT_MS = 30_000;

	// Mirrors the load/`/api/state` snapshot — the authoritative round the client resyncs to.
	type RecoveredLine = { text: string; voice: LineDescriptor | null };
	type StateSnapshot = {
		boardSeed: number;
		roundId: string;
		state: GameState;
		pendingReaction: { echo: string; held: { Scry: boolean; Hex: boolean } } | null;
		// The last committed voiced line — the real result a dropped response lost (ttd:29).
		lastLine: RecoveredLine | null;
	};

	// Restore the result a dropped-but-committed action lost: show its words and re-voice it (a no-op
	// when audio is off). Sköll's lines belong in his frame; everything else is the Oracle's panel.
	function applyRecoveredLine(line: RecoveredLine) {
		const d = line.voice;
		if (d && (d.kind === 'skoll-ask' || d.kind === 'skoll-cast')) {
			skollEcho = line.text;
			skollAsking = d.kind === 'skoll-ask';
			if (d.kind === 'skoll-cast' && roundOver) {
				endHeld = true;
				skollCastPending = true;
			}
		} else {
			answer = line.text;
		}
		answerAudio = d ? deliver(d) : null;
	}

	// One recovery path for a dropped-but-committed action: resync, and if the reconciled state proves
	// the move landed (`committed()`), restore its real voiced result. Returns whether it recovered, so
	// each caller shows its failure line only when it did not.
	async function recoverFromDrop(committed: () => boolean): Promise<boolean> {
		const { landed, lastLine } = await reconcile();
		if (landed && lastLine && committed()) {
			applyRecoveredLine(lastLine);
			return true;
		}
		return false;
	}

	// Resync to authoritative server state after a dropped action response. A timed-out or failed POST
	// aborts the browser fetch, but the server completed the move under `withSessionLock`, so the
	// engine has moved on — without this the UI strands on a stale turn/board (or a retry that no-ops)
	// until a reload. Fetches the same snapshot the page load builds and re-applies it. Returns whether
	// the resync landed.
	async function reconcile(): Promise<{ landed: boolean; lastLine: RecoveredLine | null }> {
		const prevRoundId = roundId;
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), ACTION_TIMEOUT_MS);
		let snap: StateSnapshot;
		try {
			const res = await fetch('/api/state', { signal: abort.signal });
			if (!res.ok) throw new Error(`State reconcile rejected (${res.status})`);
			snap = (await res.json()) as StateSnapshot;
			// A malformed snapshot (no turn state) can't be trusted to re-key the view — fail the resync
			// rather than apply a partial that would crash applyState or mis-key persistence.
			if (!snap?.state || !snap.roundId)
				throw new Error('State reconcile returned no usable snapshot');
		} catch (err) {
			console.error('[ui] reconcile failed:', err);
			return { landed: false, lastLine: null };
		} finally {
			clearTimeout(timer);
		}
		// A dropped new-game still reset the round server-side — drop the per-round view so crossings,
		// the voiced line, and the outcome can't resume against a new secret. A fresh round also restores
		// both reaction charges.
		if (snap.roundId !== prevRoundId) {
			restoreCrossed = [];
			crossings = [];
			answer = '';
			askValue = '';
			outcomeVoiced = false;
			endFlair = null;
			heldScry = true;
			heldHex = true;
			stopDelivery();
		}
		seedOverride = snap.boardSeed;
		roundIdOverride = snap.roundId;
		applyState(snap.state);
		skollEcho = snap.pendingReaction?.echo ?? '';
		skollAsking = snap.pendingReaction != null;
		// Charge state only rides the snapshot when an Ask is parked. Outside that, /api/state carries no
		// charges, so preserve what the client already knows (a spent Scry/Hex stays spent) — resetting
		// to `true` here would re-advertise a power the engine no longer allows.
		if (snap.pendingReaction) {
			heldScry = snap.pendingReaction.held.Scry;
			heldHex = snap.pendingReaction.held.Hex;
		}
		skollStalled = false;
		cancelCast();
		// A new round (dropped new-game) has voiced nothing — the server returns no line, so callers
		// can't mis-recover a stale result onto a fresh secret.
		return { landed: true, lastLine: snap.roundId === prevRoundId ? snap.lastLine : null };
	}

	// Return type is derived from the action's `type`, so a caller can't request a
	// mismatched result shape.
	async function dispatch<T extends GameAction['type']>(
		action: Extract<GameAction, { type: T }>
	): Promise<ActionResponse<T>> {
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), ACTION_TIMEOUT_MS);
		try {
			const res = await fetch('/api/action', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(action),
				signal: abort.signal
			});
			if (!res.ok) throw new Error(`Action rejected (${res.status})`);
			return (await res.json()) as ActionResponse<T>;
		} finally {
			clearTimeout(timer);
		}
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
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), ACTION_TIMEOUT_MS);
		try {
			const res = await fetch('/api/action', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: 'Advance' }),
				signal: abort.signal
			});
			if (!res.ok) throw new Error(`Advance rejected (${res.status})`);
			const { skoll, state, outcomeFlair } = (await res.json()) as AdvanceResponse;
			// His gloat for the end screen when this Advance was his winning cast (ttd:22).
			if (outcomeFlair) endFlair = outcomeFlair;
			// His winning cast is a turn that must play. Hold the splash synchronously — BEFORE applyState
			// flips roundOver — so his cast frame shows first, even with audio off (which would otherwise
			// reveal the end screen at once). skollCastPending tells the hold effect to pace the beat.
			if (skoll?.casts) {
				endHeld = true;
				skollCastPending = true;
			}
			applyState(state);
			applySkoll(skoll);
			// His Ask is a game move (R10) — written on his frame and voiced in his own voice through the
			// same delivery seam as the Oracle (a no-op when audio is off). The medallion shows
			// 'skoll-speaking' from the delivery event while it plays.
			if (skoll?.asks) void voiceSkoll(skollVoice(skoll.asks.query));
			// His winning cast is voiced in his own voice through the same seam (server recomposes from
			// the rune). The handle holds the end-screen splash until his line is heard (whenDrained),
			// then the outcome verse follows. A Sköll win still leaves the Oracle's last voiced answer in
			// the panel (the WHY of the loss); his cast line shows in HIS box, never doubled into hers.
			else if (skoll?.casts)
				answerAudio = voiceSkoll({ kind: 'skoll-cast', rune: skoll.casts.rune });
			skollStalled = false;
		} catch (err) {
			console.error('[ui] Sköll advance failed:', err);
			// His move may have landed server-side before the response dropped — resync, so a parked Ask
			// surfaces its reaction prompt (or a won round its end screen) instead of a retry that no-ops
			// against the already-advanced turn. Only a turn still genuinely stuck on Sköll keeps the rouse.
			// His winning cast is the one Advance result that voices — recover his cast line so a loss
			// screen never rises silent. (A parked Ask already restores its prompt via reconcile; a wrong
			// cast voices nothing, so it falls through to the stall check.)
			const recovered = await recoverFromDrop(() => roundOver && winner === 'Sköll');
			if (!recovered && !skollAsking && activePlayer === 'Sköll' && roundStatus === 'active') {
				answer = RITE.wolfStalled;
				skollStalled = true;
			}
		} finally {
			clearTimeout(timer);
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
		// The medallion mirrors who delivery is voicing (speaking / idle).
		const unsubscribeDelivery = subscribeDelivery(onDeliveryEvent);
		// A denied mic is sealed at the module level — a remount must adopt it, or the medallion would
		// promise a hold the recorder will refuse.
		if (recorderSealed()) medalState = 'denied';

		// Page-wide push-to-talk: hold the backtick (`) to record, release to ask. Backtick — NOT Space —
		// because Space is the activation key for whatever control has focus (a11y); a global Space hold
		// would have to yield to any focused button, so it silently stopped working after a click.
		// Backtick activates nothing and is never wanted inside a rune question, so it holds the mic
		// regardless of focus — including the Ask field (preventDefault keeps the ` from typing). (Tab to
		// the medallion and its own Space/Enter hold still works.)
		// Once a page-level press starts a hold it OWNS that hold until keyup — even if focus moves to a
		// field or button mid-hold. Keying the keyup off live focus would skip endHold and strand the
		// recorder in 'recording'. Key-repeat must not re-fire the hold.
		let pttHeld = false;
		function onKeyDown(e: KeyboardEvent) {
			if (e.code !== 'Backquote') return;
			// A full-screen modal (onboarding/title or the end screen) makes the board inert — the
			// backtick must not start a hold behind it and dispatch against the live round. An in-flight
			// hold keeps owning itself (pttHeld) so its keyup still ends cleanly.
			if (!pttHeld && (showOnboarding || showEndScreen)) return;
			e.preventDefault();
			if (e.repeat || pttHeld) return;
			pttHeld = true;
			void startHold();
		}
		function onKeyUp(e: KeyboardEvent) {
			if (e.code !== 'Backquote' || !pttHeld) return;
			e.preventDefault();
			pttHeld = false;
			void endHold();
		}
		// Tabbing/clicking away mid-hold must end the recording, or it would hang in 'recording'.
		function onBlur() {
			pttHeld = false;
			void endHold();
		}
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', onBlur);

		// Audio output is ON by default (honoring a session mute the player set), EXCEPT under
		// prefers-reduced-motion — the PRD's reduced tier (R9) keeps audio muted. The player can still
		// opt in via the toggle. The delivery speaker still needs a user gesture to open (browsers block
		// an AudioContext otherwise), so prime it on the first interaction — tap or key — then retire.
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		audioOn = !readMuted() && !reducedMotion;
		let audioPrimed = false;
		function primeAudio() {
			if (audioPrimed) return;
			audioPrimed = true;
			window.removeEventListener('pointerdown', primeAudio);
			window.removeEventListener('keydown', primeAudio);
			if (!audioOn) return;
			try {
				enableDelivery();
				audioReady = true;
				flushPendingVoice(); // a resumed Sköll Ask held before the speaker opened now voices
			} catch (err) {
				console.error('[ui] could not open the delivery speaker:', err);
				audioOn = false;
				audioReady = false;
			}
		}
		window.addEventListener('pointerdown', primeAudio);
		window.addEventListener('keydown', primeAudio);

		return () => {
			window.removeEventListener('resize', onReposition);
			window.removeEventListener('scroll', onReposition, true);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', onBlur);
			window.removeEventListener('pointerdown', primeAudio);
			window.removeEventListener('keydown', primeAudio);
			clearTimeout(aiNoteHideTimer); // don't let a scheduled hide fire after teardown
			unsubscribeDelivery();
			// Close the delivery speaker and release the mic, or a late response could play into a dead
			// page and the AudioContexts would leak past unmount.
			disableDelivery();
			closeRecorder();
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
	): Promise<{ line: string; consumed: boolean; voice: LineDescriptor | null }> {
		try {
			const { oracle, state, skollVsYou } = await dispatch({
				type: 'Ask',
				player: 'Human',
				question
			});
			applyState(state);
			let outcome: { line: string; consumed: boolean; voice: LineDescriptor | null };
			if (skollVsYou?.reaction === 'Hex') {
				// His Hex closed her lips — the rite names it (replacing the answer), voiced as the §3 line.
				outcome = {
					line: RITE.skollHexes,
					consumed: true,
					voice: { kind: 'react', line: 'skoll-hex' }
				};
			} else if (skollVsYou?.reaction === 'Scry' && oracle?.ok) {
				// The Oracle still speaks your answer (he overheard it), then notes his Scry — one voiced line.
				outcome = {
					line: `${oracle.answer} ${RITE.skollScried}`,
					consumed: true,
					voice: {
						kind: 'react',
						line: 'skoll-scry',
						query: oracle.query,
						affirmative: oracle.affirmative
					}
				};
			} else if (oracle && 'refusal' in oracle) {
				// Refusal wins before the answer branch: a refused sign is never voiced as a verdict.
				outcome = { line: oracle.line, consumed: false, voice: oracleVoice(oracle) };
			} else if (oracle?.ok) {
				// Her dramatized, server-signed line when the server authored one (ttd:17); else the
				// deterministic answer. The panel shows exactly what she voices (R10).
				outcome = oracle.voiced
					? { line: oracle.voiced.text, consumed: true, voice: oracle.voiced }
					: { line: oracle.answer, consumed: true, voice: oracleVoice(oracle) };
			} else if (oracle) {
				// not-your-turn means the engine has handed the turn to Sköll. System line — not voiced.
				outcome = {
					line: oracle.engineReason === 'not-your-turn' ? RITE.wolfMoving : RITE.oracleSilent,
					consumed: false,
					voice: null
				};
			} else {
				// no oracle and not a Hex — unexpected; fail to a safe line
				outcome = { line: RITE.oracleSilent, consumed: false, voice: null };
			}
			answer = outcome.line;
			return outcome;
		} catch (err) {
			// A real 500 here means something the server-side degradation did NOT catch — keep
			// a trace so it's distinguishable from an expected in-world refusal.
			console.error('[ui] Ask dispatch failed:', err);
			// The Ask may have landed and handed the turn to Sköll (or resolved the round) — resync and, if
			// it committed, restore her real answer instead of the false silent line.
			if (await recoverFromDrop(() => activePlayer === 'Sköll' || roundOver))
				return { line: answer, consumed: true, voice: null };
			answer = RITE.oracleSilent;
			return { line: RITE.oracleSilent, consumed: false, voice: null };
		}
	}

	// One Ask path for the typed field and the spoken (push-to-talk) route. `fromTyped` clears the
	// input box on a consumed turn; the spoken route never touches the box — its words went to the
	// engine, and the box is for typing (the heard text is teed to /debug instead).
	async function runAsk(question: string, fromTyped: boolean) {
		pending = true;
		try {
			const outcome = await performAsk(question);
			if (fromTyped && outcome.consumed) askValue = '';
			// Voice her own line through the delivery seam (server TTS); a no-op when audio is off (no
			// speaker). The handle lets a round that ends on Sköll's next move hold the splash until
			// she's heard.
			answerAudio = outcome.voice ? deliver(outcome.voice) : null;
			await advanceSkoll();
		} finally {
			pending = false;
		}
	}

	async function submitAsk() {
		const question = askValue.trim();
		if (question === '') {
			// An empty Ask never consumes a turn — gated client-side, no dispatch.
			answer = RITE.emptyAsk;
			return;
		}
		await runAsk(question, true);
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
			let voice: LineDescriptor;
			if (skollReaction?.hexed) {
				line = RITE.hexHim;
				voice = { kind: 'react', line: 'human-hex' };
				heldHex = false;
			} else if (skollReaction?.scried) {
				// §3: the Scry framing leads, then the answer he was owed — now yours too.
				line = `${RITE.scryHim} ${skollReaction.scried.answer}`;
				voice = {
					kind: 'react',
					line: 'human-scry',
					query: skollReaction.scried.query,
					affirmative: skollReaction.scried.affirmative
				};
				heldScry = false;
			} else {
				line = RITE.passHim; // a Pass, or a reaction that didn't land
				voice = { kind: 'react', line: 'human-pass' };
			}
			answer = line;
			// Voice the resolution in the Oracle's voice (her panel) — a no-op when audio is off.
			void deliver(voice);
			return line;
		} catch (err) {
			console.error('[ui] React dispatch failed:', err);
			// The reaction may have resolved server-side (charge spent, turn advanced) — resync so the
			// held charges and turn match engine truth instead of stranding the prompt.
			// A committed React closes Sköll's parked Ask (skollAsking clears) — recover its real
			// resolution line instead of the false silent line.
			if (await recoverFromDrop(() => !skollAsking)) return answer;
			answer = RITE.oracleSilent;
			return RITE.oracleSilent;
		}
	}

	async function submitReact(choice: ReactionChoice) {
		// A clicked reaction must lose to an in-flight move (e.g. a voiced ask's implicit auto-pass)
		// rather than fire a second React behind it — the prompt is disabled, this is the backstop.
		if (pending) return;
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
		castArm++; // a new arm invalidates any in-flight spoken cast from a prior arm
	}

	function cancelCast() {
		castMode = false;
		selectedTargetId = null;
		castArm++; // canceling invalidates an in-flight spoken cast so it can't land after the backout
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
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), ACTION_TIMEOUT_MS);
		try {
			res = await fetch('/api/new-game', { method: 'POST', signal: abort.signal });
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
			outcomeVoiced = false; // the fresh round re-arms the end-screen outcome voice
			endFlair = null;
			// Drop any still-playing/queued Oracle line from the round just ended — TTS delivery is
			// fire-and-forget, so without this a prior answer could bleed over the fresh blank round.
			stopDelivery();
			applyState(state);
			cancelCast();
			return true;
		} catch (err) {
			console.error(`[ui] New game failed (status ${res?.status ?? 'network'}):`, err);
			// resetEngine() may have minted the fresh round before the response dropped — resync so the
			// board matches the new secret. The reset took ONLY if the resync lands on a NEW round: a
			// same-round resync (the POST failed before resetting) left the board/secret unchanged, so
			// report the failure rather than suppressing it behind a still-active round.
			const prevRoundId = roundId;
			const { landed: synced } = await reconcile();
			const reset = synced && roundId !== prevRoundId;
			if (!reset) answer = RITE.oracleSilent;
			return reset;
		} finally {
			clearTimeout(timer);
			pending = false;
		}
	}

	// Never throws — see performAsk.
	async function performCast(runeName: string): Promise<string> {
		try {
			const { cast, state, outcomeFlair } = await dispatch({
				type: 'Cast',
				player: 'Human',
				runeName
			});
			applyState(state);
			// Her blessing for the end screen when this cast won (ttd:22); the effect voices it on the splash.
			if (outcomeFlair) endFlair = outcomeFlair;
			let line: string;
			let voice: LineDescriptor;
			if (cast.ok) {
				line = cast.won ? RITE.runeTrue : RITE.wrongCast(runeName);
				voice = cast.won
					? { kind: 'cast', result: 'true' }
					: { kind: 'cast', result: 'wrong', rune: runeName };
			} else {
				console.warn('[ui] Cast rejected by engine:', cast.reason);
				line = RITE.castFalters;
				voice = { kind: 'cast', result: 'falters' };
			}
			answer = line;
			// Voice the cast outcome in her voice; keep the handle so a winning cast's end-screen splash
			// waits for "The rune is true." to be heard (whenDrained). A no-op when audio is off.
			answerAudio = deliver(voice);
			return line;
		} catch (err) {
			console.error('[ui] Cast dispatch failed:', err);
			// The cast may have committed server-side (it's irreversible) — resync so a win's end screen
			// and the advanced turn show instead of the controls re-enabling against a decided round.
			// A committed cast resolved the round (win) or handed the turn to Sköll (wrong) — recover its
			// real outcome instead of the false falters line.
			if (await recoverFromDrop(() => roundOver || activePlayer === 'Sköll')) return answer;
			answer = RITE.castFalters;
			return RITE.castFalters;
		} finally {
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
</script>

<svelte:head>
	<!-- Assets the preload scanner can't see (mounted after hydration, or hidden behind a CSS var), so
	     fetch them with the document instead of after it. The intro splash is the onboarding LCP — only
	     warm it when onboarding will actually show (a returning player never sees it, so never fetches
	     it). The divider paints on every load. -->
	{#if showOnboarding}
		<link rel="preload" as="image" type="image/webp" href={introSplash} />
	{/if}
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
				<!-- The Oracle's two controls: the medallion (hold to speak — pointer, Space/Enter when
				     focused, or the ` key from anywhere) and the output-mute switch. Both are native
				     buttons; Tab reaches each. -->
				<div
					class="voice-controls"
					role="group"
					aria-label="Oracle voice controls"
					data-coach="voice"
				>
					<EclipseMedallion
						state={medalState}
						getLevel={currentLevel}
						onHoldStart={startHold}
						onHoldEnd={endHold}
					/>
					<button
						class="voice-switch"
						type="button"
						role="switch"
						data-testid="mute-toggle"
						aria-checked={audioOn}
						aria-label={audioOn ? RITE.muteVoices : RITE.unmuteVoices}
						onclick={toggleAudio}
					>
						<span class="voice-switch__thumb">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M4 9v6h4l5 4V5L8 9H4z" />
								<path class="wave wave--near" d="M16 9a3.5 3.5 0 0 1 0 6" />
								<path class="wave wave--far" d="M18.5 6.5a7 7 0 0 1 0 11" />
								<line class="mute-strike" x1="3.5" y1="4" x2="20.5" y2="20" />
							</svg>
						</span>
					</button>
				</div>
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
						class:opponent={activePlayer === 'Sköll' && !roundOver}
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
				<ReactionPrompt
					held={{ Scry: heldScry, Hex: heldHex }}
					onReact={submitReact}
					busy={pending}
				/>
			{:else}
				<div class="reactions" data-coach="reactions">
					<button
						class="btn btn--secondary reaction-btn"
						type="button"
						title={RITE.hintScry}
						aria-describedby="scry-hint"
						disabled
					>
						Scry
					</button>
					<button
						class="btn btn--secondary reaction-btn"
						type="button"
						title={RITE.hintHex}
						aria-describedby="hex-hint"
						disabled
					>
						Hex
					</button>
					<!-- Pass keeps its slot here so it doesn't vanish when the window closes. -->
					<button
						class="btn btn--secondary reaction-btn"
						type="button"
						title={RITE.hintPass}
						aria-describedby="pass-hint"
						disabled
					>
						Pass
					</button>
					<!-- Disabled buttons aren't focusable; mirror the title into described-by for AT. -->
					<span id="scry-hint" class="sr-only">{RITE.hintScry}</span>
					<span id="hex-hint" class="sr-only">{RITE.hintHex}</span>
					<span id="pass-hint" class="sr-only">{RITE.hintPass}</span>
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
					title={askHint}
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

			<!-- Decorative: the wolf banner rises behind the controls; its own sky and moon show
			     through. (The old separate moon-ghost layer is gone — it double-imaged the moon.) -->
			<div class="skoll-art" aria-hidden="true">
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
		grid-template-columns: 1fr auto;
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
		/* Dark offset for legibility over the moon art; tight gold glow for the gilt edge. */
		text-shadow:
			0 1px 1px rgba(6, 9, 18, 0.85),
			0 0 8px rgba(217, 169, 74, 0.45);
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

	/* Sköll's live turn wears his cold steel accent — reads at a glance as "not yours" without
	   stealing the terminal win/lost styling, which only paints once the round is over. */
	.turn-pill.opponent {
		color: var(--steel);
		background: var(--steel-glow);
		border-color: var(--steel-line);
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
	}

	.board-section {
		display: flex;
		flex-direction: column;
		/* Top-align so the first rune row meets the oracle panel's top edge. Centering left the
		   board floating in its column's slack — a phantom top margin the sidebar never had. */
		justify-content: flex-start;
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
		/* Pinned to the panel floor and stacked BEHIND the controls (z-index 2). The image rises
		   up behind the buttons — sky and moon ghost through the gaps — while the wolf, anchored to
		   the image bottom, stays fully clear below them. Bleeds the panel padding on both sides. */
		position: absolute;
		left: -1.1rem;
		right: -1.1rem;
		bottom: 0;
		z-index: 0;
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

	/* The medallion stays centered; the mute toggle rides the top-right corner so adding it never
	   shifts the disc. */
	.voice-controls {
		position: relative;
	}

	/* A pill switch: a track with a sliding thumb. The state is the signal — the thumb's position
	   (left/right) and the track tint both flip on click; hover is only a quiet affordance. */
	.voice-switch {
		position: absolute;
		top: 0;
		right: 0.25rem;
		inline-size: 3.1rem;
		block-size: 1.7rem;
		padding: 0;
		/* Restrained: a dark track in both states with a soft gold-dim ring; the thumb is the only
		   gold, and aged (--gold), never the bright accent — so it sits in the muted palette. */
		border: 1px solid var(--gold-dim);
		border-radius: 999px;
		background: rgba(6, 9, 18, 0.6);
		cursor: pointer;
		transition:
			background 0.2s ease,
			border-color 0.2s ease;
	}

	/* ON: only a whisper of warmth in the track — the thumb's position and gold carry the state. */
	.voice-switch[aria-checked='true'] {
		background: var(--gold-faint);
	}

	.voice-switch:hover {
		border-color: var(--gold);
	}

	.voice-switch__thumb {
		position: absolute;
		inset-block-start: 50%;
		inset-inline-start: 0.16rem;
		display: grid;
		place-items: center;
		inline-size: 1.3rem;
		block-size: 1.3rem;
		border-radius: 50%;
		/* An outlined ring, never a filled disc: a thin gold-dim hoop with the speaker glyph inside.
		   OFF dims and strikes it; ON lights the ring and glyph to aged gold. */
		background: transparent;
		border: 1px solid var(--gold-dim);
		color: var(--ink-muted);
		transform: translateY(-50%);
		transition:
			inset-inline-start 0.2s ease,
			border-color 0.2s ease,
			color 0.2s ease;
	}

	.voice-switch[aria-checked='true'] .voice-switch__thumb {
		inset-inline-start: calc(100% - 1.3rem - 0.16rem);
		border-color: var(--gold);
		color: var(--gold);
	}

	.voice-switch__thumb svg {
		width: 0.95rem;
		height: 0.95rem;
		fill: currentColor;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
	}

	.voice-switch .wave {
		fill: none;
	}

	/* OFF: hide the sound waves and strike the speaker — the shape half of the on/off signal. */
	.voice-switch .mute-strike {
		display: none;
	}

	.voice-switch[aria-checked='false'] .wave {
		display: none;
	}

	.voice-switch[aria-checked='false'] .mute-strike {
		display: inline;
	}

	.voice-switch:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 3px;
	}

	@media (prefers-reduced-motion: reduce) {
		.voice-switch,
		.voice-switch__thumb {
			transition: none;
		}
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

	/* A shut field must read as shut, not merely refuse the cursor: dimmed, dashed, muted. */
	.ask input:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		border-style: dashed;
		border-color: rgba(233, 200, 119, 0.25);
		background: rgba(9, 13, 26, 0.55);
	}

	.ask input:disabled::placeholder {
		color: var(--steel);
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
		/* Tall enough that the wolf sits at the panel floor while the sky/moon above it rises far up
		   behind the controls — as much of the picture as possible shows, the wolf never clipped. */
		height: 40rem;
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
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'title'
				'controls';
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
