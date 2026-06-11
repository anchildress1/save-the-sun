import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// S10 — R9 accessibility basics, proven against the live build. axe sweeps every surface for
// names/roles + WCAG 2.1 AA contrast (both rune palettes are on the board at once) + color
// independence; the keyboard suite plays the whole round without a pointer and checks the focus ring.

const ONBOARDED_KEY = 'save-the-sun:onboarded';

// The full WCAG 2.0 + 2.1 Level A/AA rule set — which subsumes the S10 concerns (name/role,
// color-contrast, color-independence) along with the rest of the A/AA bar. Decorative art over which
// axe can't compute contrast lands as `incomplete`, not `violations`, so it never false-fails.
const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const seedOnboarded = (page: Page) =>
	page.addInitScript((key) => {
		try {
			localStorage.setItem(key, '1');
		} catch {
			/* storage blocked — the title shows instead; the title sweeps cover that path */
		}
	}, ONBOARDED_KEY);

const sweep = (page: Page) => new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();

test.describe('a11y — axe has no violations on any surface', () => {
	test('the live board (past the title)', async ({ page }) => {
		await seedOnboarded(page);
		await page.goto('/');
		await expect(page.locator('.rune-card')).toHaveCount(24);
		const results = await sweep(page);
		expect(results.violations).toEqual([]);
	});

	test('the crossed + armed board states', async ({ page }) => {
		await seedOnboarded(page);
		await page.goto('/');
		await page.getByRole('button', { name: /cross off sowilo/i }).click();
		await page.getByRole('button', { name: 'Cast the rune' }).click();
		await page.getByRole('button', { name: /select dagaz as cast target/i }).click();
		await expect(page.getByTestId('cast-hint')).toHaveText('Cast Dagaz?');
		const results = await sweep(page);
		expect(results.violations).toEqual([]);
	});

	test('the first-run title overlay', async ({ page }) => {
		// No seeded flag — the genuine first-run title over the dimmed board.
		await page.goto('/');
		await expect(page.getByTestId('onboarding')).toBeVisible();
		const results = await sweep(page);
		expect(results.violations).toEqual([]);
	});

	test('the coach-mark tour over the board', async ({ page }) => {
		await page.goto('/');
		await page
			.getByTestId('onboarding')
			.getByRole('button', { name: 'How the rite works' })
			.click();
		await expect(page.getByTestId('step-count')).toHaveText('1 / 5');
		const results = await sweep(page);
		expect(results.violations).toEqual([]);
	});

	test('the reaction prompt when Sköll asks', async ({ page }) => {
		await seedOnboarded(page);
		await page.route('**/api/action', (route) => {
			const body = route.request().postDataJSON?.() ?? {};
			if (body?.type === 'Advance')
				return route.fulfill({
					json: {
						type: 'Advance',
						skoll: { asks: { echo: 'A gold rune. Mine.' } },
						state: { activePlayer: 'Sköll', status: 'active', winner: null, turns: 1 }
					}
				});
			return route.fulfill({
				json: {
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a gold rune.',
						turnConsumed: true
					},
					skollVsYou: { reaction: 'Pass' },
					state: { activePlayer: 'Sköll', status: 'active', winner: null, turns: 1 }
				}
			});
		});
		await page.goto('/');
		await page.getByLabel(/ask the oracle/i).fill('Is it gold?');
		await page.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible();
		const results = await sweep(page);
		expect(results.violations).toEqual([]);
	});

	for (const outcome of ['won', 'lost'] as const) {
		test(`the ${outcome === 'won' ? 'victory' : 'defeat'} end screen`, async ({ page }) => {
			await seedOnboarded(page);
			const winner = outcome === 'won' ? 'Human' : 'Sköll';
			await page.route('**/api/action', (route) =>
				route.fulfill({
					json: {
						type: 'Cast',
						cast: {
							ok: true,
							won: outcome === 'won',
							rune: { name: 'Sowilo' },
							turnConsumed: true
						},
						state: { activePlayer: 'Human', status: 'won', winner, turns: 1 }
					}
				})
			);
			await page.goto('/');
			await page.getByRole('button', { name: 'Cast the rune' }).click();
			await page.getByRole('button', { name: /select sowilo as cast target/i }).click();
			await page.getByRole('button', { name: 'Name it' }).click();
			await expect(page.getByTestId('end-screen')).toBeVisible();
			const results = await sweep(page);
			expect(results.violations).toEqual([]);
		});
	}
});

test.describe('a11y — the whole round is keyboard-operable with a visible focus ring', () => {
	test.beforeEach(({ page }) => seedOnboarded(page));

	test('drives a full cast with the keyboard only — arm, select, name it', async ({ page }) => {
		await page.route('**/api/action', (route) =>
			route.fulfill({
				json: {
					type: 'Cast',
					cast: { ok: true, won: true, rune: { name: 'Sowilo' }, turnConsumed: true },
					state: { activePlayer: 'Human', status: 'won', winner: 'Human', turns: 1 }
				}
			})
		);
		await page.goto('/');

		// Arm the cast by keyboard (focus the control, activate with Enter — no pointer).
		await page.getByRole('button', { name: 'Cast the rune' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('cast-hint')).toHaveText('Choose a rune from the board.');

		// Choose a target by keyboard — Space activates the rune button.
		const target = page.getByRole('button', { name: /select sowilo as cast target/i });
		await target.focus();
		await page.keyboard.press('Space');
		await expect(page.getByTestId('cast-hint')).toHaveText('Cast Sowilo?');

		// Commit by keyboard.
		await page.getByRole('button', { name: 'Name it' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('answer')).toHaveText('The rune is true.');
	});

	test('asks and crosses off by keyboard alone', async ({ page }) => {
		await page.route('**/api/action', (route) =>
			route.fulfill({
				json: {
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a fire rune.',
						turnConsumed: true
					},
					state: { activePlayer: 'Human', status: 'active', winner: null, turns: 1 }
				}
			})
		);
		await page.goto('/');

		// Cross-off is a button: focus it and toggle with Enter — never gated behind a pointer.
		await page.getByRole('button', { name: /cross off sowilo/i }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();

		// Ask: type into the focused field, submit with Enter.
		await page.getByLabel(/ask the oracle/i).focus();
		await page.keyboard.type('Is it a fire rune?');
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('answer')).toContainText(
			'No. Sól is not reaching for a fire rune.'
		);
	});

	test('reacts to Sköll by keyboard — Hex silences the question', async ({ page }) => {
		await page.route('**/api/action', (route) => {
			const body = route.request().postDataJSON?.() ?? {};
			if (body?.type === 'Advance')
				return route.fulfill({
					json: {
						type: 'Advance',
						skoll: { asks: { echo: 'A gold rune. Mine.' } },
						state: { activePlayer: 'Sköll', status: 'active', winner: null, turns: 1 }
					}
				});
			if (body?.type === 'React')
				return route.fulfill({
					json: {
						type: 'React',
						skollReaction: { hexed: true },
						state: { activePlayer: 'Human', status: 'active', winner: null, turns: 1 }
					}
				});
			return route.fulfill({
				json: {
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a gold rune.',
						turnConsumed: true
					},
					skollVsYou: { reaction: 'Pass' },
					state: { activePlayer: 'Sköll', status: 'active', winner: null, turns: 1 }
				}
			});
		});
		await page.goto('/');
		await page.getByLabel(/ask the oracle/i).focus();
		await page.keyboard.type('Is it gold?');
		await page.keyboard.press('Enter');

		// Wait for Sköll's parked Ask to raise the reaction prompt, then Hex it from the keyboard.
		// Scope to the prompt: a disabled "Hex" placeholder shares the name until the prompt mounts,
		// and a keypress on that no-ops.
		const prompt = page.getByTestId('reaction-prompt');
		await expect(prompt).toBeVisible();
		await prompt.getByRole('button', { name: 'Hex' }).press('Enter');
		await expect(page.getByTestId('answer')).toContainText('His question dies unanswered');
	});

	test('shows a visible focus indicator on the rune cards and the controls', async ({ page }) => {
		await page.goto('/');

		// A rune card carries a 2px gold outline when focused (RuneCard :focus-visible).
		const card = page.getByRole('button', { name: /cross off sowilo/i });
		await card.focus();
		const cardOutline = await card.evaluate((el) => {
			const s = getComputedStyle(el);
			return { width: s.outlineWidth, style: s.outlineStyle };
		});
		expect(parseFloat(cardOutline.width)).toBeGreaterThanOrEqual(2);
		expect(cardOutline.style).not.toBe('none');

		// The ritual buttons carry a focus-ring box-shadow when focused (no bare outline:none).
		const ask = page.getByRole('button', { name: 'Ask the Oracle' });
		await ask.focus();
		const askShadow = await ask.evaluate((el) => getComputedStyle(el).boxShadow);
		expect(askShadow).not.toBe('none');
	});

	test('Tab traverses the board in order — focus is never trapped on the grid', async ({
		page
	}) => {
		await page.goto('/');
		const first = page.getByRole('button', { name: /cross off sowilo/i });
		await first.focus();
		// Forward Tab leaves this card for the next focusable element, not a dead end.
		await page.keyboard.press('Tab');
		const movedOff = await first.evaluate((el) => el !== document.activeElement);
		expect(movedOff).toBe(true);
		// The newly focused element is itself a real interactive control.
		const nextRole = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
		expect(['button', 'input', 'a']).toContain(nextRole);
	});
});
