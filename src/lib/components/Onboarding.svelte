<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import introSplash from '$lib/assets-webp/banners/intro-splash.webp?url&no-inline';

	// Title screen + first-run coach-mark tour: the tour spotlights the live board region each step
	// describes, so the how-to lives in the steps rather than as persistent on-board text. `onDone`
	// fires on every exit; `start` lets the page reopen straight into the tour.
	let { onDone, start = 'title' }: { onDone: () => void; start?: 'title' | 'tour' } = $props();

	// `target` is the page's data-coach hook the spotlight anchors to; a missing one falls back to a
	// centered popover.
	const STEPS = [
		{
			// Scene-setting, not a pointer — no anchor, so it opens as a centered intro and the board
			// stays unhighlighted until "The Board."
			label: 'The Goal',
			target: null,
			body: 'One rune on the board is Sól’s — her true rune. Cast it before Sköll does: name it first and the sun is saved; if he names it first, the night is his.'
		},
		{
			label: 'The Board',
			target: '[data-coach="board"]',
			body: 'Twenty-four runes, no two alike. Each has an element, a power from 1 to 6, a color, and a light or dark cast — those traits are how you’ll tell Sól’s from the rest.'
		},
		{
			label: 'Ask',
			target: '[data-coach="ask"]',
			body: 'Ask the Oracle one yes/no question about a trait — an element, a power, a color, light or dark, or a rune by name. Her answer is always true. Cross off whatever it rules out; the board leaves that to you.'
		},
		{
			label: 'Scry & Hex',
			target: '[data-coach="reactions"]',
			body: 'Sköll hunts the same rune, and he questions the Oracle too. You hold one Scry and one Hex for the whole game — Scry to overhear her reply to him, or Hex to cut his question short.'
		},
		{
			label: 'Cast',
			target: '[data-coach="cast"]',
			body: 'When the board’s down to one, cast it — tap Cast, then the rune. Get it right and the day is yours; get it wrong and your turn’s gone, so be certain before you name it.'
		},
		{
			label: 'Speak',
			target: '[data-coach="voice"]',
			body: 'Rather not type? Hold the medallion (or press the backtick key), speak, then let go. Your voice does all of it — ask, Scry, Hex, and cast.'
		}
	];

	const PAD = 8; // spotlight breathing room around the target
	const POP_W = 340; // popover width; positioning clamps it to the viewport
	const POP_FALLBACK_H = 240; // first paint fallback; the rendered popover height replaces it

	// `start` is read once at mount — the component remounts each time the page opens it.
	let phase = $state<'title' | 'tour'>(untrack(() => start));
	let step = $state(0);
	let rect = $state<DOMRect | null>(null);
	let popoverEl = $state<HTMLElement | null>(null);
	let popoverSize = $state({ width: POP_W, height: POP_FALLBACK_H });
	let isLast = $derived(step === STEPS.length - 1);

	function targetElement() {
		const target = phase === 'tour' ? STEPS[step].target : null;
		return target ? document.querySelector<HTMLElement>(target) : null;
	}

	function measure() {
		const el = targetElement();
		if (!el) {
			rect = null; // no anchor -> centered popover over the dimmed page (the intro step)
			return;
		}
		rect = el.getBoundingClientRect();
	}

	function measurePopover() {
		if (!popoverEl) return;
		const box = popoverEl.getBoundingClientRect();
		popoverSize = {
			width: Math.ceil(box.width) || POP_W,
			height: Math.ceil(box.height) || POP_FALLBACK_H
		};
	}

	// Re-measure on every step/phase change — measure() reads both, so the effect tracks them.
	// Measure twice: now, and again after the next frame. The title→tour swap can run this effect a
	// tick before the board has settled its layout, leaving the FIRST step's spotlight on an empty
	// rect (the whole screen dims) with nothing to correct it until the next step. The rAF pass
	// self-corrects that opening step.
	$effect(() => {
		targetElement()?.scrollIntoView({ block: 'center', inline: 'nearest' });
		measure();
		measurePopover();
		const raf = requestAnimationFrame(() => {
			measure();
			measurePopover();
		});
		return () => cancelAnimationFrame(raf);
	});

	onMount(() => {
		const bodyOverflow = document.body.style.overflow;
		const rootOverflow = document.documentElement.style.overflow;
		document.body.style.overflow = 'hidden';
		document.documentElement.style.overflow = 'hidden';
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			document.body.style.overflow = bodyOverflow;
			document.documentElement.style.overflow = rootOverflow;
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
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
		const width = Math.min(POP_W, window.innerWidth - margin * 2);
		const height = Math.min(popoverSize.height, window.innerHeight - margin * 2);
		const belowSpace = window.innerHeight - rect.bottom - PAD - margin;
		const aboveSpace = rect.top - PAD - margin;
		const placeBelow = belowSpace >= height || belowSpace >= aboveSpace;
		const targetTop = placeBelow ? rect.bottom + PAD + margin : rect.top - PAD - margin - height;
		const top = Math.max(margin, Math.min(targetTop, window.innerHeight - height - margin));
		const left = Math.max(
			margin,
			Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - margin)
		);
		return `top:${top}px;left:${left}px;width:${width}px;max-height:${window.innerHeight - margin * 2}px;`;
	});

	function beginTour() {
		phase = 'tour';
		step = 0;
	}

	function next() {
		if (isLast) onDone();
		else step += 1;
	}

	// Focus trap for the aria-modal dialogs: move focus in on open and keep Tab cycling inside, so the
	// tour can't tab out to the board or the header "How the rite works" button while it's meant to be
	// inert. Escape exits via onDone. Re-runs per dialog — title → tour swaps the node, so focus
	// re-enters the new one.
	function trapFocus(node: HTMLElement) {
		const focusable = () =>
			Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled])'));
		focusable()[0]?.focus();

		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				onDone();
				return;
			}
			if (e.key !== 'Tab') return;
			const els = focusable();
			if (els.length === 0) return;
			const first = els[0];
			const last = els[els.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}

		node.addEventListener('keydown', onKeydown);
		return { destroy: () => node.removeEventListener('keydown', onKeydown) };
	}
</script>

{#if phase === 'title'}
	<div class="backdrop title-backdrop" data-testid="onboarding">
		<!-- The first-run LCP, mounted only after hydration — preloaded from +page's head;
		     high priority so a still-in-flight fetch jumps the board's card images. -->
		<img
			class="title-splash"
			src={introSplash}
			width="1440"
			height="900"
			alt=""
			aria-hidden="true"
			decoding="async"
			fetchpriority="high"
		/>
		<div
			class="title-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby="onboarding-heading"
			use:trapFocus
		>
			<div class="title-top">
				<h1 id="onboarding-heading">Save the Sun</h1>
				<hr class="title-divider" aria-hidden="true" />
				<p class="tagline">A rite for the longest day.</p>
			</div>
			<div class="title-actions">
				<button class="btn btn--primary" type="button" onclick={() => onDone()}>
					Light the fire.
				</button>
				<button class="btn btn--secondary" type="button" onclick={beginTour}>
					How the rite works
				</button>
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
		bind:this={popoverEl}
		use:trapFocus
	>
		<h2 id="onboarding-heading">{STEPS[step].label}</h2>
		<hr class="step-divider" aria-hidden="true" />
		<p class="step-body" data-testid="step-body">{STEPS[step].body}</p>
		<div class="actions">
			{#if !isLast}
				<button class="btn btn--secondary" type="button" onclick={() => onDone()}> Skip </button>
			{/if}
			<button class="btn btn--primary" type="button" onclick={next}>
				{isLast ? 'Find her rune.' : 'Next'}
			</button>
		</div>
		<p class="step-count" data-testid="step-count">{step + 1} / {STEPS.length}</p>
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

	/* The first-run title is its own cinematic splash — the intro art fills the screen behind a
	   centered scrim so the wordmark + CTAs always read over the busy scene. */
	.title-backdrop {
		padding: 0;
		background: var(--bg-deep);
		backdrop-filter: none;
		overflow: hidden;
	}

	.title-splash {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: 50% 40%;
	}

	/* Centered over the art; a local halo keeps the wordmark + CTAs legible over the bright glow — no scrim. */
	.title-card {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.1rem;
		max-width: 42rem;
		padding: 2.2rem 2.8rem;
		border-radius: 18px;
		text-align: center;
		background: radial-gradient(
			ellipse 92% 124% at 50% 50%,
			rgba(6, 9, 18, 0.66) 0%,
			rgba(6, 9, 18, 0.28) 58%,
			transparent 82%
		);
	}

	.title-top {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
	}

	.title-divider {
		width: min(22rem, 70%);
		height: 1.6rem;
		margin: 0.1rem 0;
		border: 0;
		background: var(--ui-divider) center / 100% 100% no-repeat;
		opacity: 0.9;
	}

	.title-actions {
		display: flex;
		gap: 0.9rem;
		flex-wrap: wrap;
		justify-content: center;
		margin-top: 0.8rem;
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

	.popover {
		position: fixed;
		z-index: 102;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 1.6rem 1.8rem;
		overflow-y: auto;
		text-align: center;
		/* Moon pinned to top: image strip at 45% container height, gradient fades to solid at 40%. */
		background:
			linear-gradient(180deg, rgba(4, 8, 16, 0.38) 0%, rgba(6, 9, 18, 0.97) 40%),
			var(--modal-bg) top center / auto 45% no-repeat;
		border: 14px solid transparent;
		border-image-source: var(--button-border);
		border-image-slice: 44 56;
		border-image-width: 14px 18px;
		border-image-repeat: stretch;
		box-shadow: 0 0 40px rgba(0, 0, 0, 0.5);
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
		font-family: var(--font-story-title);
		font-size: clamp(2.8rem, 7vw, 4.6rem);
		font-weight: 400;
		letter-spacing: 0.03em;
		line-height: 1.05;
		color: var(--gold-bright);
		text-shadow:
			0 2px 6px rgba(0, 0, 0, 0.7),
			0 0 34px rgba(217, 169, 74, 0.5);
	}

	h2 {
		margin: 0;
		font-family: var(--font-story-title);
		font-size: 1.3rem;
		letter-spacing: 0.06em;
		color: var(--gold-bright);
	}

	.tagline {
		margin: 0;
		font-family: var(--font-story-body);
		font-style: italic;
		font-size: clamp(1.05rem, 2.2vw, 1.3rem);
		color: var(--ink);
		text-shadow: 0 1px 8px rgba(0, 0, 0, 0.85);
	}

	/* Ornate rule under the step title, matching the title card's divider — snug to the heading. */
	.step-divider {
		width: min(15rem, 80%);
		height: 1.05rem;
		margin: -0.35rem auto -0.15rem;
		border: 0;
		background: var(--ui-divider) center / 100% 100% no-repeat;
		opacity: 0.85;
	}

	/* Step counter sits at the foot of the popover now, a quiet footer under the controls. */
	.step-count {
		margin: 0.1rem 0 0;
		font-family: var(--font-display);
		font-size: 0.72rem;
		letter-spacing: 0.2em;
		color: var(--ink-faint);
	}

	.step-body {
		margin: 0;
		font-family: var(--font-story-body);
		font-size: 1.08rem;
		line-height: 1.6;
		color: var(--ink);
	}

	.actions {
		display: flex;
		gap: 0.7rem;
		justify-content: center;
		margin-top: 0.4rem;
	}

	/* The title splash scales its two buttons up for the opening beat; the tour nav keeps them compact —
	   both container concerns, not new button classes. Focus styling is the shared `.btn` rule (theme.css). */
	.title-actions .btn {
		min-width: 12rem;
		padding: 0.85rem 1.5rem;
		font-size: 0.9rem;
	}

	.actions .btn {
		min-height: 3rem;
		padding: 0.72rem 1.05rem;
	}
</style>
