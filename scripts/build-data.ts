/**
 * Piste data pipeline — PRIMARY build (no rate limits).
 *
 *   Wikidata SPARQL (CC0)  → people (gender, citizenship, dob/dod, photo, wiki) + per-mission
 *                            launch/landing dates via crew links.
 *   ISS APIs (MIT)         → who is in space *right now* (snapshot, by name).
 *
 * Output: src/lib/data/astronauts.json (pretty) + astronauts.min.json + meta.json.
 * Run with: bun run update-data
 *
 * LL2 enrichment (agency, spacewalks, active/retired) is a separate, optional, rate-limited
 * step — see scripts/enrich-ll2.ts. The site is fully functional on this build alone.
 */
import { COUNTRY_CODE } from '../src/lib/countries';
import type { Flight, Gender, Meta, Person, Status } from '../src/lib/types';
import { agencyOf, ARMED_FORCES, settleAgencies } from './agency';
import { writeAstronauts } from './dataset';
import { settleNationalities } from './nationality';

const UA = 'PisteDataPipeline/1.0 (https://github.com/piste; static people-in-space timeline)';
const WDQS = 'https://query.wikidata.org/sparql';
const ROOT = new URL('..', import.meta.url);
const OUT_DIR = new URL('src/lib/data/', ROOT);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const val = (b: Record<string, { value: string }>, k: string): string | undefined => b[k]?.value;
const qid = (uri?: string): string | undefined => uri?.match(/(Q\d+)$/)?.[1];
const dateOnly = (iso?: string): string | undefined => (iso ? iso.slice(0, 10) : undefined);
// SPARQL returns rows in no guaranteed order, so wherever rows disagree (e.g. a person with two
// normal-rank P18 images) the pick must not be "first row wins" — keep the smallest value instead.
const least = (cur?: string, next?: string): string | undefined =>
	next !== undefined && (cur === undefined || next < cur) ? next : cur;
const cmp = (a = '', b = '') => (a < b ? -1 : a > b ? 1 : 0);

/** A Wikidata time value: the date plus its precision (9 = year, 10 = month, 11 = day). */
interface WdDate {
	iso: string;
	precision: number;
}
/** Several best-rank dates (e.g. a year-only "1956" beside a full 1954-12-28): keep the most
 *  precise, then the earliest. */
function pickDate(cur: WdDate | undefined, value?: string, precision?: string): WdDate | undefined {
	const iso = dateOnly(value);
	if (!iso) return cur;
	const next = { iso, precision: Number(precision ?? 0) };
	return !cur || next.precision > cur.precision || (next.precision === cur.precision && next.iso < cur.iso) ? next : cur;
}

function normalizeName(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function slugify(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** Recover a display name from an English Wikipedia article URL, for the rare item whose Wikidata
 *  label service returns the bare QID (no en label). e.g. …/wiki/Franco_Malerba → "Franco Malerba". */
function nameFromArticle(url?: string): string | undefined {
	const slug = url?.match(/\/wiki\/(.+)$/)?.[1];
	return slug ? decodeURIComponent(slug).replace(/_/g, ' ') : undefined;
}

// ---------------------------------------------------------------- normalization tables
// Wikidata country labels → the names in src/lib/countries.ts.
const COUNTRY_RENAME: Record<string, string> = {
	'United States of America': 'United States',
	"People's Republic of China": 'China',
	'Russian Federation': 'Russia',
	'Federal Republic of Germany': 'Germany',
	'German Democratic Republic': 'East Germany',
	'Kingdom of the Netherlands': 'Netherlands',
	'Kingdom of Denmark': 'Denmark',
	'Czech Republic': 'Czechia',
	'Democratic Republic of Afghanistan': 'Afghanistan',
	'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
	'Russian Soviet Federative Socialist Republic': 'Soviet Union',
	'Ukrainian Soviet Socialist Republic': 'Soviet Union',
	'Byelorussian Soviet Socialist Republic': 'Soviet Union'
};
// When a person has several citizenships, prefer a present-day state over a historic one (e.g. a
// cosmonaut born in the USSR but flying for Russia today) — settleNationalities then puts the former
// state back for whoever flew before it gave way.
const HISTORIC_STATES = new Set(['Soviet Union', 'East Germany', 'West Germany', 'Czechoslovakia', 'Yugoslavia', 'Serbia and Montenegro']);

// Employer/operator labels → an agency key (scripts/agency.ts). An armed force is skipped: plenty of NASA
// and ESA astronauts list one as an employer.
function matchAgency(labels: string[]): string | undefined {
	// Labels arrive in SPARQL row order; sort them so several matching labels resolve the same way every run.
	for (const l of [...labels].sort()) {
		const key = agencyOf(l);
		if (key && !ARMED_FORCES.has(key)) return key;
	}
	return undefined;
}

// Most astronauts represent their own nation's agency — an accurate inference for the ~90% who
// are government crew. Europeans are grouped under ESA. settleAgencies then names each flight's agency
// as it was (a Soviet-era flight is CCCP's, a Japanese one before 2003 NASDA's).
const NATION_AGENCY: Record<string, string> = {
	us: 'NASA', ru: 'Roscosmos', su: 'CCCP', cn: 'CMSA', jp: 'JAXA', ca: 'CSA', in: 'ISRO',
	dd: 'Interkosmos', cs: 'Interkosmos', // their only fliers were Interkosmos guests on Soviet missions
	de: 'ESA', fr: 'ESA', it: 'ESA', gb: 'ESA', es: 'ESA', nl: 'ESA', be: 'ESA', se: 'ESA',
	ch: 'ESA', dk: 'ESA', no: 'ESA', at: 'ESA', pl: 'ESA', ie: 'ESA', fi: 'ESA', pt: 'ESA',
	gr: 'ESA', lu: 'ESA', cz: 'ESA', hu: 'ESA', ro: 'ESA'
};
// Resolution: explicit employer → (suborbital tourists) commercial provider → nation's agency →
// none. Government mission *operators* are not used (a JAXA astronaut on a NASA vehicle isn't
// "NASA"). LL2 enrichment later replaces this with exact employer data.
function resolveAgency(employers: string[], operators: string[], suborbitalOnly: boolean, cc: string | null): string | undefined {
	return (
		matchAgency(employers) ??
		(suborbitalOnly ? matchAgency(operators) : undefined) ??
		(cc ? NATION_AGENCY[cc] : undefined)
	);
}

// Crewed *suborbital* programs — everything else is treated as orbital.
const SUBORBITAL_RE =
	/New Shepard|Blue Origin|Virgin Galactic|SpaceShip(One|Two)|VSS |\bX-15\b|Mercury-Redstone|Freedom 7|Liberty Bell 7/i;
function isOrbital(missionLabel: string, operatorLabels: string[]): boolean {
	return !SUBORBITAL_RE.test([missionLabel, ...operatorLabels].join(' '));
}

// Station increments — their dates are crew-handover boundaries, not a person's actual stay,
// so they're used only to *bridge* a trip, never to set its start/end.
const EXPEDITION_RE = /^(Expedition \d+|ISS Expedition|Mir (EO|LD|EP|Expedition|Principal)|Salyut.*(EO|expedition)|Tiangong.*(crew|expedition))/i;
const isExpedition = (label: string) => EXPEDITION_RE.test(label);

interface Raw {
	mission: string;
	orbital: boolean;
	approx: boolean;
	ongoing: boolean;
	exp: boolean;
	_s: number;
	_e: number;
}

/** Merge overlapping mission intervals into trips. A person can't be on two trips at once, so
 *  overlapping missions (ferry up + expedition + ferry down) are one continuous time in space.
 *  Boundaries come from ferries; expeditions only bridge. */
function mergeTrips(raw: Raw[], nowMs: number): Flight[] {
	const sorted = [...raw].sort((a, b) => a._s - b._s);
	const GAP = 1.5 * 86400000;
	const groups: Raw[][] = [];
	let cur: Raw[] = [];
	let end = -Infinity;
	for (const r of sorted) {
		if (cur.length && r._s <= end + GAP) {
			cur.push(r);
			end = Math.max(end, r._e);
		} else {
			if (cur.length) groups.push(cur);
			cur = [r];
			end = r._e;
		}
	}
	if (cur.length) groups.push(cur);
	const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
	return groups.map((g) => {
		const bound = g.some((r) => !r.exp) ? g.filter((r) => !r.exp) : g;
		const segs = bound.slice().sort((a, b) => a._s - b._s);
		const ongoing = g.some((r) => r.ongoing);
		return {
			mission: segs[0].mission,
			launch: iso(Math.min(...bound.map((r) => r._s))),
			landing: ongoing ? null : iso(Math.max(...bound.map((r) => r._e))),
			ongoing,
			orbital: g.some((r) => r.orbital),
			approx: bound.some((r) => r.approx),
			segments: segs.length > 1 ? segs.map((s) => s.mission) : undefined
		};
	});
}

// ---------------------------------------------------------------- fetch helpers
async function sparql(query: string, attempt = 0): Promise<Record<string, { value: string }>[]> {
	try {
		const res = await fetch(WDQS, {
			method: 'POST',
			headers: {
				Accept: 'application/sparql-results+json',
				'Content-Type': 'application/x-www-form-urlencoded',
				'User-Agent': UA
			},
			body: new URLSearchParams({ query }).toString()
		});
		if (res.status === 429 || res.status === 503 || res.status === 504) throw new Error(`HTTP ${res.status}`);
		if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0, 300)}`);
		const json = (await res.json()) as { results: { bindings: Record<string, { value: string }>[] } };
		return json.results.bindings;
	} catch (err) {
		if (attempt < 4) {
			const wait = 3000 * (attempt + 1);
			console.warn(`  ↻ SPARQL retry ${attempt + 1} in ${wait}ms — ${(err as Error).message}`);
			await sleep(wait);
			return sparql(query, attempt + 1);
		}
		throw err;
	}
}

/** Returns a set of normalized names of people currently in space (best-effort, snapshot). */
async function fetchInSpace(): Promise<Set<string>> {
	const endpoints = ['https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json'];
	for (const url of endpoints) {
		try {
			const res = await fetch(url, { headers: { 'User-Agent': UA } });
			if (!res.ok) continue;
			const data = (await res.json()) as { people?: { name: string }[] };
			const names = (data.people ?? []).map((p) => normalizeName(p.name)).filter(Boolean);
			if (names.length) {
				console.log(`  in-space: ${names.length} people via ${new URL(url).host}`);
				return new Set(names);
			}
		} catch {
			/* try next */
		}
	}
	console.warn('  ⚠ ISS APIs unavailable — falling back to recent landing-less flights');
	return new Set();
}

/** Match "in space now" names to person QIDs (exact, then last-name + first-initial). */
function resolveInSpace(people: Map<string, PersonAgg>, names: Set<string>) {
	const byName = new Map<string, string[]>();
	const byKey = new Map<string, string[]>();
	const push = (m: Map<string, string[]>, k: string, q: string) => m.set(k, [...(m.get(k) ?? []), q]);
	for (const [q, p] of people) {
		const n = normalizeName(p.name);
		push(byName, n, q);
		const t = n.split(' ');
		if (t.length >= 2) push(byKey, `${t[t.length - 1]}|${t[0][0]}`, q);
	}
	const qids = new Set<string>();
	const unmatched: string[] = [];
	for (const nm of names) {
		const exact = byName.get(nm);
		const t = nm.split(' ');
		const fuzzy = t.length >= 2 ? byKey.get(`${t[t.length - 1]}|${t[0][0]}`) : undefined;
		const hit = exact?.length === 1 ? exact : fuzzy?.length === 1 ? fuzzy : exact?.length ? exact : undefined;
		if (hit?.length === 1) qids.add(hit[0]);
		else unmatched.push(nm);
	}
	return { qids, unmatched };
}

// ---------------------------------------------------------------- SPARQL queries
const MISSIONS_QUERY = `
SELECT ?flight ?flightLabel ?launch ?landing ?crew ?operatorLabel WHERE {
  { ?flight wdt:P1029 ?crew . } UNION { ?crew wdt:P450 ?flight . }
  # Constrain to actual spaceflights — P1029/P580 are also used on ships & expeditions.
  ?flight wdt:P31/wdt:P279* ?cls . VALUES ?cls { wd:Q5916 wd:Q752783 }
  OPTIONAL { ?flight wdt:P619 ?la1 } OPTIONAL { ?flight wdt:P580 ?la2 }
  OPTIONAL { ?flight wdt:P620 ?ld1 } OPTIONAL { ?flight wdt:P582 ?ld2 }
  BIND(COALESCE(?la1, ?la2) AS ?launch)
  BIND(COALESCE(?ld1, ?ld2) AS ?landing)
  OPTIONAL { ?flight wdt:P137 ?operator }
  FILTER(BOUND(?launch))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

const peopleQuery = (values: string) => `
SELECT ?p ?pLabel ?genderLabel ?countryLabel ?dob ?dobPrec ?dod ?dodPrec ?image ?article ?employerLabel WHERE {
  VALUES ?p { ${values} }
  FILTER EXISTS { ?p wdt:P31 wd:Q5 }
  OPTIONAL { ?p wdt:P21 ?gender }
  OPTIONAL { ?p wdt:P27 ?country }
  # Best-rank statements (the same set wdt: gives) plus their precision, so a full date beats a year-only one.
  OPTIONAL { ?p p:P569 [ a wikibase:BestRank ; psv:P569 [ wikibase:timeValue ?dob ; wikibase:timePrecision ?dobPrec ] ] }
  OPTIONAL { ?p p:P570 [ a wikibase:BestRank ; psv:P570 [ wikibase:timeValue ?dod ; wikibase:timePrecision ?dodPrec ] ] }
  OPTIONAL { ?p wdt:P18 ?image }
  OPTIONAL { ?p wdt:P108 ?employer }
  OPTIONAL { ?article schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

// ---------------------------------------------------------------- pipeline
interface FlightAgg {
	label: string;
	launch: string;
	landing?: string;
	operators: Set<string>;
	crew: Set<string>;
}
interface PersonAgg {
	name: string;
	gender?: string;
	countries: Set<string>;
	dob?: WdDate;
	dod?: WdDate;
	image?: string;
	article?: string;
	employers: Set<string>;
}

function toGender(label?: string): Gender {
	if (!label) return 'unknown';
	const l = label.toLowerCase();
	if (l === 'male' || l === 'cisgender male' || l === 'trans man') return 'male';
	if (l === 'female' || l === 'cisgender female' || l === 'trans woman') return 'female';
	return 'other';
}

async function main() {
	console.log('▶ Querying Wikidata for crewed missions…');
	const missionRows = await sparql(MISSIONS_QUERY);
	const flights = new Map<string, FlightAgg>();
	for (const b of missionRows) {
		const fq = qid(val(b, 'flight'));
		const cq = qid(val(b, 'crew'));
		const launch = dateOnly(val(b, 'launch'));
		if (!fq || !cq || !launch) continue;
		let f = flights.get(fq);
		if (!f) {
			f = { label: val(b, 'flightLabel') || fq, launch, landing: dateOnly(val(b, 'landing')), operators: new Set(), crew: new Set() };
			flights.set(fq, f);
		}
		if (launch < f.launch) f.launch = launch;
		const land = dateOnly(val(b, 'landing'));
		if (land && (!f.landing || land > f.landing)) f.landing = land;
		const op = val(b, 'operatorLabel');
		if (op) f.operators.add(op);
		f.crew.add(cq);
	}
	const crewQids = new Set<string>();
	for (const f of flights.values()) for (const c of f.crew) crewQids.add(c);
	console.log(`  ${flights.size} flights, ${crewQids.size} unique crew`);

	console.log('▶ Enriching people from Wikidata…');
	const people = new Map<string, PersonAgg>();
	const ids = [...crewQids];
	for (let i = 0; i < ids.length; i += 200) {
		const batch = ids.slice(i, i + 200);
		const values = batch.map((q) => `wd:${q}`).join(' ');
		const rows = await sparql(peopleQuery(values));
		for (const b of rows) {
			const pq = qid(val(b, 'p'));
			if (!pq) continue;
			let p = people.get(pq);
			if (!p) {
				p = { name: val(b, 'pLabel') || pq, countries: new Set(), employers: new Set() };
				people.set(pq, p);
			}
			// wdt:/BestRank already prefer a preferred-rank statement and drop deprecated ones; these
			// break the remaining ties between same-rank values.
			p.gender = least(p.gender, val(b, 'genderLabel'));
			const cl = val(b, 'countryLabel');
			if (cl) p.countries.add(COUNTRY_RENAME[cl] ?? cl);
			p.dob = pickDate(p.dob, val(b, 'dob'), val(b, 'dobPrec'));
			p.dod = pickDate(p.dod, val(b, 'dod'), val(b, 'dodPrec'));
			p.image = least(p.image, val(b, 'image'));
			p.article ??= val(b, 'article'); // an item has at most one enwiki sitelink, so every row agrees
			const emp = val(b, 'employerLabel');
			if (emp) p.employers.add(emp);
		}
		console.log(`  people ${Math.min(i + 200, ids.length)}/${ids.length}`);
	}

	console.log('▶ Fetching ISS APIs in-space snapshot (cross-check only)…');
  const inSpaceNow = await fetchInSpace();
	const now = new Date();
	const nowISO = now.toISOString().slice(0, 10);
	// A flight launched within this window with no recorded landing is treated as ongoing.
  // Status is derived from Wikidata this way (self-consistent with the bars) — the ISS APIs
  // snapshot is only cross-checked in the report, because it can be stale.
	const recentCut = new Date(now.getTime() - 400 * 86400000).toISOString().slice(0, 10);

	console.log('▶ Assembling…');
	const persons: Person[] = [];
	const usedSlugs = new Set<string>();

	for (const [pq, agg] of people) {
		// dedupe this person's missions (a mission and its spacecraft item can share a launch date)
		const byLaunch = new Map<string, { mission: string; launch: string; landing: string | null; orbital: boolean; exp: boolean }>();
		const opLabels = new Set<string>();
		for (const f of flights.values()) {
			if (!f.crew.has(pq)) continue;
			for (const o of f.operators) opLabels.add(o);
			const fl = {
				mission: f.label,
				launch: f.launch,
				landing: f.landing ?? null,
				orbital: isOrbital(f.label, [...f.operators]),
				exp: isExpedition(f.label)
			};
			// Of same-day duplicates keep the one with a landing, then the longer (more specific) label, then
			// the alphabetically first — equal-length labels ("Soyuz TM-15" / "Mir-Antares") must not fall to row order.
			const ex = byLaunch.get(fl.launch);
			if (
				!ex ||
				(!!fl.landing !== !!ex.landing
					? !!fl.landing
					: fl.mission.length !== ex.mission.length
						? fl.mission.length > ex.mission.length
						: fl.mission < ex.mission)
			)
				byLaunch.set(fl.launch, fl);
		}
		if (byLaunch.size === 0) continue;

		// resolve missing landings: recent + no landing ⇒ ongoing; old + no landing ⇒ estimated
		const raw: Raw[] = [...byLaunch.values()].map((fl) => {
			let ongoing = false;
			let approx = false;
			let landingMs: number;
			if (fl.landing) landingMs = Date.parse(fl.landing);
			else if (!fl.orbital) landingMs = Date.parse(fl.launch); // suborbital: same-day, never ongoing
			else if (fl.launch >= recentCut) {
				ongoing = true;
				landingMs = now.getTime();
			} else {
				approx = true;
				landingMs = Date.parse(fl.launch);
			}
			return { mission: fl.mission, orbital: fl.orbital, approx, ongoing, exp: fl.exp, _s: Date.parse(fl.launch), _e: landingMs };
		});
		const pf = mergeTrips(raw, now.getTime());
		const isInSpace = pf.some((t) => t.ongoing);

		let days = 0;
		for (const t of pf) {
			const s = Date.parse(t.launch);
			const e = t.ongoing ? now.getTime() : Date.parse(t.landing!);
			if (e > s) days += (e - s) / 86400000;
		}

		let image = agg.image ? agg.image.replace(/^http:/, 'https:') : null;
		if (image) image += (image.includes('?') ? '&' : '?') + 'width=320';

		// A handful of Wikidata items have no English label — the service hands back the QID. Fall
		// back to the Wikipedia article title so the person shows a real name (and a sane slug).
		const name = /^Q\d+$/.test(agg.name) ? (nameFromArticle(agg.article) ?? agg.name) : agg.name;

		let slug = slugify(name) || pq.toLowerCase();
		if (usedSlugs.has(slug)) slug = `${slug}-${pq.toLowerCase()}`;
		usedSlugs.add(slug);

		// One base nationality — Wikidata also lists ancestry and birth states, so its extras aren't
		// trusted; LL2 and Supercluster refine this later. Prefer a present-day country the app knows
		// (Chang-Díaz: United States over his native Costa Rica), and sort so ties go to the
		// alphabetically first, not whichever SPARQL row came first.
		const cs = [...agg.countries].sort(cmp);
		const current = cs.filter((c) => !HISTORIC_STATES.has(c));
		const pick = current.find((c) => COUNTRY_CODE[c]) ?? current[0] ?? cs[0];
		const nationalities = settleNationalities({ name, nationalities: pick ? [pick] : [], flights: pf });

		const status: Status = isInSpace ? 'in-space' : agg.dod ? 'deceased' : 'living';
		const lastLanded = [...pf].reverse().find((f) => !f.ongoing && f.landing);

		const countryCode = COUNTRY_CODE[nationalities[0]] ?? null;
		// Soviet-republic cosmonauts (e.g. Ukrainian/Belarusian SSR) flew the Soviet programme.
		let agency = resolveAgency([...agg.employers], [...opLabels], pf.every((t) => !t.orbital), countryCode);
		if (!agency && cs.includes('Soviet Union')) agency = 'CCCP';
		const agencies = settleAgencies({ name, agencies: agency ? [agency] : [], flights: pf });

		persons.push({
			id: pq,
			qid: pq,
			name,
			slug,
			nationalities,
			gender: toGender(agg.gender),
			agencies,
			status,
			dob: agg.dob?.iso ?? null,
			dod: agg.dod?.iso ?? null,
			wiki: agg.article ?? null,
			image,
			totalDaysInSpace: Math.round(days),
			firstLaunch: pf[0].launch,
			lastLanding: status === 'in-space' ? null : (lastLanded?.landing ?? null),
			flights: pf
		});
	}

	persons.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));

	// ISS APIs cross-check (can be stale) — names it lists that we do NOT show as in-space
	const personByQid = new Map(persons.map((p) => [p.qid!, p]));
	const { qids: onQids, unmatched: onUnmatched } = resolveInSpace(people, inSpaceNow);
	const inSpaceUnmatched = [
		...onUnmatched,
		...[...onQids].filter((q) => personByQid.get(q)?.status !== 'in-space').map((q) => people.get(q)?.name ?? q)
	];

	// ----- meta + report
	const flightCount = persons.reduce((n, p) => n + p.flights.length, 0);
	const orbital = persons.reduce((n, p) => n + p.flights.filter((f) => f.orbital).length, 0);
	const approx = persons.reduce((n, p) => n + p.flights.filter((f) => f.approx).length, 0);

	const meta: Meta = {
		generatedAt: new Date().toISOString(),
		asOf: nowISO,
		sources: [
			{ name: 'Wikidata', url: 'https://www.wikidata.org', license: 'CC0' },
			{
        name: 'International Space Station APIs — People in Space',
        url: 'https://github.com/corquaid/international-space-station-APIs',
        license: 'MIT'
      },
			{ name: 'Launch Library 2 (The Space Devs)', url: 'https://thespacedevs.com/llapi', license: 'CC BY-NC 4.0' }
		],
		counts: {
			people: persons.length,
			flights: flightCount,
			inSpace: persons.filter((p) => p.status === 'in-space').length,
			orbital,
			suborbital: flightCount - orbital,
			countries: new Set(persons.flatMap((p) => p.nationalities)).size,
			agencies: new Set(persons.flatMap((p) => p.agencies)).size
		},
		coverage: {
			genderKnown: persons.filter((p) => p.gender !== 'unknown').length,
			withImage: persons.filter((p) => p.image).length,
			withAgency: persons.filter((p) => p.agencies.length).length,
			realLandingFlights: flightCount - approx,
			approxFlights: approx
		},
		inSpaceUnmatched
	};

	await writeAstronauts(persons);
	await Bun.write(new URL('meta.json', OUT_DIR), JSON.stringify(meta, null, 2));

	const pct = (n: number) => `${Math.round((100 * n) / persons.length)}%`;
	console.log('\n──────── Piste data report ────────');
	console.log(`people:            ${meta.counts.people}`);
	console.log(`flights:           ${meta.counts.flights}  (orbital ${meta.counts.orbital} / suborbital ${meta.counts.suborbital})`);
	console.log(`in space now:      ${meta.counts.inSpace}  (as of ${nowISO})`);
	console.log(`countries:         ${meta.counts.countries}`);
	console.log(`gender known:      ${meta.coverage.genderKnown}  (${pct(meta.coverage.genderKnown)})`);
	console.log(`with photo:        ${meta.coverage.withImage}  (${pct(meta.coverage.withImage)})`);
	console.log(`with agency:       ${meta.coverage.withAgency}  (${pct(meta.coverage.withAgency)})  ← improves via enrich-ll2`);
	console.log(`flights w/ landing:${meta.coverage.realLandingFlights}  (${meta.counts.flights - meta.coverage.realLandingFlights} approx)`);
	console.log(`first person:      ${persons[0]?.name} — ${persons[0]?.firstLaunch}`);
	console.log(`in-space cross:    ${inSpaceNow.size} names; ${inSpaceUnmatched.length} not shown in-space (likely stale)`);
	if (inSpaceUnmatched.length) console.log(`   ${inSpaceUnmatched.join(', ')}`);
	console.log('───────────────────────────────────\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
