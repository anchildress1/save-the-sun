<script lang="ts">
	import '$lib/styles/theme.css';
	import { versionedPwaAsset } from '$lib/pwaAssets';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&display=swap"
	/>
	<link rel="icon" type="image/x-icon" href={versionedPwaAsset('/favicon.ico')} sizes="any" />
	<link rel="icon" type="image/png" sizes="32x32" href={versionedPwaAsset('/favicon-32x32.png')} />
	<link rel="icon" type="image/png" sizes="16x16" href={versionedPwaAsset('/favicon-16x16.png')} />
	<link rel="apple-touch-icon" sizes="180x180" href={versionedPwaAsset('/apple-touch-icon.png')} />
	<link rel="manifest" href={versionedPwaAsset('/site.webmanifest')} />
	<meta name="theme-color" content="#060912" />
</svelte:head>

{@render children()}
