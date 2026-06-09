<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import introSplash from '$lib/assets/banners/intro-splash.jpg';

	// Title screen + first-run coach-mark tour: the tour spotlights the live board region each step
	// describes, so the how-to lives in the steps rather than as persistent on-board text. `onDone`
	// fires on every exit; `start` lets the page reopen straight into the tour.
	let { onDone, start = 'title' }: { onDone: () => void; start?: 'title' | 'tour' } = $props();

	// `target` is the page's data-coach hook the spotlight anchors to; a missing one falls back to a
	// centered popover.
	const STEPS = [
		{
			// Scene-setting, not a pointer — no anchor, so it opens as a centered intro and the board
			// stays unhighlighted until "Read & cross."
			label: 'The stakes',
			target: null,
			body: 'Sól has one hidden rune. Name it before Sköll does, or the wolf takes the dawn.'
		},
		{
			label: 'Ask',
			target: '[data-coach="ask"]',
			body: 'Ask yes/no questions about element, power, light, hue, or a rune by name. One question a turn.'
		},
		{
			label: 'Read & cross',
			target: '[data-coach="board"]',
			body: 'Use each answer to cross off runes yourself. The board will not mark them for you.'
		},
		{
			label: 'Scry & Hex',
			target: '[data-coach="reactions"]',
			body: 'When Sköll asks, spend Scry to hear the answer or Hex to silence the question. Each works once per night.'
		},
		{
			label: 'Cast',
			target: '[data-coach="cast"]',
			body: "When you're sure, cast. The right rune wins the dawn; the wrong rune spends your turn."
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
		<img class="title-splash" src={introSplash} alt="" aria-hidden="true" decoding="async" />
		<div class="title-scrim" aria-hidden="true"></div>
		<div
			class="title-card"
			role="dialog"
			aria-modal="true"
			aria-labelledby="onboarding-heading"
			use:trapFocus
		>
			<h1 id="onboarding-heading">Save the Sun</h1>
			<hr class="title-divider" aria-hidden="true" />
			<p class="tagline">A race to beat Sköll and save the light.</p>
			<div class="title-actions">
				<button class="rite-cta rite-cta--primary" type="button" onclick={() => onDone()}>
					Light the fire.
				</button>
				<button class="rite-cta rite-cta--ghost" type="button" onclick={beginTour}>
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
		<p class="step-count" data-testid="step-count">{step + 1} / {STEPS.length}</p>
		<h2 id="onboarding-heading">{STEPS[step].label}</h2>
		<p class="step-body" data-testid="step-body">{STEPS[step].body}</p>
		<div class="actions">
			<button
				class="ghost ritual-button ritual-button--ghost"
				type="button"
				onclick={() => onDone()}
			>
				Skip
			</button>
			<button class="primary ritual-button ritual-button--primary" type="button" onclick={next}>
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

	.title-scrim {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
		background:
			radial-gradient(
				ellipse 58% 44% at 50% 52%,
				rgba(6, 9, 18, 0.74) 0%,
				rgba(6, 9, 18, 0.34) 56%,
				transparent 100%
			),
			linear-gradient(
				180deg,
				rgba(6, 9, 18, 0.5) 0%,
				transparent 26%,
				transparent 60%,
				rgba(6, 9, 18, 0.82) 100%
			);
	}

	.title-card {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		max-width: 44rem;
		padding: 2rem;
		text-align: center;
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

	.popover {
		position: fixed;
		z-index: 102;
		overflow-y: auto;
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

	.step-count {
		margin: 0;
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

	button.primary,
	button.ghost {
		min-height: 3rem;
		padding: 0.72rem 1.05rem;
		font-size: 0.8rem;
	}

	button:focus-visible {
		outline: 2px solid var(--gold-bright);
		outline-offset: 2px;
	}
</style>
