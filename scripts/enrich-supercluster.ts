/**
 * Layer 3 enrichment — Supercluster (https://www.supercluster.com/astronauts).
 *
 * Runs AFTER `update-data` and `enrich-ll2`. Supercluster's "Astronaut Database" (793 humans who
 * have reached space) is fetched from its public Sanity backend and used to fill the gaps our
 * pipeline leaves — never to wholesale-override Launch Library 2's careful nationality/agency work.
 * Four narrow jobs:
 *
 *  - GENDER — Wikidata/LL2 leave ~45 recent suborbital tourists genderless; Supercluster lists a
 *    gender for nearly everyone, so we fill (only) the Unknowns. It never overrides a known value.
 *
 *  - AGENCY — gaps-and-fixes only, three rules:
 *      1. Space Adventures — the orbital tourists it brokered (Tito, Simonyi, Shuttleworth, Olsen,
 *         Ansari, R. Garriott, Laliberté) plus the dearMoon pair (Maezawa, Hirano — whom Wikidata
 *         mis-tagged as JAXA) become "Space Adventures": the company that actually flew them.
 *      2. Commercial gap-fill — where we still read "Unknown" and Supercluster names a *commercial*
 *         provider (Virgin Galactic, Blue Origin…), adopt it. Government operators are deliberately
 *         NOT used to fill: a self-funded flier on a Soyuz isn't "Roscosmos", so Toyohiro Akiyama —
 *         the TBS journalist Supercluster files under "CCCP" — stays Unknown (the same principle
 *         that leaves early tourists agency-less rather than inheriting a nation default).
 *      3. Curated overrides — five individually-reviewed conflicts where Supercluster's
 *         employer/operator beats our national default (see AGENCY_OVERRIDE). Every *other* LL2
 *         agency is kept: a Saudi/Emirati/Israeli national on an Axiom or SpaceX seat keeps their
 *         national agency, by design (Supercluster credits the launch operator; we credit the nation).
 *
 *  - BACKFILL — the two SpaceShipOne pilots, Michael Melvill & Brian Binnie (the first commercial
 *    astronauts, 2004), whom our LL2 backfill filters drop. Their well-documented suborbital flights
 *    are added from the historical record (Supercluster stores no per-flight dates).
 *
 * Source: Supercluster, via its public Sanity API — no key, no rate limit. Responses are cached under
 * scripts/cache/supercluster (gitignored, rebuildable); `SC_MAX_CALLS=0 bun run enrich-supercluster`
 * replays the cache offline. Re-running is idempotent and safe.
 */
import type { Flight, Gender, Meta, Person, Status } from '../src/lib/types';

const UA = 'PisteDataPipeline/1.0 (https://github.com/piste; static people-in-space timeline)';
// Supercluster's Sanity project (read from its astronaut page: cdn.sanity.io/images/2vtv415l/production).
const PROJECT = process.env.SC_PROJECT_ID ?? '2vtv415l';
const DATASET = process.env.SC_DATASET ?? 'production';
const API = `https://${PROJECT}.apicdn.sanity.io/v2021-10-21/data/query/${DATASET}`;
// One GROQ query: every human who has reached space, with the few fields we consume.
const GROQ =
	'*[_type=="astronaut" && speciesGroup=="human"]{_id,name,gender,birthdate,deathdate,astroNumber,' +
	'inSpace,"slug":slug.current,"image":image.asset->url,"agencies":agencies[]->name,"nations":nations[]->name}';

const MAX_CALLS = Number(process.env.SC_MAX_CALLS ?? Infinity); // 0 = offline, replay cache only

const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('scripts/cache/supercluster/humans.json', ROOT);
const DATA = new URL('src/lib/data/astronauts.json', ROOT);
const META = new URL('src/lib/data/meta.json', ROOT);

// ---------------------------------------------------------------- helpers
// Honorifics/suffixes Supercluster prepends ("Dr.", "H.E.") or appends ("Jr.") that our names omit —
// stripped before normalizing so "Dr. Chris Boshuizen" matches "Chris Boshuizen".
const HONORIFIC = /\b(?:dr|mr|mrs|ms|prof|sir|dame|hon|h\.?e|jr|sr|ii|iii|iv)\b\.?/gi;
const normName = (s: string) =>
	(s ?? '')
		.replace(HONORIFIC, ' ')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const slugify = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Supercluster's verbose agency labels → our canonical short names. Order matters (first match wins).
const AGENCY_RULES: [RegExp, string][] = [
	[/Space Adventures/i, 'Space Adventures'],
	[/Scaled Composites/i, 'Scaled Composites'],
	[/\bNASA\b/i, 'NASA'],
	[/Roscosmos|CCCP|Soviet|\bSSAU\b/i, 'Roscosmos'],
	[/European Space Agency|\bESA\b|\bCNES\b|\bDLR\b|Italian Space|\bASI\b/i, 'ESA'],
	[/Japan Aerospace|\bJAXA\b|\bNASDA\b/i, 'JAXA'],
	[/Canadian Space|\bCSA\b/i, 'CSA'],
	[/China|\bCASC\b|\bCMS\b|\bCNSA\b/i, 'CNSA'],
	[/Indian Space|\bISRO\b/i, 'ISRO'],
	[/SpaceX/i, 'SpaceX'],
	[/Blue Origin/i, 'Blue Origin'],
	[/Virgin Galactic/i, 'Virgin Galactic'],
	[/Axiom/i, 'Axiom Space']
];
const canonicalAgency = (names: string[]): string | undefined => {
	for (const n of names) for (const [re, name] of AGENCY_RULES) if (n && re.test(n)) return name;
	return undefined;
};
// Commercial providers we're willing to adopt as a fill for an agency-less flier. A *government*
// operator (Roscosmos/NASA…) is never used to fill an Unknown — that's a nation-default in disguise.
const COMMERCIAL = new Set(['Space Adventures', 'Scaled Composites', 'SpaceX', 'Blue Origin', 'Virgin Galactic', 'Axiom Space']);
const agencyType = (agency: string) => (COMMERCIAL.has(agency) ? 'Commercial' : 'Government');

// Five individually-reviewed conflicts (keyed by normalized name) where Supercluster's
// employer/operator is the better attribution than our national default. Each equals Supercluster's
// own mapped agency; the rest of the 24 nation-vs-operator conflicts keep our national agency.
const AGENCY_OVERRIDE: Record<string, string> = {
	'anna menon': 'SpaceX', // SpaceX lead space-operations engineer on Polaris Dawn (was a stale "NASA" tag)
	'tibor kapu': 'Axiom Space', // Hungary's HUNOR seat, flew commercially on Axiom-4
	'walter villadei': 'Axiom Space', // Italian Air Force, but flew Galactic 01 + Axiom-3 commercially
	'franz viehbock': 'Roscosmos', // Austromir-91 guest cosmonaut on Soyuz TM-13
	'sol alan stern': 'Virgin Galactic' // SwRI researcher, flew Galactic 05
};

// Supercluster nation label → our country name + ISO 3166-1 alpha-2 (only the values backfill needs).
const SC_NATION: Record<string, [string, string]> = {
	'United States of America': ['United States', 'us']
};
const scGender = (g: unknown): Gender | null => (g === 'male' || g === 'female' ? g : null);

// The first commercial astronauts. LL2's backfill drops both (one isn't catalogued, the other is on
// LL2's "never reached space" list though SS1 flight 17P touched 112 km), so we add them from the
// historical record. All three flights are suborbital and land the same day they launch.
const SPACESHIPONE: Record<string, Flight[]> = {
	'Michael W. Melvill': [
		{ mission: 'SpaceShipOne flight 15P', launch: '2004-06-21', landing: '2004-06-21', ongoing: false, orbital: false, approx: false },
		{ mission: 'SpaceShipOne flight 16P', launch: '2004-09-29', landing: '2004-09-29', ongoing: false, orbital: false, approx: false }
	],
	'William B. Binnie': [
		{ mission: 'SpaceShipOne flight 17P', launch: '2004-10-04', landing: '2004-10-04', ongoing: false, orbital: false, approx: false }
	]
};

interface ScAstro {
	_id: string;
	name: string;
	gender: string | null;
	birthdate: string | null;
	deathdate: string | null;
	astroNumber: string | null;
	inSpace: boolean | null;
	slug: string | null;
	image: string | null;
	agencies: string[] | null;
	nations: string[] | null;
}

// ---------------------------------------------------------------- fetch (network → cache fallback)
async function fetchHumans(): Promise<ScAstro[]> {
	const cached = (await Bun.file(CACHE).exists()) ? ((await Bun.file(CACHE).json()) as ScAstro[]) : null;
	if (MAX_CALLS < 1) {
		if (cached) {
			console.log(`  offline (SC_MAX_CALLS=0): replaying ${cached.length} cached humans.`);
			return cached;
		}
		console.log('  offline and no cache — nothing to apply. Skipping.');
		return [];
	}
	try {
		const res = await fetch(`${API}?query=${encodeURIComponent(GROQ)}`, { headers: { 'User-Agent': UA } });
		if (!res.ok) throw new Error(`Sanity HTTP ${res.status}`);
		const json = (await res.json()) as { result: ScAstro[] };
		const humans = json.result ?? [];
		await Bun.write(CACHE, JSON.stringify(humans));
		console.log(`  fetched ${humans.length} humans from Supercluster (cached).`);
		return humans;
	} catch (e) {
		if (cached) {
			console.log(`  fetch failed (${(e as Error).message}); falling back to ${cached.length} cached humans.`);
			return cached;
		}
		throw e;
	}
}

// ---------------------------------------------------------------- matching
type Index = Map<string, ScAstro[]>;
const uniq = (m: Index, k: string) => {
	const a = m.get(k);
	return a && a.length === 1 ? a[0] : undefined;
};
const surname = (n: string) => n.split(' ').at(-1) ?? '';
const initialKey = (n: string) => {
	const t = n.split(' ');
	return t.length >= 2 && t[0] ? `${t.at(-1)}|${t[0][0]}` : null;
};
/** Find the Supercluster record for one of our people: exact name → birthdate+surname → birthdate
 *  (unique, matching first initial) → surname+first-initial (unique). The birthdate rungs catch
 *  spelling variants the name index misses (Rozhdestvensky/Rozhdestvenski). */
function buildFinder(records: ScAstro[]) {
	const byName: Index = new Map();
	const byDob: Index = new Map();
	const byKey: Index = new Map();
	const push = (m: Index, k: string, r: ScAstro) => m.set(k, [...(m.get(k) ?? []), r]);
	for (const r of records) {
		push(byName, normName(r.name), r);
		if (r.birthdate) push(byDob, r.birthdate, r);
		const k = initialKey(normName(r.name));
		if (k) push(byKey, k, r);
	}
	return (p: Person): ScAstro | undefined => {
		const n = normName(p.name);
		const exact = uniq(byName, n);
		if (exact) return exact;
		if (p.dob) {
			const cand = byDob.get(p.dob) ?? [];
			const bySur = cand.filter((r) => surname(normName(r.name)) === surname(n));
			if (bySur.length === 1) return bySur[0];
			if (cand.length === 1 && initialKey(normName(cand[0].name)) === initialKey(n)) return cand[0];
		}
		const k = initialKey(n);
		return k ? uniq(byKey, k) : undefined;
	};
}

// ---------------------------------------------------------------- backfill
function buildBackfill(records: ScAstro[], people: Person[], matched: Set<string>, usedSlugs: Set<string>): Person[] {
	const have = new Set(people.map((p) => `${normName(p.name)}|${p.dob ?? ''}`));
	const added: Person[] = [];
	for (const r of records) {
		const flights = SPACESHIPONE[r.name];
		if (!flights) continue; // curated backfill — only the two SpaceShipOne pilots
		if (matched.has(r._id)) continue;
		if (have.has(`${normName(r.name)}|${r.birthdate ?? ''}`)) continue; // already present under this name+dob
		const dod = r.deathdate ? r.deathdate.slice(0, 10) : null;
		const [nationality, countryCode] = SC_NATION[(r.nations ?? [])[0] ?? ''] ?? ['Unknown', null as unknown as string];
		let slug = slugify(r.name) || `sc-${r.astroNumber}`;
		if (usedSlugs.has(slug)) slug = `${slug}-sc-${r.astroNumber}`;
		usedSlugs.add(slug);
		const agency = canonicalAgency(r.agencies ?? []) ?? 'Unknown';
		added.push({
			id: `sc-${r.astroNumber}`,
			qid: null,
			name: r.name,
			slug,
			nationality,
			countryCode,
			gender: scGender(r.gender) ?? 'unknown',
			agency,
			status: dod ? 'deceased' : 'living',
			dob: r.birthdate ? r.birthdate.slice(0, 10) : null,
			dod,
			wiki: null,
			image: r.image ?? null,
			totalDaysInSpace: 0,
			firstLaunch: flights[0].launch,
			lastLanding: flights.at(-1)!.landing,
			flights,
			spacewalks: 0,
			agencyType: agencyType(agency)
		});
	}
	return added;
}

// ---------------------------------------------------------------- meta
/** Recompute counts/coverage from the enriched people and register Supercluster as a source, so the
 *  About page stays consistent. Timestamps and the in-space cross-check list are left to update-data. */
async function refreshMeta(people: Person[]) {
	if (!(await Bun.file(META).exists())) return;
	const meta: Meta = await Bun.file(META).json();
	const flights = people.reduce((n, p) => n + p.flights.length, 0);
	const orbital = people.reduce((n, p) => n + p.flights.filter((f) => f.orbital).length, 0);
	const approx = people.reduce((n, p) => n + p.flights.filter((f) => f.approx).length, 0);
	meta.counts = {
		people: people.length,
		flights,
		inSpace: people.filter((p) => p.status === 'in-space').length,
		orbital,
		suborbital: flights - orbital,
		countries: new Set(people.map((p) => p.nationality)).size,
		agencies: new Set(people.map((p) => p.agency)).size
	};
	meta.coverage = {
		genderKnown: people.filter((p) => p.gender !== 'unknown').length,
		withImage: people.filter((p) => p.image).length,
		withAgency: people.filter((p) => p.agency !== 'Unknown').length,
		realLandingFlights: flights - approx,
		approxFlights: approx
	};
	if (!meta.sources.some((s) => /supercluster/i.test(s.url))) {
		meta.sources.push({ name: 'Supercluster', url: 'https://www.supercluster.com/astronauts', license: '© Supercluster (editorial)' });
	}
	await Bun.write(META, JSON.stringify(meta, null, 2));
}

// ---------------------------------------------------------------- pipeline
async function main() {
	console.log('▶ Supercluster enrichment (gender + agency gap-fills, backfills the SpaceShipOne pilots)…');
	const records = await fetchHumans();
	if (records.length === 0) return;

	const find = buildFinder(records);
	const people: Person[] = await Bun.file(DATA).json();
	const usedSlugs = new Set(people.map((p) => p.slug));
	const matched = new Set<string>();

	let genderFilled = 0,
		spaceAdventures = 0,
		commercialFilled = 0,
		overridden = 0,
		unmatched = 0;
	const agencyChanges: { name: string; from: string; to: string }[] = [];

	for (const p of people) {
		const r = find(p);
		if (!r) {
			unmatched++;
			continue;
		}
		matched.add(r._id);

		// ----- Gender: fill Unknowns only, never override -----
		if (p.gender === 'unknown') {
			const g = scGender(r.gender);
			if (g) {
				p.gender = g;
				genderFilled++;
			}
		}

		// ----- Agency: Space Adventures → curated override → commercial gap-fill (else keep ours) -----
		const names = r.agencies ?? [];
		const canon = canonicalAgency(names);
		let next: string | undefined;
		let bucket: 'sa' | 'override' | 'fill' | undefined;
		if (names.some((n) => /Space Adventures/i.test(n))) {
			next = 'Space Adventures';
			bucket = 'sa';
		} else if (AGENCY_OVERRIDE[normName(p.name)]) {
			next = AGENCY_OVERRIDE[normName(p.name)];
			bucket = 'override';
		} else if (p.agency === 'Unknown' && canon && COMMERCIAL.has(canon)) {
			next = canon;
			bucket = 'fill';
		}
		if (next && next !== p.agency) {
			agencyChanges.push({ name: p.name, from: p.agency, to: next });
			p.agency = next;
			p.agencyType = agencyType(next);
			if (bucket === 'sa') spaceAdventures++;
			else if (bucket === 'override') overridden++;
			else commercialFilled++;
		}
	}

	// ----- Backfill the two SpaceShipOne pilots -----
	const before = people.length;
	const added = buildBackfill(records, people, matched, usedSlugs);
	people.push(...added);

	people.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));
	await Bun.write(DATA, JSON.stringify(people));
	await refreshMeta(people);

	const stillUnknownGender = people.filter((p) => p.gender === 'unknown').length;
	console.log('\n──────── Supercluster enrichment report ────────');
	console.log(`matched:           ${before - unmatched}/${before}  (unmatched ${unmatched})`);
	console.log(`gender filled:     ${genderFilled}  (${stillUnknownGender} still Unknown)`);
	console.log(`Space Adventures:  ${spaceAdventures}  (tourists + dearMoon pair, off JAXA/Unknown)`);
	console.log(`commercial fills:  ${commercialFilled}  (Unknown → commercial provider)`);
	console.log(`curated overrides: ${overridden}  (${Object.keys(AGENCY_OVERRIDE).length} reviewed conflicts)`);
	console.log(`backfilled:        +${added.length}  (${before} → ${people.length})  ${added.map((p) => p.name).join(', ')}`);
	if (agencyChanges.length) {
		console.log('agency changes:');
		for (const c of agencyChanges.sort((a, b) => a.to.localeCompare(b.to) || a.name.localeCompare(b.name)))
			console.log(`   ${c.name}: ${c.from} → ${c.to}`);
	}
	console.log('  (re-running `bun run update-data` resets this — run enrich-ll2 then enrich-supercluster afterwards.)');
	console.log('────────────────────────────────────────────────\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
