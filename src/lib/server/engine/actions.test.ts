import { describe, it, expect } from 'vitest';
import { handleAction } from './actions';

describe('Shared Action Interface', () => {
	it('handles Ask action stub', () => {
		const result = handleAction({ type: 'Ask', player: 'Human', question: 'Is it fire?' });
		expect(result.success).toBe(true);
		expect(result.message).toContain('Ask');
	});

	it('handles Cast action stub', () => {
		const result = handleAction({ type: 'Cast', player: 'Sköll', runeName: 'Sowilo' });
		expect(result.success).toBe(true);
		expect(result.message).toContain('Cast');
	});

	it('handles CrossOff action stub', () => {
		const result = handleAction({
			type: 'CrossOff',
			player: 'Human',
			runeId: 5,
			crossed: true
		});
		expect(result.success).toBe(true);
		expect(result.message).toContain('CrossOff');
	});

	it('handles React action stub', () => {
		const result = handleAction({ type: 'React', player: 'Sköll', reaction: 'Scry' });
		expect(result.success).toBe(true);
		expect(result.message).toContain('React');
	});

	it('names the acting player in the result', () => {
		expect(handleAction({ type: 'Ask', player: 'Sköll', question: 'fire?' }).message).toContain(
			'Sköll'
		);
	});
});
