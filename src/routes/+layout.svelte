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
	<p class="copyright">© 2026 Ashley Childress</p>
	<p class="profile-links">
		<a
			href="https://github.com/anchildress1"
			target="_blank"
			rel="me noopener noreferrer"
			aria-label="GitHub"
			title="GitHub"
		>
			<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
				/>
			</svg>
		</a>
		<a
			href="https://dev.to/anchildress1"
			target="_blank"
			rel="me noopener noreferrer"
			aria-label="dev.to"
			title="dev.to"
		>
			<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path
					d="M7.42 10.05c-.18-.16-.46-.23-.84-.23H6l.02 2.44.04 2.45.56-.02c.41 0 .63-.07.83-.26.24-.24.26-.36.26-2.2 0-1.91-.02-1.96-.29-2.18zM0 4.94v14.12h24V4.94H0zM8.56 15.3c-.44.58-1.06.77-2.53.77H4.71V8.53h1.4c1.67 0 2.16.18 2.6.9.27.43.29.6.32 2.57.05 2.23-.02 2.73-.47 3.3zm5.09-5.47h-2.47v1.77h1.52v1.28l-.72.04-.75.03v1.77l1.22.03 1.2.04v1.28h-1.6c-1.53 0-1.6-.01-1.87-.3l-.3-.28v-3.16c0-3.02.01-3.18.25-3.48.23-.31.25-.31 1.88-.31h1.64v1.3zm4.68 5.45c-.17.43-.64.79-1 .79-.18 0-.45-.15-.67-.39-.32-.32-.45-.63-.82-2.08l-.9-3.39-.45-1.67h.76c.4 0 .75.02.75.05 0 .06 1.16 4.54 1.26 4.83.04.15.32-.7.73-2.3l.66-2.52.74-.04c.4-.02.73 0 .73.04 0 .14-1.67 6.38-1.8 6.68z"
				/>
			</svg>
		</a>
		<!-- LinkedIn glyph: Font Awesome Free, CC BY 4.0 -->
		<a
			href="https://linkedin.com/in/anchildress1"
			target="_blank"
			rel="me noopener noreferrer"
			aria-label="LinkedIn"
			title="LinkedIn"
		>
			<svg viewBox="0 0 448 512" fill="currentColor" aria-hidden="true">
				<path
					d="M100.3 448l-92.9 0 0-299.1 92.9 0 0 299.1zM53.8 108.1C24.1 108.1 0 83.5 0 53.8 0 39.5 5.7 25.9 15.8 15.8s23.8-15.8 38-15.8 27.9 5.7 38 15.8 15.8 23.8 15.8 38c0 29.7-24.1 54.3-53.8 54.3zM447.9 448l-92.7 0 0-145.6c0-34.7-.7-79.2-48.3-79.2-48.3 0-55.7 37.7-55.7 76.7l0 148.1-92.8 0 0-299.1 89.1 0 0 40.8 1.3 0c12.4-23.5 42.7-48.3 87.9-48.3 94 0 111.3 61.9 111.3 142.3l0 164.3-.1 0z"
				/>
			</svg>
		</a>
		<a
			href="https://anchildress1.dev"
			target="_blank"
			rel="me noopener noreferrer"
			aria-label="anchildress1.dev"
			title="anchildress1.dev"
		>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="10" />
				<line x1="2" y1="12" x2="22" y2="12" />
				<path
					d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
				/>
			</svg>
		</a>
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

	.copyright {
		margin: 0;
	}

	.profile-links {
		margin: 0.5rem 0 0;
		display: flex;
		justify-content: center;
		gap: 1.15rem;
	}

	.profile-links a {
		display: inline-flex;
		padding: 0.15rem;
		color: var(--gold);
	}

	.profile-links svg {
		width: 17px;
		height: 17px;
	}

	.profile-links a:hover {
		color: var(--gold-bright);
		filter: drop-shadow(0 0 6px rgba(217, 169, 74, 0.45));
	}

	.profile-links a:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
		border-radius: 4px;
	}
</style>
