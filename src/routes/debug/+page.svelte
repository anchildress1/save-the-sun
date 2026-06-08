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
				<li class="ev {event.channel} {event.level}" class:sensitive={event.sensitive}>
					<div class="head">
						<span class="seq">#{event.seq}</span>
						<span class="channel">{event.channel}</span>
						{#if event.actor}<span class="actor">{event.actor}</span>{/if}
						{#if event.sensitive}<span class="badge">sensitive</span>{/if}
						{#if event.level !== 'info'}<span class="badge {event.level}">{event.level}</span>{/if}
					</div>

					{#if event.channel === 'turn'}
						<div class="cols">
							<div class="truth">
								<span class="tag">deterministic-engine</span>
								<p>{event.data?.truth ?? event.message}</p>
							</div>
							<div class="inference">
								<span class="tag"
									>LLM-inference{event.data?.source ? ` · ${event.data.source}` : ''}</span
								>
								<p>{event.data?.inference || '—'}</p>
							</div>
						</div>
					{:else}
						<p class="msg">{event.message}</p>
						{#if event.data}<pre>{pretty(event.data)}</pre>{/if}
					{/if}
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
		margin: 0 0 clamp(1rem, 0.5rem + 1.5vw, 1.75rem);
		color: #b8b8c0;
		line-height: 1.5;
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
	li.turn {
		border-inline-start-color: #3a6ea5;
	}
	li.skoll {
		border-inline-start-color: #8a6d3b;
	}
	li.oracle {
		border-inline-start-color: #4a7a4a;
	}
	li.gemini {
		border-inline-start-color: #7a4a8a;
	}
	li.session {
		border-inline-start-color: #7a7a85;
	}
	li.warn {
		border-inline-start-color: #b9892b;
	}
	li.error {
		border-inline-start-color: #b03a3a;
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
	.channel {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.7rem;
		font-weight: 600;
	}
	.actor {
		color: #e8e8ea;
		font-weight: 600;
	}
	.badge {
		margin-inline-start: auto;
		padding: 0.05rem 0.45rem;
		border-radius: 1rem;
		background: #2c2c34;
		font-size: 0.7rem;
	}
	.badge.warn {
		background: #5a4300;
		color: #ffd98a;
		margin-inline-start: 0.25rem;
	}
	.badge.error {
		background: #5a1f1f;
		color: #ff9d9d;
		margin-inline-start: 0.25rem;
	}
	.sensitive .badge:first-of-type {
		background: #4a1f4a;
		color: #f0b3f0;
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
	.cols {
		display: grid;
		/* Two columns when there's room, one when there isn't — the reflow threshold is a relative
		   measure, not a pixel breakpoint. min(100%, …) keeps the floor from ever exceeding the track. */
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
		gap: clamp(0.6rem, 0.4rem + 1vw, 1.25rem);
	}
	.tag {
		display: block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #7a7a85;
		margin-block-end: 0.2rem;
	}
	.cols p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.truth {
		border-inline-start: 2px solid #3a6ea5;
		padding-inline-start: 0.75rem;
	}
	.inference {
		border-inline-start: 2px solid #8a6d3b;
		padding-inline-start: 0.75rem;
	}
</style>
