// Oracle pipeline types: free text → one structured Query (or a refusal), voiced.

import type { Query } from '$lib/server/engine/queries';
import type { InvalidReason } from '$lib/server/engine/engine';

export type RefusalClass =
	| 'mixed-type'
	| 'secret-seeking'
	| 'prompt-injection'
	| 'negation'
	| 'unparseable'
	| 'empty'
	| 'engine-error';

export interface QueryInterpretation {
	kind: 'query';
	query: Query;
	paraphrase: string;
}

export interface RefusalInterpretation {
	kind: 'refusal';
	refusal: Exclude<RefusalClass, 'empty'>;
}

export type Interpretation = QueryInterpretation | RefusalInterpretation;

/** The LLM seam: free text in, one interpretation out. */
export type Interpret = (question: string) => Promise<Interpretation>;

export type OracleResult =
	| {
			ok: true;
			echo: string;
			query: Query;
			answer: string;
			affirmative: boolean;
			turnConsumed: true;
			// The dramatized, server-signed line to voice instead of the deterministic `answer` (ttd:17).
			// Absent when flair was skipped or fell back — the client then voices the `answer` template.
			// Structurally an `authored` LineDescriptor (not imported, to avoid a types↔lines cycle).
			voiced?: { kind: 'authored'; text: string; voice: string; sig: string };
	  }
	| { ok: false; reason: 'refusal'; refusal: RefusalClass; line: string; turnConsumed: false }
	| { ok: false; reason: 'engine'; engineReason: InvalidReason; turnConsumed: false };
