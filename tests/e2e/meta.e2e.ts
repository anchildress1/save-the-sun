import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

// Social embeds (dev.to, LinkedIn, X, Slack…) read these tags from the SSR HTML —
// no JS runs in those crawlers, so everything asserted here must arrive with the document.

const SITE_URL = 'https://savethesun.anchildress1.dev';

const meta = (page: Page, selector: string) =>
	page.locator(`meta[${selector}]`).getAttribute('content');

test.describe('social embed metadata', () => {
	test('OG card is complete with absolute URLs', async ({ page }) => {
		await page.goto('/');

		expect(await meta(page, 'property="og:title"')).toBe('Save the Sun');
		expect(await meta(page, 'property="og:type"')).toBe('website');
		expect(await meta(page, 'property="og:url"')).toBe(`${SITE_URL}/`);
		expect(await meta(page, 'property="og:description"')).toMatch(/deduction game/);
		expect(await meta(page, 'property="og:image"')).toMatch(new RegExp(`^${SITE_URL}/.+\\.webp$`));
		expect(await meta(page, 'property="og:image:alt"')).toBeTruthy();
	});

	// Crawlers never run JS — hydration could rewrite tags the SSR document got right.
	test('SSR HTML carries the OG tags crawlers actually see', async ({ request }) => {
		const html = await (await request.get('/')).text();
		expect(html).toContain(`<meta property="og:url" content="${SITE_URL}/"`);
		expect(html).toMatch(new RegExp(`property="og:image" content="${SITE_URL}/[^"]+\\.webp"`));
	});

	test('og:image resolves on the served build', async ({ page, request }) => {
		await page.goto('/');
		const imagePath = new URL((await meta(page, 'property="og:image"'))!).pathname;
		expect((await request.get(imagePath)).status()).toBe(200);
	});

	test('Twitter card and description mirror the OG card', async ({ page }) => {
		await page.goto('/');

		expect(await meta(page, 'name="twitter:card"')).toBe('summary_large_image');
		expect(await meta(page, 'name="twitter:image"')).toBe(await meta(page, 'property="og:image"'));
		expect(await meta(page, 'name="description"')).toBe(
			await meta(page, 'property="og:description"')
		);
		expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(`${SITE_URL}/`);
	});
});

test.describe('author footer', () => {
	test('copyright and icon profile links are present', async ({ page }) => {
		await page.goto('/');

		const footer = page.locator('footer.site-footer');
		await expect(footer).toContainText('© 2026 Ashley Childress');

		const links: Record<string, string> = {
			GitHub: 'https://github.com/anchildress1',
			'dev.to': 'https://dev.to/anchildress1',
			LinkedIn: 'https://linkedin.com/in/anchildress1',
			'anchildress1.dev': 'https://anchildress1.dev'
		};
		for (const [name, href] of Object.entries(links)) {
			const link = footer.getByRole('link', { name, exact: true });
			await expect(link).toHaveAttribute('href', href);
			// Icon-only links: the name rides aria-label, the hover helper rides title.
			await expect(link).toHaveAttribute('title', name);
			await expect(link.locator('svg')).toBeVisible();
		}
	});
});

test.describe('asset preloads', () => {
	test('fonts and button border load from immutable local assets', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('link[href*="fonts.googleapis.com"]')).toHaveCount(0);

		const fontPreloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((links) =>
			links.map((link) => ({
				href: link.getAttribute('href'),
				type: link.getAttribute('type'),
				crossorigin: link.getAttribute('crossorigin')
			}))
		);
		expect(fontPreloads).toHaveLength(4);
		for (const preload of fontPreloads) {
			expect(preload.href).toMatch(/^\/_app\/immutable\/assets\/.+\.woff2$/);
			expect(preload.type).toBe('font/woff2');
			expect(preload.crossorigin).toBe('anonymous');
		}

		const buttonBorderPreload = page.locator(
			'link[rel="preload"][as="image"][type="image/webp"][href*="button-border"]'
		);
		await expect(buttonBorderPreload).toHaveAttribute('fetchpriority', 'high');
		await expect(buttonBorderPreload).toHaveAttribute(
			'href',
			/^\/_app\/immutable\/assets\/button-border\..+\.webp$/
		);

		const borderSource = await page
			.locator('.btn')
			.first()
			.evaluate((button) => getComputedStyle(button, '::before').borderImageSource);
		expect(borderSource).toContain('button-border');
	});
});
