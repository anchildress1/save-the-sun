<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { DebugEvent, DebugLevel } from '$lib/server/debug/log';
	import type { PageProps } from './$types';

	// SSR gives the first paint; the page then polls so the log stays live while screen-shared.
	let { data }: PageProps = $props();
	let events = $state<DebugEvent[]>(untrack(() => data.events));
	let level = $state<DebugLevel>(untrack(() => data.level));

	// Newest first so the latest move is on top during the demo (no scrolling to follow along).
	const ordered = $derived([...events].reverse());

	async function refresh() {
		try {
			const res = await fetch('/api/debug');
			if (!res.ok) return;
			const next = (await res.json()) as { level: DebugLevel; events: DebugEvent[] };
			events = next.events;
			level = next.level;
		} catch {
			// A dropped poll is harmless — the next tick retries; never break the view over it.
		}
	}

	onMount(() => {
		const id = setInterval(refresh, 1500);
		return () => clearInterval(id);
	});

	const pretty = (d: unknown) => JSON.stringify(d, null, 2);

	type Source = 'human' | 'oracle' | 'skoll' | 'session';
	const LABEL: Record<Source, string> = {
		human: 'Human',
		oracle: 'Oracle',
		skoll: 'Sköll',
		session: 'Engine'
	};

	// Card colour = WHO the event belongs to. A turn verdict is its actor's; the raw Gemini call IS
	// Sköll's move/reaction (the model computing his move), so it's his too — kept distinct as a raw-I/O
	// card, not a separate actor. The Oracle and the secret name themselves.
	function source(e: DebugEvent): Source {
		if (e.channel === 'turn') return e.actor === 'Sköll' ? 'skoll' : 'human';
		if (e.channel === 'gemini') return 'skoll';
		return e.channel as Source; // 'oracle' | 'skoll' | 'session'
	}

	// Orthogonal to colour: was this reached by a model call? The Oracle's read and the raw Gemini I/O
	// always are; a Sköll move/reaction is LLM only when Gemini decided it (the floor is deterministic).
	function isLlm(e: DebugEvent): boolean {
		if (e.channel === 'oracle' || e.channel === 'gemini') return true;
		if (e.channel === 'skoll') return e.data?.source === 'gemini';
		return false; // turn verdicts + the round's secret are the deterministic engine
	}
</script>

<svelte:head><title>Save the Sun — debug</title></svelte:head>

<main>
	<header>
		<h1>Debug log 🔧</h1>
		<p>
			Chronological stream — human questions, Sköll's move + reasoning each turn, the engine's
			verdicts, and (verbose) the secret + raw Gemini I/O. Level: <code>{level}</code> (set
			<code>DEBUG_LOG</code> to <code>verbose</code> / <code>demo</code> / <code>off</code>).
		</p>
		<p class="legend">
			Colour = source:
			<span class="tag human">Human</span>
			<span class="tag oracle">Oracle</span>
			<span class="tag skoll">Sköll</span> (incl. his raw Gemini move/reaction calls)
			<span class="tag session">Engine</span>. The <span class="badge llm">LLM</span> badge marks a
			model-derived event vs <span class="badge llm det">deterministic</span>; the part chip shows
			the turn phase.
		</p>
	</header>

	{#if level === 'off'}
		<p class="empty">
			The debug log is off. Set <code>DEBUG_LOG=verbose</code> (or <code>demo</code>) to see it.
		</p>
	{:else if ordered.length === 0}
		<p class="empty">No events yet. Play a turn and they appear here.</p>
	{:else}
		<ol reversed>
			{#each ordered as event (event.seq)}
				<li class="ev {source(event)} {event.level}" class:sensitive={event.sensitive}>
					<div class="head">
						<span class="seq">#{event.seq}</span>
						{#if event.part}<span class="part">{event.part}</span>{/if}
						<span class="who">{LABEL[source(event)]}</span>
						<span class="badge llm" class:det={!isLlm(event)}>
							{isLlm(event) ? 'LLM' : 'deterministic'}
						</span>
						{#if event.sensitive}<span class="badge sensitive-flag">sensitive</span>{/if}
						{#if event.level !== 'info'}<span class="badge {event.level}">{event.level}</span>{/if}
					</div>

					<p class="msg">{event.message}</p>
					{#if event.data}<pre>{pretty(event.data)}</pre>{/if}
				</li>
			{/each}
		</ol>
	{/if}
</main>

<style>
	/* Fluid throughout — no fixed widths or breakpoints. border-box so padding never widens a box
	   past its track, scoped to this view so it can't leak into the game. */
	main,
	main * {
		box-sizing: border-box;
	}
	main {
		/* Source colours — one per actor, defined once. Gemini (raw I/O) is its own, apart from Sköll. */
		/* Drawn from the game's palette: gold Oracle, cold-steel Sköll, sage witch, stone engine. */
		--human: #7ba88c;
		--oracle: #d9a94a;
		--skoll: #6c93bd;
		--session: #9a958a;
		inline-size: 100%;
		padding: clamp(1rem, 0.5rem + 2vw, 2.5rem) clamp(0.75rem, 0.5rem + 1.5vw, 2rem);
		min-block-size: 100dvh;
		color: #e8e8ea;
		background: #16161a;
		font-family: var(--font-body);
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	header p {
		margin: 0 0 0.6rem;
		color: #b8b8c0;
		line-height: 1.5;
	}
	header p.legend {
		margin-block-end: clamp(1rem, 0.5rem + 1.5vw, 1.75rem);
		font-size: 0.9rem;
	}
	code {
		background: #2c2c34;
		padding: 0.05em 0.35em;
		border-radius: 0.25em;
		font-size: 0.85em;
	}
	.empty {
		color: #b8b8c0;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: clamp(0.4rem, 0.3rem + 0.4vw, 0.75rem);
	}
	li {
		min-inline-size: 0; /* let a wide child (the raw I/O <pre>) shrink, not stretch the card */
		border: 1px solid #2c2c34;
		border-inline-start-width: 3px;
		border-radius: 0.4rem;
		padding: 0.6rem 0.9rem;
		background: #1d1d22;
	}
	/* Border = source. Severity (warn/error) and LLM-vs-deterministic are badges, not the colour. */
	li.human {
		border-inline-start-color: var(--human);
	}
	li.oracle {
		border-inline-start-color: var(--oracle);
	}
	li.skoll {
		border-inline-start-color: var(--skoll);
	}
	li.session {
		border-inline-start-color: var(--session);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.5rem;
		font-size: 0.8rem;
		color: #b8b8c0;
		margin-block-end: 0.35rem;
	}
	.seq {
		color: #7a7a85;
	}
	/* Turn phase (Ask / Cast / React / Round). */
	.part {
		padding: 0.05rem 0.4rem;
		border-radius: 0.25rem;
		background: #2c2c34;
		color: #c8c8d0;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}
	/* The source label, coloured to match its border. */
	.who {
		font-weight: 700;
	}
	li.human .who {
		color: var(--human);
	}
	li.oracle .who {
		color: var(--oracle);
	}
	li.skoll .who {
		color: var(--skoll);
	}
	li.session .who {
		color: var(--session);
	}
	.badge {
		padding: 0.05rem 0.45rem;
		border-radius: 1rem;
		background: #2c2c34;
		color: #b8b8c0;
		font-size: 0.7rem;
	}
	/* LLM badge — highlighted; deterministic — muted. */
	.badge.llm {
		margin-inline-start: auto;
		background: #5a4a00;
		color: #ffe08a;
		font-weight: 600;
	}
	.badge.llm.det {
		background: #2c2c34;
		color: #8a8a95;
		font-weight: 400;
	}
	.badge.sensitive-flag {
		background: #4a1f4a;
		color: #f0b3f0;
	}
	.badge.warn {
		background: #5a4300;
		color: #ffd98a;
	}
	.badge.error {
		background: #5a1f1f;
		color: #ff9d9d;
	}
	/* Legend swatches. */
	.legend .tag {
		padding: 0.05rem 0.4rem;
		border-radius: 0.25rem;
		font-weight: 600;
		font-size: 0.85em;
		color: #16161a;
	}
	.legend .tag.human {
		background: var(--human);
	}
	.legend .tag.oracle {
		background: var(--oracle);
	}
	.legend .tag.skoll {
		background: var(--skoll);
	}
	.legend .tag.session {
		background: var(--session);
	}
	.legend .badge {
		font-size: 0.85em;
	}
	.msg {
		margin: 0;
		overflow-wrap: anywhere; /* break long unbroken tokens (echoes, names) rather than overflow */
	}
	pre {
		margin: 0.4rem 0 0;
		padding: 0.5rem 0.7rem;
		background: #121215;
		border-radius: 0.3rem;
		/* Wrap the raw JSON (long system-instruction / base64 strings) instead of scrolling — keeps
		   indentation, never pushes the page wide. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.8rem;
		color: #c8c8d0;
	}
</style>
