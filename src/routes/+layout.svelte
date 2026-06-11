<script lang="ts">
	import '$lib/styles/theme.css';
	import { versionedPwaAsset } from '$lib/pwaAssets';
	import cinzelFont from '$lib/assets/fonts/cinzel-latin.woff2?url&no-inline';
	import imFellEnglishFont from '$lib/assets/fonts/im-fell-english-latin.woff2?url&no-inline';
	import imFellEnglishItalicFont from '$lib/assets/fonts/im-fell-english-italic-latin.woff2?url&no-inline';
	import imFellEnglishScFont from '$lib/assets/fonts/im-fell-english-sc-latin.woff2?url&no-inline';
	import ogImage from '$lib/assets-webp/banners/intro-splash.webp?url&no-inline';
	import buttonBorder from '$lib/assets-webp/ui/button-border.webp?url&no-inline';

	let { children } = $props();

	// Hardcoded: crawlers need absolute URLs and the Cloud Run proxy hides the real origin.
	const SITE_URL = 'https://save-the-sun-b5cortkwia-ue.a.run.app';
	const TITLE = 'Save the Sun';
	const DESCRIPTION =
		'A free browser deduction game for the longest day. Question the Oracle, read the signs, and name the true rune before Sköll the wolf swallows the sun.';
	const OG_IMAGE_ALT =
		'A rune stone blazing with golden light at sunrise while Sköll, the great wolf, watches from a dark ridge.';
	// .pathname, not .href: the client bundle imports the asset absolute, and .href would let hydration rewrite the tag to the page origin.
	const ogImageUrl = SITE_URL + new URL(ogImage, SITE_URL).pathname;
</script>

<svelte:head>
	<link rel="preload" href={cinzelFont} as="font" type="font/woff2" crossorigin="anonymous" />
	<link
		rel="preload"
		href={imFellEnglishFont}
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
	/>
	<link
		rel="preload"
		href={imFellEnglishItalicFont}
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
	/>
	<link
		rel="preload"
		href={imFellEnglishScFont}
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
	/>
	<link rel="preload" href={buttonBorder} as="image" type="image/webp" fetchpriority="high" />
	<link rel="icon" type="image/x-icon" href={versionedPwaAsset('/favicon.ico')} sizes="any" />
	<link rel="icon" type="image/png" sizes="32x32" href={versionedPwaAsset('/favicon-32x32.png')} />
	<link rel="icon" type="image/png" sizes="16x16" href={versionedPwaAsset('/favicon-16x16.png')} />
	<link rel="apple-touch-icon" sizes="180x180" href={versionedPwaAsset('/apple-touch-icon.png')} />
	<link rel="manifest" href={versionedPwaAsset('/site.webmanifest')} />
	<meta name="theme-color" content="#060912" />

	<link rel="canonical" href="{SITE_URL}/" />
	<meta name="description" content={DESCRIPTION} />
	<meta name="author" content="Ashley Childress" />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content={TITLE} />
	<meta property="og:title" content={TITLE} />
	<meta property="og:description" content={DESCRIPTION} />
	<meta property="og:url" content="{SITE_URL}/" />
	<meta property="og:locale" content="en_US" />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:type" content="image/webp" />
	<meta property="og:image:width" content="1440" />
	<meta property="og:image:height" content="900" />
	<meta property="og:image:alt" content={OG_IMAGE_ALT} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={TITLE} />
	<meta name="twitter:description" content={DESCRIPTION} />
	<meta name="twitter:image" content={ogImageUrl} />
	<meta name="twitter:image:alt" content={OG_IMAGE_ALT} />
</svelte:head>

{@render children()}

<footer class="site-footer" aria-label="Author">
	<p>
		<span>© 2026 Ashley Childress</span>
		<span aria-hidden="true">·</span>
		<a href="https://github.com/anchildress1" target="_blank" rel="me noopener noreferrer">GitHub</a
		>
		<span aria-hidden="true">·</span>
		<a href="https://dev.to/anchildress1" target="_blank" rel="me noopener noreferrer">dev.to</a>
		<span aria-hidden="true">·</span>
		<a href="https://linkedin.com/in/anchildress1" target="_blank" rel="me noopener noreferrer"
			>LinkedIn</a
		>
		<span aria-hidden="true">·</span>
		<a href="https://anchildress1.dev" target="_blank" rel="me noopener noreferrer"
			>anchildress1.dev</a
		>
	</p>
</footer>

<style>
	.site-footer {
		padding: 0.75rem 1rem 1rem;
		text-align: center;
		font-family: var(--font-body);
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		color: var(--ink-muted);
	}

	.site-footer p {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.45rem;
	}

	.site-footer a {
		color: var(--gold);
		text-decoration: none;
	}

	.site-footer a:hover {
		color: var(--gold-bright);
		text-decoration: underline;
	}

	.site-footer a:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
		border-radius: 2px;
	}
</style>
