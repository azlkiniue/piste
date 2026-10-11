/**
 * Layer 3 enrichment — Supercluster (https://www.supercluster.com/astronauts).
 *
 * Runs AFTER `update-data` and `enrich-ll2`. Supercluster's "Astronaut Database" (~800 humans who
 * have reached space) is fetched from its public Sanity backend. It supplies everyone's NATIONALITIES
 * and otherwise fills the gaps our pipeline leaves — never wholesale-overriding Launch Library 2's
 * agency work. Four jobs:
 *
 *  - NATIONALITIES — Supercluster lists every nation a person flew for, defunct ones included (USSR,
 *    Czechoslovakia), plus second citizenships (Foale: US + UK) — where LL2 gives one present-day
 *    demonym, often a birthplace (Popovich → Ukrainian). Its list replaces ours, mapped onto
 *    src/lib/countries.ts (Puerto Rico → United States; the EU and "Nation Undisclosed" dropped, so
 *    LL2's value stands). Then scripts/nationality.ts settles it: flight dates decide former states
 *    (Soviet vs Russian — Supercluster misses Titov's Russian flights — and West German vs German), and
 *    a researched list fixes the rest.
 *
 *  - GENDER — Wikidata/LL2 leave ~45 recent suborbital tourists genderless; Supercluster lists a
 *    gender for nearly everyone, so we fill (only) the Unknowns. It never overrides a known value.
 *
 *  - AGENCIES — gaps only, two rules, then a cross-check:
 *      1. Space Adventures — the orbital tourists it brokered (Tito, Simonyi, Shuttleworth, Olsen,
 *         Ansari, R. Garriott, Laliberté) plus the dearMoon pair (Maezawa, Hirano — whom Wikidata
 *         mis-tagged as JAXA) become "Space Adventures": the company that actually flew them.
 *      2. Commercial gap-fill — where we still have no agency and Supercluster names a *commercial*
 *         provider (Virgin Galactic, Blue Origin…), adopt it. Government operators are deliberately
 *         NOT used to fill: a self-funded flier on a Soyuz isn't the host's (a nation default in
 *         disguise). Akiyama, the TBS journalist, is settled in scripts/agency.ts instead.
 *      Supercluster lists several agencies per person, but mixes in who *selected* someone (NASDA for
 *      astronauts who only flew for JAXA, CNES for Pesquet) and the launch provider (SpaceX for every
 *      Crew Dragon flier). So its lists aren't copied; scripts/agency.ts settles everyone, and the report
 *      names anyone Supercluster gives an agency we don't — after dating its list flight by flight and
 *      dropping launch providers — for review there.
 *
 *  - BACKFILL — the two SpaceShipOne pilots, Michael Melvill & Brian Binnie (the first commercial
 *    astronauts, 2004), whom our LL2 backfill filters drop. Their well-documented suborbital flights
 *    are added from the historical record (Supercluster stores no per-flight dates).
 *
 * Source: Supercluster, via its public Sanity API — no key, no rate limit. Responses are cached under
 * scripts/cache/supercluster (gitignored, rebuildable); `SC_MAX_CALLS=0 bun run enrich-supercluster`
 * replays the cache offline. Re-running is idempotent and safe.
 */
import { COUNTRY_CODE } from '../src/lib/countries';
import type { Flight, Gender, Meta, Person } from '../src/lib/types';
import { agencyOf, attributeAgencies, isResearched, settleAgencies, unmatchedResearched as unmatchedAgencies } from './agency';
import { DATA, paddedDate, writeAstronauts } from './dataset';
import { settleNationalities, unmatchedResearched } from './nationality';

const UA = 'PisteDataPipeline/1.0 (https://github.com/piste; static people-in-space timeline)';
// Supercluster's Sanity project (read from its astronaut page: cdn.sanity.io/images/2vtv415l/production).
const PROJECT = process.env.SC_PROJECT_ID ?? '2vtv415l';
const DATASET = process.env.SC_DATASET ?? 'production';
const API = `https://${PROJECT}.apicdn.sanity.io/v2023-10-01/data/query/${DATASET}`;
// One GROQ query: every human who has reached space, with the few fields we consume.
const GROQ =
	'*[_type=="astronaut" && speciesGroup=="human"]{_id,name,gender,birthdate,deathdate,astroNumber,' +
	'inSpace,"slug":slug.current,"image":image.asset->url,"agencies":agencies[]->name,"nations":nations[]->name}';

const MAX_CALLS = Number(process.env.SC_MAX_CALLS ?? Infinity); // 0 = offline, replay cache only

const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('scripts/cache/supercluster/humans.json', ROOT);
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

// Supercluster agency labels that name no agency in src/lib/agencies.ts, deliberately; any other label
// that maps to none is reported, to be added to scripts/agency.ts.
const SC_NOT_AGENCIES = new Set([
	'Polaris', // Isaacman's programme — the Polaris Dawn crew flew SpaceX's mission
	'Boeing', // Starliner's maker; its crew flew for NASA
	'China Aerospace Science and Technology Corporation (CASC)', // some taikonauts' employer; CMSA runs the programme
	'KARI' // Yi So-yeon flew for the Korean Astronaut Program; she joined KARI's research staff after
]);
const unknownAgencies = new Set<string>();
/** A record's agencies as our keys, in Supercluster's order. */
function scAgencies(r: ScAstro): string[] {
	const out: string[] = [];
	for (const n of r.agencies ?? []) {
		const key = agencyOf(n);
		if (key) {
			if (!out.includes(key)) out.push(key);
		} else if (!SC_NOT_AGENCIES.has(n)) unknownAgencies.add(n);
	}
	return out;
}
// Commercial providers we're willing to adopt as a fill for an agency-less flier. A *government*
// operator (Roscosmos/NASA…) is never used to fill a blank — that's a nation-default in disguise.
const COMMERCIAL = new Set(['Space Adventures', 'Scaled Composites', 'SpaceX', 'Blue Origin', 'Virgin Galactic', 'Axiom Space']);

// Supercluster nation labels that differ from the names in src/lib/countries.ts. null drops a label
// that isn't a sovereign state; any other label we don't know is reported and skipped.
const SC_NATION: Record<string, string | null> = {
	'United States of America': 'United States',
	USSR: 'Soviet Union',
	'Puerto Rico': 'United States', // a US territory — Puerto Ricans are US citizens
	'European Union': null, // listed beside a member state (Manenti: Italy)
	'Nation Undisclosed': null // a placeholder — LL2's value stands
};
const unknownNations = new Set<string>();
/** A record's nations as our country names, in Supercluster's order. */
function scNations(r: ScAstro): string[] {
	const out: string[] = [];
	for (const n of r.nations ?? []) {
		const c = n in SC_NATION ? SC_NATION[n] : n;
		if (c && COUNTRY_CODE[c]) {
			if (!out.includes(c)) out.push(c);
		} else if (c) unknownNations.add(n);
	}
	return out;
}
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
 *  (unique, matching first initial) → birthdate+any shared name token → surname+first-initial (unique).
 *  The birthdate rungs catch spellings the name index misses (Gidzenko/Guidzenko, Muhammed Faris/
 *  Muhammed Faris Al-Aqidi); an exact birth date keeps the looser ones tight. */
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
			const cand = byDob.get(paddedDate(p.dob)) ?? []; // Supercluster's form of a month- or year-only date
			const bySur = cand.filter((r) => surname(normName(r.name)) === surname(n));
			if (bySur.length === 1) return bySur[0];
			if (cand.length === 1 && initialKey(normName(cand[0].name)) === initialKey(n)) return cand[0];
			const tokens = new Set(n.split(' ').filter((t) => t.length >= 3));
			const byToken = cand.filter((r) => normName(r.name).split(' ').some((t) => tokens.has(t)));
			if (byToken.length === 1) return byToken[0];
		}
		const k = initialKey(n);
		return k ? uniq(byKey, k) : undefined;
	};
}

// ---------------------------------------------------------------- backfill
function buildBackfill(records: ScAstro[], people: Person[], matched: Set<string>, usedSlugs: Set<string>): Person[] {
	const have = new Set(people.map((p) => `${normName(p.name)}|${p.dob ? paddedDate(p.dob) : ''}`));
	const added: Person[] = [];
	for (const r of records) {
		const flights = SPACESHIPONE[r.name];
		if (!flights) continue; // curated backfill — only the two SpaceShipOne pilots
		if (matched.has(r._id)) continue;
		if (have.has(`${normName(r.name)}|${r.birthdate ?? ''}`)) continue; // already present under this name+dob
		const dod = r.deathdate ? r.deathdate.slice(0, 10) : null;
		let slug = slugify(r.name) || `sc-${r.astroNumber}`;
		if (usedSlugs.has(slug)) slug = `${slug}-sc-${r.astroNumber}`;
		usedSlugs.add(slug);
		added.push({
			id: `sc-${r.astroNumber}`,
			qid: null,
			name: r.name,
			slug,
			nationalities: scNations(r),
			gender: scGender(r.gender) ?? 'unknown',
			agencies: scAgencies(r),
			status: dod ? 'deceased' : 'living',
			dob: r.birthdate ? r.birthdate.slice(0, 10) : null,
			dod,
			wiki: null,
			image: r.image ?? null,
			totalDaysInSpace: 0,
			firstLaunch: flights[0].launch,
			lastLanding: flights.at(-1)!.landing,
			flights,
			spacewalks: 0
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
		countries: new Set(people.flatMap((p) => p.nationalities)).size,
		agencies: new Set(people.flatMap((p) => p.agencies)).size
	};
	meta.coverage = {
		genderKnown: people.filter((p) => p.gender !== 'unknown').length,
		withImage: people.filter((p) => p.image).length,
		withAgency: people.filter((p) => p.agencies.length).length,
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
	console.log('▶ Supercluster enrichment (nationalities, gender + agency gap-fills, backfills the SpaceShipOne pilots)…');
	const records = await fetchHumans();
	if (records.length === 0) return;

	const find = buildFinder(records);
	const people: Person[] = await Bun.file(DATA).json();
	const usedSlugs = new Set(people.map((p) => p.slug));
	const matched = new Set<string>();

	let genderFilled = 0,
		spaceAdventures = 0,
		commercialFilled = 0,
		unmatched = 0;
	const natBefore = new Map(people.map((p) => [p.id, p.nationalities.join(' + ')]));
	const agencyBefore = new Map(people.map((p) => [p.id, p.agencies.join(' + ')]));
	const scAgenciesOf = new Map<string, string[]>(); // person id → Supercluster's agencies, for the cross-check

	for (const p of people) {
		const r = find(p);
		if (!r) {
			unmatched++;
			continue;
		}
		matched.add(r._id);
		scAgenciesOf.set(p.id, scAgencies(r));

		// ----- Nationalities: Supercluster's list replaces ours (settled below, with everyone's) -----
		const nations = scNations(r);
		if (nations.length) p.nationalities = nations;

		// ----- Gender: fill Unknowns only, never override -----
		if (p.gender === 'unknown') {
			const g = scGender(r.gender);
			if (g) {
				p.gender = g;
				genderFilled++;
			}
		}

		// ----- Agencies: Space Adventures → commercial gap-fill (else keep ours; settled below) -----
		const agencies = scAgencies(r);
		const commercial = agencies.find((a) => COMMERCIAL.has(a));
		if (agencies.includes('Space Adventures')) {
			if (p.agencies.join() !== 'Space Adventures') spaceAdventures++;
			p.agencies = ['Space Adventures'];
		} else if (!p.agencies.length && commercial) {
			p.agencies = [commercial];
			commercialFilled++;
		}
	}

	// ----- Backfill the two SpaceShipOne pilots -----
	const before = people.length;
	const added = buildBackfill(records, people, matched, usedSlugs);
	people.push(...added);

	// ----- Settle everyone's nationalities and agencies: former states and agencies by flight date, then
	// the researched lists -----
	const natChanges: { name: string; from: string; to: string }[] = [];
	const agencyChanges: { name: string; from: string; to: string }[] = [];
	for (const p of people) {
		p.nationalities = settleNationalities(p);
		p.agencies = settleAgencies(p);
		const from = natBefore.get(p.id);
		const to = p.nationalities.join(' + ');
		if (from !== undefined && from !== to) natChanges.push({ name: p.name, from, to });
		const agencyFrom = agencyBefore.get(p.id);
		const agencyTo = p.agencies.join(' + ');
		if (agencyFrom !== undefined && agencyFrom !== agencyTo) agencyChanges.push({ name: p.name, from: agencyFrom, to: agencyTo });
	}
	const staleResearched = unmatchedResearched(people);
	const staleAgencies = unmatchedAgencies(people);

	// ----- Cross-check: agencies Supercluster gives someone that we don't, once its list is dated flight by
	// flight and stripped of launch providers. Researched people are settled already; the rest want a look.
	const scOnly: string[] = [];
	for (const p of people) {
		const sc = scAgenciesOf.get(p.id);
		if (!sc?.length || isResearched(p.name)) continue;
		const missing = attributeAgencies(sc, p.flights).filter((a) => !p.agencies.includes(a));
		if (missing.length) scOnly.push(`${p.name}: ours ${p.agencies.join(' + ') || '—'}, Supercluster also ${missing.join(' + ')}`);
	}

	people.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));
	await writeAstronauts(people);
	await refreshMeta(people);

	const stillUnknownGender = people.filter((p) => p.gender === 'unknown').length;
	console.log('\n──────── Supercluster enrichment report ────────');
	console.log(`matched:           ${before - unmatched}/${before}  (unmatched ${unmatched})`);
	console.log(
		`nationalities:     ${natChanges.length} changed  (${people.filter((p) => p.nationalities.length > 1).length} people hold several)`
	);
	if (unknownNations.size) console.log(`   ⚠ unmapped Supercluster nations (add to SC_NATION): ${[...unknownNations].join(', ')}`);
	if (staleResearched.length) console.log(`   ⚠ researched nationalities matching nobody (renamed?): ${staleResearched.join(', ')}`);
	console.log(`gender filled:     ${genderFilled}  (${stillUnknownGender} still Unknown)`);
	console.log(
		`agencies:          ${agencyChanges.length} changed  (${people.filter((p) => p.agencies.length > 1).length} people hold several)`
	);
	console.log(`   Space Adventures: ${spaceAdventures}  (tourists + dearMoon pair, off JAXA/none)`);
	console.log(`   commercial fills: ${commercialFilled}  (none → commercial provider)`);
	if (unknownAgencies.size) console.log(`   ⚠ unmapped Supercluster agencies (add to scripts/agency.ts): ${[...unknownAgencies].join(', ')}`);
	if (staleAgencies.length) console.log(`   ⚠ researched agencies matching nobody (renamed?): ${staleAgencies.join(', ')}`);
	console.log(`backfilled:        +${added.length}  (${before} → ${people.length})  ${added.map((p) => p.name).join(', ')}`);
	if (natChanges.length) {
		console.log('nationality changes:');
		for (const c of natChanges.sort((a, b) => a.name.localeCompare(b.name))) console.log(`   ${c.name}: ${c.from} → ${c.to}`);
	}
	if (agencyChanges.length) {
		console.log('agency changes:');
		for (const c of agencyChanges.sort((a, b) => a.name.localeCompare(b.name))) console.log(`   ${c.name}: ${c.from || '—'} → ${c.to || '—'}`);
	}
	if (scOnly.length) {
		console.log('agencies only Supercluster lists (review, then settle in scripts/agency.ts):');
		for (const line of scOnly.sort()) console.log(`   ${line}`);
	}
	console.log('  (re-running `bun run update-data` resets this — run enrich-ll2 then enrich-supercluster afterwards.)');
	console.log('────────────────────────────────────────────────\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
