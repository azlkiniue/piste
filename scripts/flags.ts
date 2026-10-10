/**
 * The app draws a round SVG flag per nationality from src/lib/assets/flags/<code>.svg (codes from
 * src/lib/countries.ts). That folder is generated: it holds copies of exactly the flags the dataset
 * uses, so the build ships no others. syncFlags runs on every dataset write (scripts/dataset.ts) —
 * a newly needed flag is copied in, one no longer used is dropped — and `bun run flags` runs it alone.
 *
 * Flags come from the circle-flags devDependency (MIT), except the few it lacks, drawn to match in
 * scripts/flags/ (East Germany). Czechoslovakia flew the flag Czechia kept, so cs copies cz.
 */
import { COUNTRY_CODE } from '../src/lib/countries';
import type { Person } from '../src/lib/types';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('src/lib/assets/flags/', ROOT);
const CUSTOM = new URL('scripts/flags/', ROOT);
const PACKAGE = new URL('node_modules/circle-flags/', ROOT);
const SAME_AS: Record<string, string> = { cs: 'cz' };

/** Make src/lib/assets/flags hold the flags `people` need — no more, no fewer. */
export async function syncFlags(people: Person[]) {
	const license = Bun.file(new URL('LICENSE.md', PACKAGE));
	if (!(await license.exists())) {
		console.warn("  ⚠ circle-flags isn't installed — run `bun install`, then `bun run flags`");
		return;
	}
	const used = new Set(people.flatMap((p) => p.nationalities.flatMap((n) => COUNTRY_CODE[n] ?? [])));
	const added: string[] = [];
	const missing: string[] = [];
	for (const code of [...used].sort()) {
		const custom = Bun.file(new URL(`${code}.svg`, CUSTOM));
		const source = (await custom.exists()) ? custom : Bun.file(new URL(`flags/${SAME_AS[code] ?? code}.svg`, PACKAGE));
		if (!(await source.exists())) {
			missing.push(code);
			continue;
		}
		if (await copyIfChanged(source, new URL(`${code}.svg`, OUT))) added.push(code);
	}
	const removed: string[] = [];
	for (const name of new Bun.Glob('*.svg').scanSync(Bun.fileURLToPath(OUT))) {
		const code = name.slice(0, -'.svg'.length);
		if (used.has(code)) continue;
		await Bun.file(new URL(name, OUT)).delete();
		removed.push(code);
	}
	await copyIfChanged(license, new URL('LICENSE.md', OUT));

	if (added.length || removed.length)
		console.log(`  flags: ${[...added.map((c) => `+${c}`), ...removed.map((c) => `−${c}`)].join(' ')}  (${used.size} in use)`);
	for (const code of missing)
		console.warn(`  ⚠ circle-flags has no "${code}" flag — draw one as scripts/flags/${code}.svg, then \`bun run flags\``);
}

async function copyIfChanged(source: Blob, target: URL): Promise<boolean> {
	const text = await source.text();
	const out = Bun.file(target);
	if ((await out.exists()) && (await out.text()) === text) return false;
	await Bun.write(out, text);
	return true;
}

if (import.meta.main) await syncFlags(await Bun.file(new URL('src/lib/data/astronauts.json', ROOT)).json());
