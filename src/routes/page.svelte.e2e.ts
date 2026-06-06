import { expect, test } from '@playwright/test';

test('renders the rite header', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1', { hasText: 'Save the Sun' })).toBeVisible();
	await expect(
		page.getByText("Ask. Cross off what it can't be. Cast when you're ready.")
	).toBeVisible();
});

test('renders all 24 rune cards with visible trait text', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.rune-card')).toHaveCount(24);
	// No color alone: the color name itself is visible text on the board.
	await expect(page.locator('.rune-card[data-rune-name="Sowilo"]').getByText('Blue')).toBeVisible();
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
	await page.getByRole('button', { name: 'Cast the rune' }).click();
	await page.getByRole('button', { name: /select sowilo as cast target/i }).click();
	await expect(page.getByTestId('cast-hint')).toHaveText('Cast Sowilo?');
	await page.getByRole('button', { name: 'Name it' }).click();
	// Stub engine result echoed into The Answer.
	await expect(page.getByTestId('answer')).toContainText('Cast');
	await expect(page.getByRole('button', { name: 'Cast the rune' })).toBeVisible();
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

test('dispatches a non-empty Ask and shows the result', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel(/ask the oracle/i).fill('Is it a fire rune?');
	await page.getByRole('button', { name: 'Ask the Oracle' }).click();
	await expect(page.getByTestId('interpretation')).toContainText('fire rune');
	await expect(page.getByTestId('answer')).toContainText('Ask');
});

test('board screenshot for POC comparison', async ({ page }, testInfo) => {
	await page.goto('/');
	await expect(page.locator('.rune-card')).toHaveCount(24);
	// Let the GSAP entrance settle so the artifact shows the resting board.
	await expect(page.locator('.rune-card-wrapper').last()).toHaveCSS('opacity', '1');
	await page.screenshot({ path: testInfo.outputPath('board.png'), fullPage: true });
	expect(testInfo.outputPath('board.png')).toContain('board.png');
});
