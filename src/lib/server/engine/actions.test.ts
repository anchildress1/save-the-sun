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
});
