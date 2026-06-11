// Prints the category scores from the newest LHCI report — `lhci autorun` only prints
// assertion pass/fail and buries the numbers in .lighthouseci/.
import { readdirSync, readFileSync } from 'node:fs';

const dir = '.lighthouseci';
const newest = readdirSync(dir)
	.filter((f) => f.startsWith('lhr-') && f.endsWith('.json'))
	.sort()
	.at(-1);
if (!newest) {
	console.error(`No Lighthouse reports found in ${dir}/ — run \`make perf\` first.`);
	process.exit(1);
}

const lhr = JSON.parse(readFileSync(`${dir}/${newest}`, 'utf8'));
console.log(`\nLighthouse — ${lhr.finalDisplayedUrl} (${lhr.configSettings.formFactor})`);
for (const category of Object.values(lhr.categories)) {
	const score = Math.round(category.score * 100);
	const mark = score === 100 ? '★' : score >= 90 ? '✓' : '✗';
	console.log(`  ${mark} ${category.title.padEnd(16)} ${score}`);
}
