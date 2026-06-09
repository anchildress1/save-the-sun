import { render } from 'vitest-browser-svelte';
import { describe, it, expect, vi } from 'vitest';
import RuneCard from '$lib/components/RuneCard.svelte';
import type { Rune } from '$lib/board';

const uruz: Rune = {
	id: 6,
	name: 'Uruz',
	glyph: 'ᚢ',
	meaning: 'aurochs, strength',
	element: 'Fire',
	power: 4,
	fill: 'Light',
	color: 'Purple'
};

// A Dark rune (power 1) to assert the dark-pip marker.
const perthro: Rune = {
	id: 13,
	name: 'Perthro',
	glyph: 'ᛈ',
	meaning: 'dice-cup, fate',
	element: 'Spirit',
	power: 1,
	fill: 'Dark',
	color: 'Gold'
};

// Max power (6) + Dark — confirms every pip gets the dark marker, not just the first.
const othala: Rune = {
	id: 24,
	name: 'Othala',
	glyph: 'ᛟ',
	meaning: 'heritage, estate',
	element: 'Earth',
	power: 6,
	fill: 'Dark',
	color: 'Purple'
};

describe('RuneCard', () => {
	it('renders the symbol image, name, element, and color', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		const image = screen.container.querySelector('.rune-symbol-image');
		expect(image).toBeInstanceOf(HTMLImageElement);
		expect((image as HTMLImageElement).src).toMatch(/uruz\.png/);
		const elementIcon = screen.container.querySelector('.element-icon-image');
		expect(elementIcon).toBeInstanceOf(HTMLImageElement);
		expect((elementIcon as HTMLImageElement).src).toMatch(/fire\.png/);
		const colorIcon = screen.container.querySelector('.color-icon-image');
		expect(colorIcon).toBeInstanceOf(HTMLImageElement);
		expect((colorIcon as HTMLImageElement).src).toMatch(/purple\.png/);
		const fillIcons = screen.container.querySelectorAll('.pip-image');
		expect(fillIcons).toHaveLength(4);
		expect((fillIcons[0] as HTMLImageElement).src).toMatch(/light\.png/);
		const cardBackground = screen.container.querySelector('.card-background-image');
		expect(cardBackground).toBeInstanceOf(HTMLImageElement);
		expect((cardBackground as HTMLImageElement).src).toMatch(/stone\.png/);
		await expect.element(screen.getByText('Uruz')).toBeInTheDocument();
		await expect.element(screen.getByText('Fire')).toBeInTheDocument();
		await expect.element(screen.getByText('Purple')).toBeInTheDocument();
	});

	it('sizes trait icons for scanning and keeps trait text light on the dark stone', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		const elementIcon = screen.container.querySelector('.element-icon-image');
		const colorIcon = screen.container.querySelector('.color-icon-image');
		const fillIcon = screen.container.querySelector('.pip-image');
		const elementMark = screen.container.querySelector('.trait.element');
		const elementName = screen.container.querySelector('.element-name');
		const colorName = screen.container.querySelector('.color-name');
		const powerLabel = screen.container.querySelector('.power-label');
		const card = screen.container.querySelector('.rune-card');
		const cardBackground = screen.container.querySelector('.card-background-image');

		expect(elementIcon).toBeInstanceOf(HTMLImageElement);
		expect(colorIcon).toBeInstanceOf(HTMLImageElement);
		expect(fillIcon).toBeInstanceOf(HTMLImageElement);
		expect(elementMark).toBeInstanceOf(HTMLElement);
		expect(elementName).toBeInstanceOf(HTMLElement);
		expect(colorName).toBeInstanceOf(HTMLElement);
		expect(powerLabel).toBeInstanceOf(HTMLElement);
		expect(card).toBeInstanceOf(HTMLElement);
		expect(cardBackground).toBeInstanceOf(HTMLImageElement);

		expect(getComputedStyle(elementMark as Element).flexDirection).toBe('column');
		expect(getComputedStyle(elementIcon as Element).width).toBe('34px');
		expect(getComputedStyle(colorIcon as Element).width).toBe('40px');
		expect(getComputedStyle(fillIcon as Element).width).toBe('18px');
		expect(getComputedStyle(elementName as Element).color).toBe('rgb(243, 232, 207)');
		expect(getComputedStyle(colorName as Element).color).toBe('rgb(243, 232, 207)');
		expect(getComputedStyle(powerLabel as Element).color).toBe('rgb(243, 232, 207)');
		expect(getComputedStyle(card as Element).boxShadow).toBe('none');
		expect(getComputedStyle(cardBackground as Element).filter).not.toContain('drop-shadow');
	});

	it('falls back to visible text glyph when the symbol image fails to load', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		const image = screen.container.querySelector('.rune-symbol-image');
		expect(image).toBeInstanceOf(HTMLImageElement);

		image?.dispatchEvent(new Event('error'));
		await expect.element(screen.getByText('ᚢ')).toBeInTheDocument();
		expect(screen.container.querySelector('.rune-symbol-image')).toBeNull();
	});

	it('falls back to the CSS gem when the color icon fails to load', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		const image = screen.container.querySelector('.color-icon-image');
		expect(image).toBeInstanceOf(HTMLImageElement);

		image?.dispatchEvent(new Event('error'));
		await vi.waitFor(() => {
			expect(screen.container.querySelector('.color-icon-image')).toBeNull();
			expect(screen.container.querySelector('.gem[aria-hidden="true"]')).not.toBeNull();
		});
		await expect.element(screen.getByText('Purple')).toBeInTheDocument();
	});

	it('falls back to the text element mark when the element icon fails to load', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		const image = screen.container.querySelector('.element-icon-image');
		expect(image).toBeInstanceOf(HTMLImageElement);

		image?.dispatchEvent(new Event('error'));
		await vi.waitFor(() => {
			expect(screen.container.querySelector('.element-icon-image')).toBeNull();
			expect(screen.container.querySelector('.element .ic[aria-hidden="true"]')).not.toBeNull();
		});
		await expect.element(screen.getByText('Fire')).toBeInTheDocument();
	});

	it('falls back to CSS pips when the fill icon fails to load', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		const image = screen.container.querySelector('.pip-image');
		expect(image).toBeInstanceOf(HTMLImageElement);

		image?.dispatchEvent(new Event('error'));
		await vi.waitFor(() => {
			expect(screen.container.querySelector('.pip-image')).toBeNull();
			expect(screen.container.querySelectorAll('.pip')).toHaveLength(4);
		});
		await expect.element(screen.getByText('power', { exact: true })).toBeInTheDocument();
	});

	it('never conveys a trait by color alone — every icon carries its name as text (a11y)', async () => {
		// The color swatch and the element mark are both decorative (aria-hidden); the trait must
		// reach the player as text beside each, for every rune, so color is never load-bearing alone.
		// Scoped to each render's container — the locators stay unambiguous across the loop.
		for (const rune of [uruz, perthro, othala]) {
			const { container } = render(RuneCard, { rune, onAction: vi.fn() });
			// Decorative marks present...
			expect(container.querySelector('.color-icon-image[aria-hidden="true"]')).not.toBeNull();
			expect(container.querySelector('.element-icon-image[aria-hidden="true"]')).not.toBeNull();
			expect(container.querySelector('.pip-image[aria-hidden="true"]')).not.toBeNull();
			// ...and each is named in visible text on the card.
			expect(container.textContent).toContain(rune.color);
			expect(container.textContent).toContain(rune.element);
		}
	});

	it('displays the meaning under the name', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		await expect.element(screen.getByText('aurochs, strength')).toBeInTheDocument();
	});

	it('shows no digits on the card face — power value and rune id are never written', async () => {
		// Power reaches the player via pip count + accessible name; the id is internal.
		// The only numbers a card could show are those two, so the face has no digits.
		for (const rune of [uruz, perthro, othala]) {
			const screen = render(RuneCard, { rune, onAction: vi.fn() });
			expect(screen.container.textContent).not.toMatch(/\d/);
		}
	});

	it('never shows light/dark as a visible word (locked decision)', async () => {
		const light = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(light.container.textContent).not.toMatch(/\b(light|dark)\b/i);
		const dark = render(RuneCard, { rune: perthro, onAction: vi.fn() });
		expect(dark.container.textContent).not.toMatch(/\b(light|dark)\b/i);
	});

	it('speaks power + light/dark together in the accessible name ("{n} {light|dark} power")', async () => {
		const light = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		await expect
			.element(light.getByRole('button', { name: /cross off uruz, 4 light power/i }))
			.toBeInTheDocument();

		const dark = render(RuneCard, { rune: perthro, onAction: vi.fn() });
		await expect
			.element(dark.getByRole('button', { name: /cross off perthro, 1 dark power/i }))
			.toBeInTheDocument();
	});

	it('labels the power pips so every trait on the card is labeled (value not written)', async () => {
		const screen = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		await expect.element(screen.getByText('power', { exact: true })).toBeInTheDocument();
	});

	it('encodes fill on every pip image; pip count = power', async () => {
		const light = render(RuneCard, { rune: uruz, onAction: vi.fn() });
		expect(light.container.querySelectorAll('.pip-image')).toHaveLength(4);
		expect((light.container.querySelector('.pip-image') as HTMLImageElement).src).toMatch(
			/light\.png/
		);

		const darkOne = render(RuneCard, { rune: perthro, onAction: vi.fn() });
		expect(darkOne.container.querySelectorAll('.pip-image')).toHaveLength(1);
		expect((darkOne.container.querySelector('.pip-image') as HTMLImageElement).src).toMatch(
			/dark\.png/
		);

		// Max power, Dark: all six pips carry the dark icon (not just the first).
		const darkSix = render(RuneCard, { rune: othala, onAction: vi.fn() });
		expect(darkSix.container.querySelectorAll('.pip-image')).toHaveLength(6);
		for (const pip of darkSix.container.querySelectorAll('.pip-image')) {
			expect((pip as HTMLImageElement).src).toMatch(/dark\.png/);
		}
		await expect
			.element(darkSix.getByRole('button', { name: /cross off othala, 6 dark power/i }))
			.toBeInTheDocument();
	});

	it('fires onAction with the rune id on click', async () => {
		const onAction = vi.fn();
		const screen = render(RuneCard, { rune: uruz, onAction });
		await screen.getByRole('button', { name: /cross off uruz/i }).click();
		expect(onAction).toHaveBeenCalledWith(6);
	});

	it('shows a restore label (with power + fill) and the chalk cross image when crossed', async () => {
		const screen = render(RuneCard, { rune: uruz, crossed: true, onAction: vi.fn() });
		// The power + fill suffix must survive on every aria-label branch, not just cross-off.
		await expect
			.element(screen.getByRole('button', { name: /restore uruz, 4 light power/i }))
			.toBeInTheDocument();
		const strikeout = screen.container.querySelector('.strikeout');
		expect(strikeout).toBeInstanceOf(HTMLImageElement);
		expect((strikeout as HTMLImageElement).src).toMatch(/chalk-cross\.png/);
	});

	it('exposes a cast-target label (with power + fill) when armed', async () => {
		const screen = render(RuneCard, { rune: uruz, armed: true, onAction: vi.fn() });
		await expect
			.element(screen.getByRole('button', { name: /select uruz as cast target, 4 light power/i }))
			.toBeInTheDocument();
	});

	it('armed + crossed: the chalk X stays so eliminations remain visible while casting', async () => {
		// A crossed rune is still legal to cast, but the player must keep sight of every
		// elimination while choosing — the strike stays even as the cast-target label wins.
		const screen = render(RuneCard, { rune: uruz, crossed: true, armed: true, onAction: vi.fn() });
		await expect
			.element(screen.getByRole('button', { name: /select uruz as cast target/i }))
			.toBeInTheDocument();
		const strikeout = screen.container.querySelector('.strikeout');
		expect(strikeout).toBeInstanceOf(HTMLImageElement);
		expect((strikeout as HTMLImageElement).src).toMatch(/chalk-cross\.png/);
	});

	it('marks only the selected target with the gold halo class', async () => {
		const selected = render(RuneCard, {
			rune: uruz,
			armed: true,
			selected: true,
			onAction: vi.fn()
		});
		expect(selected.container.querySelector('.rune-card')?.classList.contains('selected')).toBe(
			true
		);
		const armedOnly = render(RuneCard, { rune: uruz, armed: true, onAction: vi.fn() });
		expect(armedOnly.container.querySelector('.rune-card')?.classList.contains('selected')).toBe(
			false
		);
	});
});
