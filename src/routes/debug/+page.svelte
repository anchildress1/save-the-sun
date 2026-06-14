<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { DebugEvent } from '$lib/server/debug/log';
	import type { PageProps } from './$types';

	// SSR gives the first paint; the page then polls so the log stays live while screen-shared.
	let { data }: PageProps = $props();
	let events = $state<DebugEvent[]>(untrack(() => data.events));
	const sessionId = untrack(() => data.sessionId);

	// Newest first so the latest move is on top during the demo (no scrolling to follow along).
	const ordered = $derived([...events].reverse());

	async function refresh() {
		try {
			const res = await fetch('/api/debug');
			if (!res.ok) return;
			events = ((await res.json()) as { events: DebugEvent[] }).events;
		} catch {
			// A dropped poll is harmless — the next tick retries; never break the view over it.
		}
	}

	onMount(() => {
		const id = setInterval(refresh, 1500);
		return () => clearInterval(id);
	});

	const pretty = (d: unknown) => JSON.stringify(d, null, 2);

	const ownerClass = (e: DebugEvent) => e.owner.toLowerCase().replace('ö', 'o'); // 'Sköll' → 'skoll'
	const KIND_LABEL = { input: 'input', llm: 'Gemini AI', deterministic: 'deterministic' } as const;
	// Raw Gemini I/O is multi-KB per call; voice tool calls carry args/results. Both are collapsed
	// so the stream reads as the parsed turn story — the detail is one click away.
	const summaryFor = (e: DebugEvent) =>
		e.message.startsWith('raw Gemini') ? 'full request / response' : 'details';
</script>

<svelte:head><title>Save the Sun — debug</title></svelte:head>

<main>
	<header>
		<h1>Debug log 🐞</h1>
		{#if sessionId}
			<p class="session">session <code>{sessionId}</code></p>
		{/if}
	</header>

	{#if ordered.length === 0}
		<p class="empty">No events yet. Play a turn and they appear here.</p>
	{:else}
		<ol reversed>
			{#each ordered as event (event.seq)}
				<li class="ev {ownerClass(event)} {event.level}">
					<div class="head">
						<span class="seq">#{event.seq}</span>
						<span class="part">{event.part}</span>
						<span class="who">{event.owner}</span>
						<span class="badge kind-badge {event.kind}">{KIND_LABEL[event.kind]}</span>
						{#if event.level !== 'info'}<span class="badge {event.level}">{event.level}</span>{/if}
					</div>

					<p class="msg">{event.message}</p>
					{#if event.data}
						<details class="io">
							<summary>{summaryFor(event)}</summary>
							<pre>{pretty(event.data)}</pre>
						</details>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</main>

<style>
	/* border-box so padding never widens a box past its track; scoped so it can't leak into the game. */
	main,
	main * {
		box-sizing: border-box;
	}
	main {
		/* Owner colors — the game's own rune-gem jewel tones (runeVisuals.ts). Red is held back for
		   warn/error so a severity badge never reads as an owner. */
		--human: #5cbf8a;
		--oracle: #e6c068;
		--skoll: #6ea0e0;
		--engine: #8b5cf6;
		inline-size: 100%;
		padding: clamp(1rem, 0.5rem + 2vw, 2.5rem) clamp(0.75rem, 0.5rem + 1.5vw, 2rem);
		min-block-size: 100dvh;
		color: #e8e8ea;
		background: #16161a;
		font-family: var(--font-body);
	}
	h1 {
		margin: 0 0 0.4rem;
	}
	.session {
		margin: 0 0 clamp(1rem, 0.5rem + 1.5vw, 1.75rem);
		font-size: 0.85rem;
		color: #b8b8c0;
	}
	.session code {
		padding: 0.05rem 0.4rem;
		border-radius: 0.25rem;
		background: #121215;
		color: #c8cdda;
		font-size: 0.8rem;
		user-select: all; /* one click selects the whole id to copy onto the watching screen */
		overflow-wrap: anywhere;
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
	li.human {
		border-inline-start-color: var(--human);
	}
	li.oracle {
		border-inline-start-color: var(--oracle);
	}
	li.skoll {
		border-inline-start-color: var(--skoll);
	}
	li.engine {
		border-inline-start-color: var(--engine);
	}
	li.error {
		border-inline-start-color: #e05555;
		background: #1e1518;
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
	.part {
		padding: 0.05rem 0.4rem;
		border-radius: 0.25rem;
		background: #2a3247;
		color: #c2cad8;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}
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
	li.engine .who {
		color: var(--engine);
	}
	.badge {
		padding: 0.05rem 0.45rem;
		border-radius: 1rem;
		background: #33384a;
		color: #c8cdda;
		font-size: 0.7rem;
	}
	/* Three distinct fills so the kinds never blur: outline input, gold LLM, green deterministic. */
	.badge.input {
		background: transparent;
		border: 1px solid #4a5168;
		color: #b6bccb;
	}
	.badge.llm {
		background: #5a4a00;
		color: #ffe08a;
		font-weight: 600;
	}
	.badge.deterministic {
		background: #18402e;
		color: #7fe0a8;
		font-weight: 600;
	}
	.badge.warn {
		background: #5a4300;
		color: #ffd98a;
	}
	.badge.error {
		background: #5a1f1f;
		color: #ff9d9d;
	}
	.msg {
		margin: 0;
		overflow-wrap: anywhere; /* break long unbroken tokens (echoes, names) rather than overflow */
	}
	.io {
		margin-top: 0.4rem;
	}
	.io summary {
		display: inline-block;
		padding: 0.1rem 0.2rem;
		color: #8f95a8;
		font-size: 0.75rem;
		letter-spacing: 0.03em;
		cursor: pointer;
		user-select: none;
	}
	.io summary:hover {
		color: #c8cdda;
	}
	.io summary:focus-visible {
		outline: 2px solid #ffe08a;
		outline-offset: 2px;
		border-radius: 0.2rem;
	}
	.io[open] summary {
		color: #c8cdda;
	}
	pre {
		margin: 0.4rem 0 0;
		padding: 0.5rem 0.7rem;
		background: #121215;
		border-radius: 0.3rem;
		/* Wrap long raw JSON (system-instruction / base64) instead of scrolling — never pushes the page wide. */
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 0.8rem;
		color: #c8c8d0;
	}
</style>
