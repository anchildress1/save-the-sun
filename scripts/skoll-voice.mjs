// Sköll's voice — the build-time TTS generator (R8). Reads his script (`src/lib/voice/skollScript.ts`),
// synthesizes each generated line with Gemini TTS (Algieba, director's-notes prompt), and writes the
// runtime clip as base64 PCM16 @ 24kHz to `static/audio/skoll/<id>.pcm.b64` — the exact format the
// browser speaker plays, so the director enqueues it with zero runtime synthesis. A `.wav` is written
// beside each clip for listening/QA (gitignored, never committed).
//
//   node scripts/skoll-voice.mjs --list            print the clips that would be generated (no calls)
//   node scripts/skoll-voice.mjs --sample [id]     synthesize ONE clip (default wrong-cast-1) to vet the voice
//   node scripts/skoll-voice.mjs --sample --voice Charon   vet a different prebuilt voice (QA-only output)
//   node scripts/skoll-voice.mjs                    synthesize every missing generated clip
//   node scripts/skoll-voice.mjs --force           re-synthesize all generated clips
//
// Needs a GEMINI_API_KEY (read from .env) and the network, so it never runs in CI — the clips ship as
// committed static assets. Node strips the TS types from the imported script module natively.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
import { GoogleGenAI, Modality } from '@google/genai';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'static', 'audio', 'skoll');
const SAMPLE_RATE = 24_000; // SPEAKER_SAMPLE_RATE — the rate the browser speaker decodes at

// Load .env into process.env so the SDK gets the key (local runs only).
function loadDotEnv() {
	try {
		for (const raw of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
			const line = raw.replace(/^\s*export\s+/, '').trim();
			if (!line || line.startsWith('#')) continue;
			const eq = line.indexOf('=');
			if (eq === -1) continue;
			const key = line.slice(0, eq).trim();
			if (!/^[A-Z0-9_]+$/.test(key) || process.env[key] !== undefined) continue;
			let val = line.slice(eq + 1).trim();
			if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
			else val = val.replace(/\s+#.*$/, '');
			process.env[key] = val;
		}
	} catch {
		/* no .env — the synth path fails loudly below on a missing key */
	}
}
loadDotEnv();

const { SKOLL_SCRIPT, SKOLL_VOICE, TTS_MODEL, ttsPrompt, generatedClips } = await loadScript();

async function loadScript() {
	const script = await import(
		pathToFileURL(path.join(ROOT, 'src', 'lib', 'voice', 'skollScript.ts')).href
	);
	// config.ts holds the voice + model constants; import them from the same source the app uses.
	const config = await import(
		pathToFileURL(path.join(ROOT, 'src', 'lib', 'voice', 'config.ts')).href
	);
	return { ...script, SKOLL_VOICE: config.SKOLL_VOICE, TTS_MODEL: config.TTS_MODEL };
}

// --- arg parsing ---------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const list = argv.includes('--list');
const force = argv.includes('--force');
const sampleFlag = argv.includes('--sample');
// QA voice override — only meaningful with --sample, where it writes voice-suffixed QA files instead
// of the canonical clip, so swapping voices to compare never clobbers the committed library.
const voiceIdx = argv.indexOf('--voice');
const voiceArg = voiceIdx >= 0 ? argv[voiceIdx + 1] : null;
const voice = voiceArg ?? SKOLL_VOICE;
// The positional clip id — skip flags and the value consumed by --voice.
const explicitId = argv.find((a, i) => !a.startsWith('--') && i !== voiceIdx + 1);

const allClips = generatedClips();

if (list) {
	console.log(`Generated buckets (P2) — ${allClips.length} clips:\n`);
	for (const bucket of Object.values(SKOLL_SCRIPT)) {
		const tag = bucket.generated ? 'GEN ' : 'skip';
		console.log(`[${tag}] ${bucket.id} — ${bucket.label}`);
		if (bucket.generated)
			for (const v of bucket.variants) console.log(`        ${v.id}: "${v.text}"`);
	}
	process.exit(0);
}

let clips;
if (sampleFlag) {
	const id = explicitId ?? 'wrong-cast-1';
	const clip = allClips.find((c) => c.id === id);
	if (!clip) {
		console.error(`No generated clip with id "${id}". Try --list.`);
		process.exit(1);
	}
	clips = [clip];
} else {
	clips = force ? allClips : allClips.filter((c) => !existsSync(clipPath(c.id)));
}

if (clips.length === 0) {
	console.log('Nothing to generate — every clip already exists (use --force to redo).');
	process.exit(0);
}

if (!process.env.GEMINI_API_KEY) {
	console.error('GEMINI_API_KEY is not set (.env or env). Cannot synthesize Sköll.');
	process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

// 3 backoff attempts (408/429/5xx) — the TTS preview model 500s occasionally; one blip shouldn't drop a line.
const ai = new GoogleGenAI({
	apiKey: process.env.GEMINI_API_KEY,
	httpOptions: { retryOptions: { attempts: 3 } }
});

// A QA voice override writes voice-suffixed files only, never the canonical clip — comparing voices
// can't clobber the committed library, and the loud guard below stops a stray --voice on a full run.
const qa = voiceArg !== null;
if (qa && !sampleFlag) {
	console.error(
		'--voice is for vetting a single --sample; refuse to write the library in a non-default voice.'
	);
	process.exit(1);
}

console.log(`Synthesizing ${clips.length} clip(s) with ${voice} (${TTS_MODEL})…\n`);
let ok = 0;
for (const clip of clips) {
	try {
		const pcm = await synthesize(clip.text);
		writeFileSync(wavPath(clip.id), wavFromPcm(pcm));
		if (!qa) writeFileSync(clipPath(clip.id), pcm.toString('base64'));
		ok++;
		console.log(`  ✓ ${clip.id}  "${clip.text}"  (${(pcm.length / 1024).toFixed(0)} KB PCM)`);
	} catch (err) {
		console.error(`  ✗ ${clip.id}: ${err instanceof Error ? err.message : String(err)}`);
	}
}
console.log(`\nDone: ${ok}/${clips.length} written to ${path.relative(ROOT, OUT_DIR)}`);
if (sampleFlag && ok > 0) {
	console.log(`\nListen: open ${path.relative(ROOT, wavPath(clips[0].id))}`);
}

// --- synthesis -----------------------------------------------------------------------------------
function clipPath(id) {
	return path.join(OUT_DIR, `${id}.pcm.b64`);
}
// QA runs suffix the WAV with the voice so two voices' samples sit side by side for picking.
function wavPath(id) {
	return path.join(OUT_DIR, qa ? `${id}.${voice}.wav` : `${id}.wav`);
}

// One TTS call → raw PCM16LE bytes. The model may answer in one part or several; concatenate the
// decoded bytes so a chunked answer joins correctly (base64 strings cannot be concatenated directly).
async function synthesize(text) {
	const res = await ai.models.generateContent({
		model: TTS_MODEL,
		contents: [{ role: 'user', parts: [{ text: ttsPrompt(text) }] }],
		config: {
			responseModalities: [Modality.AUDIO],
			speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
		}
	});
	const parts = res.candidates?.[0]?.content?.parts ?? [];
	const buffers = parts
		.map((p) => p.inlineData?.data)
		.filter((d) => typeof d === 'string')
		.map((d) => Buffer.from(d, 'base64'));
	if (buffers.length === 0) throw new Error('no audio in TTS response');
	return trimSilence(Buffer.concat(buffers));
}

// Trim leading/trailing near-silence so a clip starts on the growl (snappier than the model's padded
// dead air — R8 wants no perceptible delay) without clipping the consonant onset. PCM16LE mono.
function trimSilence(pcm) {
	const THRESHOLD = 300; // |sample| below this is silence at 16-bit
	const PAD = Math.round(SAMPLE_RATE * 0.04) * 2; // keep 40ms either side so attacks/tails breathe
	const n = pcm.length / 2;
	let first = n;
	let last = 0;
	for (let i = 0; i < n; i++) {
		if (Math.abs(pcm.readInt16LE(i * 2)) > THRESHOLD) {
			if (i < first) first = i;
			last = i;
		}
	}
	if (first > last) return pcm; // all silence — leave it rather than return an empty clip
	const start = Math.max(0, first * 2 - PAD);
	const end = Math.min(pcm.length, last * 2 + PAD);
	return pcm.subarray(start, end);
}

// Minimal 44-byte WAV header around the PCM16 mono so the QA file plays in any audio app.
function wavFromPcm(pcm) {
	const header = Buffer.alloc(44);
	const byteRate = SAMPLE_RATE * 2; // mono, 16-bit
	header.write('RIFF', 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16); // PCM chunk size
	header.writeUInt16LE(1, 20); // PCM format
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(2, 32); // block align
	header.writeUInt16LE(16, 34); // bits per sample
	header.write('data', 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}
