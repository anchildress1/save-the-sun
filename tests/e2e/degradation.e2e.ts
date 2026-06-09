import { expect, test } from '@playwright/test';

// S10 — degradation tiers (test-plan.md §8). v1 ships the Plain tier; the only mood layer is the GSAP
// motion, so the Reduced tier is "reduced-motion on, or the motion never runs." A tier that can't
// degrade to the one below doesn't ship — so the Reduced round is proven independently winnable + fair,
// not merely rendered. Audio is muted by default because v1 has no audio at all (asserted, not assumed).

const ONBOARDED_KEY = 'save-the-sun:onboarded';

test.describe('degradation — Reduced tier (prefers-reduced-motion)', () => {
	test.beforeEach(async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.addInitScript((key) => {
			try {
				localStorage.setItem(key, '1');
			} catch {
				/* storage blocked — not what this tier covers */
			}
		}, ONBOARDED_KEY);
	});

	test('the board is fully present at once — no motion to wait on', async ({ page }) => {
		await page.goto('/');
		// Under reduced motion the entrance stagger is skipped: every card rests visible immediately,
		// not faded in over time.
		await expect(page.locator('.rune-card')).toHaveCount(24);
		await expect(page.locator('.rune-card-wrapper').last()).toHaveCSS('opacity', '1');
	});

	test('ships no audio — there is nothing to unmute', async ({ page }) => {
		await page.goto('/');
		// "Audio muted by default" is structural in v1: no media element exists to autoplay.
		expect(await page.locator('audio, video').count()).toBe(0);
	});

	test('a full round stays winnable and fair with motion cut', async ({ page }) => {
		await page.route('**/api/action', (route) => {
			const body = route.request().postDataJSON?.() ?? {};
			if (body?.type === 'Ask')
				return route.fulfill({
					json: {
						type: 'Ask',
						oracle: {
							ok: true,
							answer: 'No. Sól is not reaching for a fire rune.',
							turnConsumed: true
						},
						state: { activePlayer: 'Human', status: 'active', winner: null, turns: 1 }
					}
				});
			return route.fulfill({
				json: {
					type: 'Cast',
					cast: { ok: true, won: true, rune: { name: 'Sowilo' }, turnConsumed: true },
					state: { activePlayer: 'Human', status: 'won', winner: 'Human', turns: 2 }
				}
			});
		});
		await page.goto('/');

		// Ask, cross, then cast — the deduction loop is unaffected by the missing motion.
		await page.getByLabel(/ask the oracle/i).fill('Is it a fire rune?');
		await page.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect(page.getByTestId('answer')).toContainText(
			'No. Sól is not reaching for a fire rune.'
		);

		await page.getByRole('button', { name: /cross off thurisaz/i }).click();
		await expect(page.getByRole('button', { name: /restore thurisaz/i })).toBeVisible();

		await page.getByRole('button', { name: 'Cast the rune' }).click();
		await page.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await page.getByRole('button', { name: 'Name it' }).click();

		// The round resolves the same as the Plain tier — the end screen rite still arrives at once.
		const endScreen = page.getByTestId('end-screen');
		await expect(endScreen).toBeVisible();
		await expect(endScreen.locator('#end-screen-lead')).toHaveText('The rune is true.');
	});
});
