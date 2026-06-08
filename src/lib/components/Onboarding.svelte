<script lang="ts">
	import { onMount, untrack } from 'svelte';

	// Title screen + first-run coach-mark tour (ux-copy.md §5). The title is a centered card; the tour
	// spotlights the live board region each step describes (the runes, the Ask, the Cast) with a
	// popover anchored beside it. The how-to lives here in the steps, never as persistent on-board
	// text. `onDone` fires on every exit — Light the fire, Skip, or Take up the runes. `start` lets the
	// page reopen straight into the tour from a persistent "How the rite works" button.
	let { onDone, start = 'title' }: { onDone: () => void; start?: 'title' | 'tour' } = $props();

	// One concept per step (ux-copy.md §5 steps 1–4). `target` is the page's data-coach hook the
	// spotlight anchors to; a missing target falls back to a centered popover (still readable).
	const STEPS = [
		{
			// Scene-setting, not a pointer — no anchor, so it opens as a centered intro and the board
			// stays unhighlighted until "Read & cross."
			label: 'The stakes',
			target: null,
			body: 'Tonight the coven makes one offering to Sól. Name her true rune before Sköll does, and the longest day breaks. Fail, and the wolf swallows the dawn.'
		},
		{
			label: 'Ask',
			target: '[data-coach="ask"]',
			body: 'Ask the Oracle yes/no questions about the runes — their element, power, light, hue, or one rune by name. She answers the sign she reads. One question a turn.'
		},
		{
			label: 'Read & cross',
			target: '[data-coach="board"]',
			body: 'Twenty-four runes stand in the open. Cross off what each answer rules out. The crossing is yours — the board never does it for you. That reading is the whole game.'
		},
		{
			label: 'Cast',
			target: '[data-coach="cast"]',
			body: "When you're sure, cast a rune. Cast true and dawn is yours. Cast wrong and the turn is gone. Sköll is racing you for the same rune."
		}
	];

	const PAD = 8; // spotlight breathing room around the target
	const POP_W = 340; // popover width; positioning clamps it to the viewport
	const POP_EST_H = 220; // height estimate for above/below placement only

	// `start` is read once at mount — the component remounts each time the page opens it.
	let phase = $state<'title' | 'tour'>(untrack(() => start));
	let step = $state(0);
	let rect = $state<DOMRect | null>(null);
	let isLast = $derived(step === STEPS.length - 1);

	function measure() {
		const target = phase === 'tour' ? STEPS[step].target : null;
		if (!target) {
			rect = null; // no anchor → centered popover over the dimmed page (the intro step)
			return;
		}
		const el = document.querySelector(target);
		rect = el ? el.getBoundingClientRect() : null;
	}

	// Re-measure on every step/phase change — measure() reads both, so the effect tracks them.
	// Measure twice: now, and again after the next frame. The title→tour swap can run this effect a
	// tick before the board has settled its layout, leaving the FIRST step's spotlight on an empty
	// rect (the whole screen dims) with nothing to correct it until the next step. The rAF pass
	// self-corrects that opening step.
	$effect(() => {
		measure();
		const raf = requestAnimationFrame(measure);
		return () => cancelAnimationFrame(raf);
	});

	onMount(() => {
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});

	let spotlightStyle = $derived(
		rect
			? `top:${rect.top - PAD}px;left:${rect.left - PAD}px;width:${rect.width + PAD * 2}px;height:${rect.height + PAD * 2}px;`
			: ''
	);

	// Place the popover below the target when there's room, else above; clamp horizontally so it
	// never spills off-screen. Centered fallback handled by the `.centered` class when there's no rect.
	let popoverStyle = $derived.by(() => {
		if (!rect) return '';
		const margin = 16;
		const below = window.innerHeight - rect.bottom > POP_EST_H + margin;
		const top = below
			? rect.bottom + PAD + margin
			: Math.max(margin, rect.top - PAD - margin - POP_EST_H);
		const left = Math.max(
			margin,
			Math.min(rect.left + rect.width / 2 - POP_W / 2, window.innerWidth - POP_W - margin)
		);
		return `top:${top}px;left:${left}px;width:${POP_W}px;`;
	});

	function beginTour() {
		phase = 'tour';
		step = 0;
	}

	function next() {
		if (isLast) onDone();
		else step += 1;
	}
</script>

{#if phase === 'title'}
	<div class="backdrop" data-testid="onboarding">
		<div class="panel" role="dialog" aria-modal="true" aria-labelledby="onboarding-heading">
			<h1 id="onboarding-heading">Save the Sun</h1>
			<p class="tagline">A race to beat Sköll and save the light.</p>
			<div class="actions">
				<button class="primary" type="button" onclick={() => onDone()}>Light the fire.</button>
				<button class="ghost" type="button" onclick={beginTour}>How the rite works</button>
			</div>
		</div>
	</div>
{:else}
	<!-- Transparent click-catcher: the board stays visible (dimmed by the spotlight) but inert during
	     the tour, so the only way forward is the popover. -->
	<div class="catcher" class:dim={!rect} data-testid="onboarding"></div>
	{#if rect}
		<div class="spotlight" style={spotlightStyle}></div>
	{/if}
	<div
		class="popover"
		class:centered={!rect}
		style={popoverStyle}
		role="dialog"
		aria-modal="true"
		aria-labelledby="onboarding-heading"
	>
		<p class="step-count" data-testid="step-count">{step + 1} / {STEPS.length}</p>
		<h2 id="onboarding-heading">{STEPS[step].label}</h2>
		<p class="step-body" data-testid="step-body">{STEPS[step].body}</p>
		<div class="actions">
			<button class="ghost" type="button" onclick={() => onDone()}>Skip</button>
			<button class="primary" type="button" onclick={next}>
				{isLast ? 'Take up the runes.' : 'Next'}
			</button>
		</div>
	</div>
{/if}

<style>
	/* Title: dimmed, not opaque — the live board stays visible behind the rite's first words. */
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		background: rgba(6, 9, 18, 0.78);
		backdrop-filter: blur(2px);
	}

	.catcher {
		position: fixed;
		inset: 0;
		z-index: 100;
	}

	/* No anchor target (fallback) — dim the whole field so the centered popover still reads as modal. */
	.catcher.dim {
		background: rgba(6, 9, 18, 0.78);
	}

	/* The lit region: a gold ring whose huge box-shadow dims everything outside it. */
	.spotlight {
		position: fixed;
		z-index: 101;
		border-radius: 8px;
		border: 2px solid var(--gold-bright);
		box-shadow: 0 0 0 9999px rgba(6, 9, 18, 0.8);
		pointer-events: none;
		transition:
			top 0.25s ease,
			left 0.25s ease,
			width 0.25s ease,
			height 0.25s ease;
	}

	.panel,
	.popover {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1.6rem 1.8rem;
		text-align: center;
		background:
			radial-gradient(circle at 50% 0%, rgba(217, 169, 74, 0.08) 0%, transparent 50%),
			linear-gradient(180deg, var(--bg-panel) 0%, var(--bg-deep) 100%);
		border: 1px solid var(--gold-dim);
		border-radius: 12px;
		box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
	}

	.panel {
		max-width: 32rem;
		padding: 2rem 2.2rem;
	}

	.popover {
		position: fixed;
		z-index: 102;
	}

	/* No anchor target — center the popover in the viewport. */
	.popover.centered {
		top: 50%;
		left: 50%;
		width: min(32rem, calc(100vw - 4rem));
		transform: translate(-50%, -50%);
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 2.2rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--gold-bright);
		text-shadow: 0 0 18px rgba(217, 169, 74, 0.3);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 1.3rem;
		letter-spacing: 0.06em;
		color: var(--gold-bright);
	}

	.tagline {
		margin: 0;
		font-family: var(--font-display);
		font-style: italic;
		color: var(--ink-muted);
	}

	.step-count {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.72rem;
		letter-spacing: 0.2em;
		color: var(--ink-faint);
	}

	.step-body {
		margin: 0;
		font-family: var(--font-display);
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--ink);
	}

	.actions {
		display: flex;
		gap: 0.7rem;
		justify-content: center;
		margin-top: 0.4rem;
	}

	button.primary,
	button.ghost {
		padding: 0.6rem 1rem;
		font-family: var(--font-display);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		font-size: 0.8rem;
		border-radius: 5px;
		cursor: pointer;
	}

	button.primary {
		color: var(--bg-deep);
		background: linear-gradient(180deg, var(--gold-bright), var(--gold));
		border: 1px solid var(--gold-bright);
		transition: filter 0.2s ease;
	}

	button.primary:hover {
		filter: brightness(1.08);
	}

	button.ghost {
		color: var(--ink-muted);
		background: transparent;
		border: 1px solid var(--gold-dim);
	}

	button:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 2px;
	}
</style>
