import { expect, test } from '@playwright/test';

const ONBOARDED_KEY = 'save-the-sun:onboarded';

// A first-run title overlay covers the live board. These tests drive the board itself, so seed the
// onboarded flag (an init script that runs before the page's own) to open straight on the grid.
test.describe('the live board (past the title screen)', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript((key) => {
			try {
				localStorage.setItem(key, '1');
			} catch {
				/* storage blocked — the title will show, but that's not what these tests cover */
			}
		}, ONBOARDED_KEY);
	});

	test('renders the rite header', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('h1', { hasText: 'Save the Sun' })).toBeVisible();
		await expect(
			page.locator('p.tagline', { hasText: 'A rite for the longest day.' })
		).toBeVisible();
	});

	test('shows the night-progress chrome holding early in the night', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('night-progress')).toHaveText(
			'The night lies deep and unbroken.'
		);
	});

	test('steps aside for the best-on-desktop notice below the 750px minimum', async ({ page }) => {
		await page.setViewportSize({ width: 749, height: 800 });
		await page.goto('/');
		await expect(page.getByTestId('desktop-notice')).toBeVisible();
		await expect(page.getByText('The rite needs a wider sky.')).toBeVisible();
		await expect(page.locator('main')).toBeHidden();
	});

	test('renders the playable rite at the 750px embed floor', async ({ page }) => {
		await page.setViewportSize({ width: 750, height: 800 });
		await page.goto('/');
		await expect(page.locator('main')).toBeVisible();
		await expect(page.getByTestId('desktop-notice')).toBeHidden();
		await expect(page.locator('.rune-card')).toHaveCount(24);
		await expect(page.getByRole('button', { name: 'Ask the Oracle' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Cast the rune' })).toBeVisible();
		const sowiloCard = page.locator('.rune-card[data-rune-name="Sowilo"]');
		const cardBox = await sowiloCard.boundingBox();
		const footerBox = await sowiloCard.locator('.traits').boundingBox();
		expect(cardBox).not.toBeNull();
		expect(footerBox).not.toBeNull();
		expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height);
		const sixPowerCard = page.locator('.rune-card[data-rune-name="Wunjo"]');
		const sixPowerCardBox = await sixPowerCard.boundingBox();
		const sixPowerLabelBox = await sixPowerCard.locator('.power-label').boundingBox();
		expect(sixPowerCardBox).not.toBeNull();
		expect(sixPowerLabelBox).not.toBeNull();
		expect(sixPowerLabelBox!.x + sixPowerLabelBox!.width).toBeLessThanOrEqual(
			sixPowerCardBox!.x + sixPowerCardBox!.width
		);
		const symbolNameOverlaps = await page.locator('.rune-card').evaluateAll((cards) =>
			cards
				.map((card) => {
					const name = card.getAttribute('data-rune-name');
					const symbol = card.querySelector('.rune-symbol-image')?.getBoundingClientRect();
					const label = card.querySelector('.name')?.getBoundingClientRect();
					return symbol && label && symbol.bottom > label.top ? name : null;
				})
				.filter(Boolean)
		);
		expect(symbolNameOverlaps).toEqual([]);
	});

	test('keeps embed-mode rune cards capped at their natural 4:5 ratio', async ({ page }) => {
		await page.setViewportSize({ width: 1024, height: 768 });
		await page.goto('/');
		const cards = await page.locator('.rune-card').evaluateAll((els) =>
			els.slice(0, 4).map((el) => {
				const card = el.getBoundingClientRect();
				const wrapper = el.parentElement!.getBoundingClientRect();
				return {
					width: card.width,
					height: card.height,
					centerDelta: Math.abs(card.left + card.width / 2 - (wrapper.left + wrapper.width / 2))
				};
			})
		);
		expect(cards).toHaveLength(4);
		for (const card of cards) {
			expect(card.width).toBeLessThanOrEqual(213);
			expect(card.width / card.height).toBeCloseTo(4 / 5, 1);
			expect(card.centerDelta).toBeLessThan(1);
		}
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
		await expect(
			page.locator('.rune-card[data-rune-name="Sowilo"]').getByText('Red')
		).toBeVisible();
	});

	test('crosses a rune off and restores it', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: /cross off sowilo/i }).click();
		await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();
		await page.getByRole('button', { name: /restore sowilo/i }).click();
		await expect(page.getByRole('button', { name: /cross off sowilo/i })).toBeVisible();
	});

	test('arms a cast, names a rune, and routes it through the action interface', async ({
		page
	}) => {
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
		await expect(page.getByTestId('answer')).toHaveText('Sowilo is not the one. The night holds.');

		// Round continues: the crossing is intact and the human can ask again.
		await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Ask the Oracle' })).toBeEnabled();
	});

	test('restores the crossings and voiced line over the resumed round after a reload', async ({
		page
	}) => {
		// The Ask is mocked so the run is deterministic and Gemini-free; the human stays on the clock.
		await page.route('**/api/action', (route) => {
			const body = route.request().postDataJSON?.() ?? {};
			if (body?.type === 'Advance') return route.fulfill({ json: { type: 'Advance', state: {} } });
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
		});
		await page.goto('/');

		const boardOrder = () =>
			page
				.locator('.rune-card')
				.evaluateAll((cards) => cards.map((card) => card.getAttribute('data-rune-name')));
		const orderBefore = await boardOrder();

		// Dirty the view: cross a rune and earn a voiced line.
		await page.getByRole('button', { name: /cross off sowilo/i }).click();
		await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();
		await page.getByLabel(/ask the oracle/i).fill('Is it a fire rune?');
		await page.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect(page.getByTestId('answer')).toContainText(
			'No. Sól is not reaching for a fire rune.'
		);

		// A real reload resumes the same round (same session/token); the view must come back with it,
		// and the same round holds its seed — the board order must not reshuffle under the player.
		await page.reload();
		await expect(page.getByRole('button', { name: /restore sowilo/i })).toBeVisible();
		await expect(page.getByTestId('answer')).toContainText(
			'No. Sól is not reaching for a fire rune.'
		);
		expect(await boardOrder()).toEqual(orderBefore);
	});

	test('cancels a cast with no commitment', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Cast the rune' }).click();
		await page.getByRole('button', { name: 'Not yet' }).click();
		await expect(page.getByRole('button', { name: 'Cast the rune' })).toBeVisible();
	});

	test('reaction prompt sits above the Sköll banner — its buttons are clickable, not occluded', async ({
		page
	}) => {
		// Guards the regression where the prompt rendered behind the banner; a click fails if occluded.
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
						skollReaction: { hexed: false },
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
		await page.getByLabel(/ask the oracle/i).fill('Is it gold?');
		await page.getByRole('button', { name: 'Ask the Oracle' }).click();

		await expect(page.getByRole('button', { name: 'Pass' })).toBeVisible();
		await page.getByRole('button', { name: 'Pass' }).click({ trial: true });
		await page.getByRole('button', { name: 'Pass' }).click();
		await expect(page.getByTestId('answer')).toContainText('You stay your hand');
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
});

// Title screen + coach-mark tour end to end, what the component/page suites can't prove: the real
// overlay against the real grid, and dismissal persisting across a reload.
test.describe('first-run onboarding', () => {
	test('shows the title over the live board, dismisses, and stays dismissed on reload', async ({
		page
	}) => {
		// No seeded flag — exercise the genuine first-run path.
		await page.goto('/');
		await expect(page.getByTestId('onboarding')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Light the fire.' })).toBeVisible();
		// The board is rendered behind the dimmed title, not replaced by it.
		await expect(page.locator('.rune-card')).toHaveCount(24);

		await page.getByRole('button', { name: 'Light the fire.' }).click();
		await expect(page.getByTestId('onboarding')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Cast the rune' })).toBeEnabled();

		// Persisted: a real reload does not bring the title back (a refresh resumes the same round).
		await page.reload();
		await expect(page.getByTestId('onboarding')).toHaveCount(0);
	});

	test('walks the coach-mark tour over the board and finds her rune', async ({ page }) => {
		await page.goto('/');
		// Scope to the title overlay — a second "How the rite works" lives in the header behind it.
		await page
			.getByTestId('onboarding')
			.getByRole('button', { name: 'How the rite works' })
			.click();
		await expect(page.getByTestId('step-count')).toHaveText('1 / 6');
		// The board stays visible behind each coach-mark.
		await expect(page.locator('.rune-card')).toHaveCount(24);

		await page.mouse.wheel(0, 600);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

		for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByTestId('step-count')).toHaveText('5 / 6');
		await expect(page.getByRole('heading', { name: 'Cast', exact: true })).toBeVisible();

		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByTestId('step-count')).toHaveText('6 / 6');
		await expect(page.getByRole('heading', { name: 'Speak' })).toBeVisible();
		const finish = page.getByRole('button', { name: 'Find her rune.' });
		await expect(finish).toBeInViewport();
		await finish.click();
		await expect(page.getByTestId('onboarding')).toHaveCount(0);
	});

	test('reopens the tour from the header after dismissal', async ({ page }) => {
		await page.addInitScript((key) => {
			try {
				localStorage.setItem(key, '1');
			} catch {
				/* storage blocked */
			}
		}, ONBOARDED_KEY);
		await page.goto('/');
		await expect(page.getByTestId('onboarding')).toHaveCount(0);
		await page.getByTestId('show-instructions').click();
		// Straight into the tour (no title), spotlighting the live board.
		await expect(page.getByTestId('step-count')).toHaveText('1 / 6');
		await expect(page.locator('.rune-card')).toHaveCount(24);
	});
});

test.describe('the night advances', () => {
	test.beforeEach(async ({ page }) => {
		await page.addInitScript((key) => {
			try {
				localStorage.setItem(key, '1');
			} catch {
				/* storage blocked */
			}
		}, ONBOARDED_KEY);
	});

	test('the painted moon sinks as turns pass', async ({ page }) => {
		const midGame = { activePlayer: 'Human', status: 'active', winner: null, turns: 3 };
		await page.route('**/api/action', (route) => {
			const body = route.request().postDataJSON?.() ?? {};
			if (body?.type === 'Advance')
				return route.fulfill({ json: { type: 'Advance', state: midGame } });
			return route.fulfill({
				json: {
					type: 'Ask',
					oracle: {
						ok: true,
						answer: 'No. Sól is not reaching for a fire rune.',
						turnConsumed: true
					},
					state: midGame
				}
			});
		});
		await page.goto('/');

		// Computed translate is "0px" while y is zero; the y component appears once the sky moves.
		const skyY = () =>
			page
				.locator('.header-background-image')
				.evaluate((el) => parseFloat(getComputedStyle(el).translate.split(' ')[1] ?? '0'));
		const pageDawnOpacity = () =>
			page.locator('main').evaluate((el) => Number(getComputedStyle(el, '::before').opacity));
		expect(await skyY()).toBe(0);
		expect(await pageDawnOpacity()).toBe(0);

		await page.getByLabel(/ask the oracle/i).fill('Is it a fire rune?');
		await page.getByRole('button', { name: 'Ask the Oracle' }).click();
		await expect(page.getByTestId('answer')).toContainText('fire rune');

		// Sinks, but never the full 44px band mid-game — only a won dawn completes the descent.
		await expect.poll(skyY).toBeGreaterThan(0);
		expect(await skyY()).toBeLessThan(44);
		await expect.poll(pageDawnOpacity).toBeGreaterThan(0);
	});

	test('the night completes on a win — the moon fully sets', async ({ page }) => {
		await page.route('**/api/action', (route) =>
			route.fulfill({
				json: {
					type: 'Cast',
					cast: { ok: true, won: true, rune: { name: 'Sowilo' }, turnConsumed: true },
					state: { activePlayer: 'Human', status: 'won', winner: 'Human', turns: 4 }
				}
			})
		);
		await page.goto('/');

		await page.getByRole('button', { name: 'Cast the rune' }).click();
		await page.getByRole('button', { name: /select sowilo as cast target/i }).click();
		await page.getByRole('button', { name: 'Name it' }).click();

		// nightT snaps to 1 on a human win: the sky finishes its full 44px descent.
		await expect(page.locator('.header-background-image')).toHaveCSS('translate', '0px 44px');
	});
});
