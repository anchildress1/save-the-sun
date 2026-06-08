<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { DebugEntry } from '$lib/server/debug/log';
	import type { PageProps } from './$types';

	// SSR gives the first paint; the page then polls so the log stays live while screen-shared.
	let { data }: PageProps = $props();
	let entries = $state<DebugEntry[]>(untrack(() => data.entries));

	// Newest first so the latest move is on top during the demo (no scrolling to follow along).
	const ordered = $derived([...entries].reverse());

	async function refresh() {
		try {
			const res = await fetch('/api/debug');
			if (res.ok) entries = ((await res.json()) as { entries: DebugEntry[] }).entries;
		} catch {
			// A dropped poll is harmless — the next tick retries; never break the view over it.
		}
	}

	onMount(() => {
		const id = setInterval(refresh, 1500);
		return () => clearInterval(id);
	});
</script>

<svelte:head><title>Save the Sun — debug</title></svelte:head>

<main>
	<header>
		<h1>Debug view 🔧</h1>
		<p>
			Every result: the <strong>deterministic-engine</strong> truth beside the
			<strong>LLM-inference</strong> that reached it. A turn the deterministic floor fired is flagged.
		</p>
	</header>

	{#if ordered.length === 0}
		<p class="empty">No moves yet. Play a turn and they appear here.</p>
	{:else}
		<ol reversed>
			{#each ordered as entry (entry.seq)}
				<li>
					<div class="head">
						<span class="seq">#{entry.seq}</span>
						<span class="actor">{entry.actor}</span>
						<span class="action">{entry.action}</span>
						{#if entry.source}
							<span class="source" class:floor={entry.source === 'floor'}>
								{entry.source === 'floor' ? 'deterministic floor' : 'Gemini'}
							</span>
						{/if}
					</div>
					<div class="cols">
						<div class="truth">
							<span class="tag">deterministic-engine</span>
							<p>{entry.truth}</p>
						</div>
						<div class="inference">
							<span class="tag">LLM-inference</span>
							<p>{entry.inference || '—'}</p>
						</div>
					</div>
				</li>
			{/each}
		</ol>
	{/if}
</main>

<style>
	main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		font-family: system-ui, sans-serif;
		color: #e8e8ea;
		background: #16161a;
		min-height: 100vh;
	}
	h1 {
		margin: 0 0 0.25rem;
	}
	header p {
		margin: 0 0 1.5rem;
		color: #b8b8c0;
	}
	.empty {
		color: #b8b8c0;
	}
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}
	li {
		border: 1px solid #2c2c34;
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		background: #1d1d22;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 0.85rem;
	}
	.seq {
		color: #7a7a85;
	}
	.actor {
		font-weight: 600;
	}
	.action {
		color: #b8b8c0;
	}
	.source {
		margin-left: auto;
		padding: 0.1rem 0.5rem;
		border-radius: 1rem;
		background: #2c2c34;
		color: #b8b8c0;
	}
	.source.floor {
		background: #5a2d00;
		color: #ffcf99;
	}
	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.tag {
		display: block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #7a7a85;
		margin-bottom: 0.2rem;
	}
	.cols p {
		margin: 0;
	}
	.truth {
		border-left: 2px solid #3a6ea5;
		padding-left: 0.75rem;
	}
	.inference {
		border-left: 2px solid #8a6d3b;
		padding-left: 0.75rem;
	}
</style>
