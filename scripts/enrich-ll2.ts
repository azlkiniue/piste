/**
 * OPTIONAL, resumable LL2 enrichment — layers Launch Library 2 data (clean agency, agency type,
 * spacewalk counts, photos) onto src/lib/data/astronauts.json by matching on the shared Wikipedia
 * URL (falling back to name).
 *
 * LL2's free public tier allows only ~15 calls/hour, so this fetches the astronaut list in pages
 * of 100 (≈7 calls total), throttles between calls, and caches each page to scripts/cache/ll2/ so
 * re-runs are cheap and can resume after a rate-limit pause. The site is fully functional WITHOUT
 * ever running this — it only improves the agency dimension and adds spacewalk counts.
 *
 *   bun run enrich-ll2                  # fetch up to MAX_LL2_CALLS pages, merge, save
 *   MAX_LL2_CALLS=0 bun run enrich-ll2  # apply already-cached pages only (no network)
 *
 * NOTE: run AFTER `bun run update-data` (which rebuilds astronauts.json from scratch).
 */
import type { Person } from '../src/lib/types';

const UA = 'PisteDataPipeline/1.0 (https://github.com/piste; static people-in-space timeline)';
const LL2 = 'https://ll.thespacedevs.com/2.2.0/astronaut/';
const PAGE = 100;
const MAX_CALLS = Number(process.env.MAX_LL2_CALLS ?? 7);
const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('scripts/cache/ll2/', ROOT);
const DATA = new URL('src/lib/data/astronauts.json', ROOT);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const normName = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normWiki = (url?: string | null) =>
	url ? decodeURIComponent(url).replace(/\/$/, '').toLowerCase().replace(/^https?:\/\/[a-z-]+\.wikipedia\.org\/wiki\//, '') : null;

const AGENCY_RULES: [RegExp, string][] = [
	[/\bNASA\b|National Aeronautics and Space/i, 'NASA'],
	[/Roscosmos|Soviet space program|Russian Federal Space|\bRKA\b/i, 'Roscosmos'],
	[/European Space Agency|\bESA\b/i, 'ESA'],
	[/Japan Aerospace|\bJAXA\b|NASDA/i, 'JAXA'],
	[/Canadian Space Agency|\bCSA\b/i, 'CSA'],
	[/China National Space|China Manned Space|\bCNSA\b/i, 'CNSA'],
	[/Indian Space Research|\bISRO\b/i, 'ISRO'],
	[/SpaceX/i, 'SpaceX'],
	[/Blue Origin/i, 'Blue Origin'],
	[/Virgin Galactic/i, 'Virgin Galactic'],
	[/Axiom/i, 'Axiom Space']
];
const matchAgency = (labels: (string | undefined)[]) => {
	for (const l of labels) if (l) for (const [re, name] of AGENCY_RULES) if (re.test(l)) return name;
	return undefined;
};

interface LL2Astro {
	name: string;
	wiki?: string | null;
	agency?: { name?: string; abbrev?: string; type?: string } | null;
	profile_image_thumbnail?: string | null;
	spacewalks_count?: number;
}

async function loadRecords(): Promise<LL2Astro[]> {
	const records: LL2Astro[] = [];
	let offset = 0;
	let calls = 0;
	let total = Infinity;
	while (offset < total) {
		const cacheFile = new URL(`ll2-${offset}.json`, CACHE);
		let data: { count?: number; results?: LL2Astro[] };
		if (await Bun.file(cacheFile).exists()) {
			data = await Bun.file(cacheFile).json();
		} else if (calls < MAX_CALLS) {
			if (calls > 0) await sleep(3000);
			const res = await fetch(`${LL2}?limit=${PAGE}&offset=${offset}`, { headers: { 'User-Agent': UA } });
			if (res.status === 429 || res.status === 403) {
				console.warn(`  rate-limited (HTTP ${res.status}) at offset ${offset} — stopping; re-run later to resume.`);
				break;
			}
			if (!res.ok) {
				console.warn(`  LL2 ${res.status} at offset ${offset} — stopping.`);
				break;
			}
			data = await res.json();
			await Bun.write(cacheFile, JSON.stringify(data));
			calls++;
			console.log(`  fetched offset ${offset} (call ${calls}/${MAX_CALLS})`);
		} else {
			console.log(`  budget of ${MAX_CALLS} calls reached at offset ${offset}/${total}. Re-run to continue.`);
			break;
		}
		total = data.count ?? total;
		records.push(...(data.results ?? []));
		offset += PAGE;
	}
	console.log(`  ${records.length} LL2 records (${calls} network calls, rest cached)`);
	return records;
}

async function main() {
	console.log('▶ LL2 enrichment (optional)…');
	const records = await loadRecords();
	if (records.length === 0) {
		console.log('  nothing to apply (no cache, no budget). Skipping.');
		return;
	}

	const idx = new Map<string, LL2Astro>();
	for (const r of records) {
		const w = normWiki(r.wiki);
		if (w) idx.set(`w:${w}`, r);
		const n = normName(r.name);
		if (n && !idx.has(`n:${n}`)) idx.set(`n:${n}`, r);
	}

	const people: Person[] = await Bun.file(DATA).json();
	let agencyFixed = 0;
	let spacewalks = 0;
	let photos = 0;
	for (const p of people) {
		const r = (p.wiki ? idx.get(`w:${normWiki(p.wiki)}`) : undefined) ?? idx.get(`n:${normName(p.name)}`);
		if (!r) continue;
		const ag = matchAgency([r.agency?.abbrev, r.agency?.name]);
		if (ag && ag !== p.agency) {
			p.agency = ag;
			agencyFixed++;
		}
		if (r.agency?.type) p.agencyType = r.agency.type;
		if (typeof r.spacewalks_count === 'number') {
			p.spacewalks = r.spacewalks_count;
			spacewalks++;
		}
		if (!p.image && r.profile_image_thumbnail) {
			p.image = r.profile_image_thumbnail;
			photos++;
		}
	}

	await Bun.write(DATA, JSON.stringify(people));
	console.log(`✓ enriched: ${agencyFixed} agencies refined, ${spacewalks} spacewalk counts, ${photos} photos filled.`);
	console.log('  (re-run `bun run update-data` will reset this — run enrich-ll2 again afterwards.)');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
