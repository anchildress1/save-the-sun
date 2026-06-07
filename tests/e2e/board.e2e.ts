import { expect, test } from '@playwright/test';

test('renders the rite header', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1', { hasText: 'Save the Sun' })).toBeVisible();
	await expect(page.locator('p.tagline', { hasText: 'A rite for the longest day.' })).toBeVisible();
});

test('shows the night-progress chrome holding early in the night', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('night-progress')).toHaveText('The night lies deep and unbroken.');
});

test('steps aside for the best-on-desktop notice below the 1280px minimum', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 800 });
	await page.goto('/');
	await expect(page.getByTestId('desktop-notice')).toBeVisible();
	await expect(page.getByText('The rite needs a wider sky.')).toBeVisible();
	await expect(page.locator('main')).toBeHidden();
});

test('shows the rite, not the notice, at desktop width', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto('/');
	await expect(page.locator('main')).toBeVisible();
	await expect(page.getByTestId('desktop-notice')).toBeHidden();
});

test('renders all 24 rune cards with visible trait text', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.rune-card')).toHaveCount(24);
	// No color alone: the color name itself is visible text on the board.
	await expect(page.locator('.rune-card[data-rune-name="Sowilo"]').getByText('Red')).toBeVisible();
});

test('crosses a rune off and restores it', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /cross off sowilo/i }).click();
	await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();
	await page.getByRole('button', { name: /restore sowilo/i }).click();
	await expect(page.getByRole('button', { name: /cross off sowilo/i })).toBeVisible();
});

test('arms a cast, names a rune, and routes it through the action interface', async ({ page }) => {
	await page.goto('/');
	// Mock the action response so the run is deterministic and Gemini-free.
	await page.route('**/api/action', (route) =>
		route.fulfill({
			json: {
				type: 'Cast',
				cast: { ok: true, won: true, rune: { name: 'Sowilo' }, turnConsumed: true },
				state: { activePlayer: 'Human', status: 'won', winner: 'Human', turns: 1 }
			}
		})
	);
	await page.getByRole('button', { name: 'Cast the rune' }).click();
	await page.getByRole('button', { name: /select sowilo as cast target/i }).click();
	await expect(page.getByTestId('cast-hint')).toHaveText('Cast Sowilo?');
	await page.getByRole('button', { name: 'Name it' }).click();
	await expect(page.getByTestId('answer')).toHaveText('The rune is true.');
	// Round resolves: the pill flips to the victory state and casting is locked.
	await expect(page.getByTestId('turn-pill')).toHaveText('The rune is true.');
	await expect(page.getByRole('button', { name: 'Cast the rune' })).toBeDisabled();
});

test('a wrong cast costs the turn only — crossings and round survive', async ({ page }) => {
	await page.goto('/');
	await page.route('**/api/action', (route) =>
		route.fulfill({
			json: {
				type: 'Cast',
				cast: { ok: true, won: false, turnConsumed: true },
				state: { activePlayer: 'Human', status: 'active', winner: null, turns: 1 }
			}
		})
	);
	// Cross a rune off first — its crossing must survive the wrong cast.
	await page.getByRole('button', { name: /cross off sowilo/i }).click();
	await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();

	// Cast a (crossed-off) rune and miss. Crossing the grid never bars a cast.
	await page.getByRole('button', { name: 'Cast the rune' }).click();
	await page.getByRole('button', { name: /select sowilo as cast target/i }).click();
	await page.getByRole('button', { name: 'Name it' }).click();
	await expect(page.getByTestId('answer')).toHaveText('The rune is not the one. The night holds.');

	// Round continues: the crossing is intact and the human can ask again.
	await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ask the Oracle' })).toBeEnabled();
});

test('cancels a cast with no commitment', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Cast the rune' }).click();
	await page.getByRole('button', { name: 'Not yet' }).click();
	await expect(page.getByRole('button', { name: 'Cast the rune' })).toBeVisible();
});

test('refuses an empty Ask without dispatching', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Ask the Oracle' }).click();
	await expect(page.getByTestId('answer')).toHaveText('Speak your question, witch.');
});

test('dispatches a non-empty Ask and shows the voiced answer', async ({ page }) => {
	await page.goto('/');
	// Mock the Oracle response: e2e stays deterministic and never calls Gemini.
	await page.route('**/api/action', (route) =>
		route.fulfill({
			json: {
				type: 'Ask',
				oracle: {
					ok: true,
					echo: 'You ask after the fire-runes.',
					answer: 'No. Sól is not reaching for a fire rune.',
					affirmative: false,
					turnConsumed: true
				},
				state: { activePlayer: 'Human', status: 'active', winner: null, turns: 1 }
			}
		})
	);
	await page.getByLabel(/ask the oracle/i).fill('Is it a fire rune?');
	await page.getByRole('button', { name: 'Ask the Oracle' }).click();
	await expect(page.getByTestId('answer')).toContainText(
		'No. Sól is not reaching for a fire rune.'
	);
});

test('board screenshot for POC comparison', async ({ page }, testInfo) => {
	await page.goto('/');
	await expect(page.locator('.rune-card')).toHaveCount(24);
	// Let the GSAP entrance settle so the artifact shows the resting board.
	await expect(page.locator('.rune-card-wrapper').last()).toHaveCSS('opacity', '1');
	await page.screenshot({ path: testInfo.outputPath('board.png'), fullPage: true });
	expect(testInfo.outputPath('board.png')).toContain('board.png');
});

// Visual artifacts for the crossed + armed board states (the [V] grid-state coverage). Kept as
// smoke artifacts rather than pixel-diff baselines, which flake across Mac↔Linux until CI pins a
// matched runner; the structural assertions live in the RuneGrid component suite.
test('crossed + armed state screenshots', async ({ page }, testInfo) => {
	await page.goto('/');
	await expect(page.locator('.rune-card-wrapper').last()).toHaveCSS('opacity', '1');

	// Crossed state: dim a card in place and capture the chalk X.
	await page.getByRole('button', { name: /cross off sowilo/i }).click();
	await expect(page.locator('.rune-card[data-rune-name="Sowilo"].crossed')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('board-crossed.png'), fullPage: true });

	// Armed state: arm the cast and select a target so the gold halo shows.
	await page.getByRole('button', { name: 'Cast the rune' }).click();
	await page.getByRole('button', { name: /select dagaz as cast target/i }).click();
	await expect(page.locator('.rune-card[data-rune-name="Dagaz"].selected')).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath('board-armed.png'), fullPage: true });

	expect(testInfo.outputPath('board-armed.png')).toContain('board-armed.png');
});
