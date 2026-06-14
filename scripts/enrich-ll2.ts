/**
 * OPTIONAL, resumable, long-running LL2 enrichment — layers Launch Library 2 (The Space Devs) data
 * onto src/lib/data/astronauts.json. LL2 is the authoritative source for two things Wikidata gets
 * wrong, and they map to two layers:
 *
 * The fix: rebuild each person's flights from LL2 by zipping their launches (`flights[].net`) with
 * their returns (`landings[].mission_end`). This gives both:
 *   • accurate timeline bars — each person's *actual* intervals, including seat-swaps where the
 *     up/down craft differ (recorded as `segments`); and
 *   • the correct day count — Wikidata derives days from per-spacecraft launch/landing dates, which
 *     over-counts every seat-swapping crew member (a visiting astronaut inherits the spacecraft's
 *     whole 6-month span instead of their own ~10-day stay). e.g. Kononenko 1110, Whitson 695.
 *
 * `totalDaysInSpace` is set from LL2's `time_in_space`, but ONLY when the rebuilt flights corroborate
 * it (their summed duration agrees within ~2 days). They disagree for a dozen Apollo/Gemini/Skylab
 * veterans whose LL2 `time_in_space` is buggy (e.g. Conrad 49→21) or whose landing dates are broken
 * — there Wikidata is correct (those crews didn't seat-swap), so its number and bars are kept.
 *
 * LL2 is also authoritative for two descriptive attributes Wikidata gets wrong, applied as always-safe
 * list-field overrides: NATIONALITY (Wikidata often stores a birthplace — Kononenko → Turkmenistan — or
 * a stale/secondary citizenship; LL2's demonym is the flown-under nation) and AGENCY (LL2's affiliation
 * fills the gaps Wikidata leaves blank, e.g. Korea/Yi So-yeon). Also fills spacewalk counts and photos.
 *
 * Data comes from the astronaut LIST fetched with `?mode=detailed`, which inlines each person's
 * flights & landings — so the whole dataset is ~9 paginated calls, not one per astronaut. (If a
 * record lacks inline flights — e.g. an older cached page — it falls back to the per-astronaut
 * detail endpoint.) LL2's public tier is heavily rate-limited (~15 calls/hour), so this paces calls,
 * honours `Retry-After`, backs off, and caches every page — a cold full run resumes where it left
 * off. The site is fully functional WITHOUT this step.
 *
 *   bun run enrich-ll2                       # Layer 1 + 2: fetch what's missing, merge, save
 *   MAX_LL2_CALLS=50 bun run enrich-ll2      # do 50 network calls then stop (re-run to continue)
 *   MAX_LL2_CALLS=0 bun run enrich-ll2       # apply already-cached pages only (no network)
 *   LL2_DELAY_MS=4000 bun run enrich-ll2     # gentler pacing between calls (default 2000ms)
 *   LL2_API_KEY=… bun run enrich-ll2         # authenticated tier (higher throttle ceiling)
 *
 * NOTE: run AFTER `bun run update-data` (which rebuilds astronauts.json from Wikidata). Re-running
 * is idempotent given the cache.
 */
import type { Flight, Meta, Person, Status } from '../src/lib/types';

const UA = 'PisteDataPipeline/1.0 (https://github.com/piste; static people-in-space timeline)';
const LL2 = 'https://ll.thespacedevs.com/2.2.0/astronaut/';
const PAGE = 100;
const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('scripts/cache/ll2/', ROOT);
const DETAIL_CACHE = new URL('scripts/cache/ll2/detail/', ROOT);
const DATA = new URL('src/lib/data/astronauts.json', ROOT);
const META = new URL('src/lib/data/meta.json', ROOT);

// ---- throttle / budget knobs ----
const DELAY_MS = Number(process.env.LL2_DELAY_MS ?? 2000); // pause between successful network calls
const MAX_CALLS = Number(process.env.MAX_LL2_CALLS ?? Infinity); // network-call budget for this run (0 = offline)
const MAX_RETRIES = Number(process.env.LL2_MAX_RETRIES ?? 6);
const API_KEY = process.env.LL2_API_KEY ?? process.env.SPACEDEVS_TOKEN ?? '';
const HEADERS: Record<string, string> = { 'User-Agent': UA, ...(API_KEY ? { Authorization: `Token ${API_KEY}` } : {}) };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const normName = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const normWiki = (url?: string | null) =>
	url ? decodeURIComponent(url).replace(/\/$/, '').toLowerCase().replace(/^https?:\/\/[a-z-]+\.wikipedia\.org\/wiki\//, '') : null;
const slugify = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const dayISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** ISO-8601 duration (e.g. "P1110DT12H9M55S") → fractional days. */
function durationToDays(s?: string | null): number | null {
	if (!s) return null;
	const m = s.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
	if (!m) return null;
	const [, y, mo, d, h, mi, se] = m.map((x) => (x ? Number(x) : 0));
	return y * 365 + mo * 30 + d + h / 24 + mi / 1440 + se / 86400;
}

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

// LL2 reports nationality as a demonym ("Russian"), occasionally compound ("Vietnamese American").
// It's authoritative here — Wikidata frequently stores a *birthplace* (Kononenko → Turkmenistan) or a
// historic/secondary citizenship. Map each demonym to the app's country name + ISO 3166-1 alpha-2.
const DEMONYM: Record<string, [country: string, iso2: string]> = {
	American: ['United States', 'us'], Russian: ['Russia', 'ru'], Chinese: ['China', 'cn'], Canadian: ['Canada', 'ca'],
	French: ['France', 'fr'], German: ['Germany', 'de'], Japanese: ['Japan', 'jp'], British: ['United Kingdom', 'gb'],
	Italian: ['Italy', 'it'], Ukrainian: ['Ukraine', 'ua'], Kazakh: ['Kazakhstan', 'kz'], Spanish: ['Spain', 'es'],
	Indian: ['India', 'in'], Belgian: ['Belgium', 'be'], Hungarian: ['Hungary', 'hu'], Polish: ['Poland', 'pl'],
	Dutch: ['Netherlands', 'nl'], Saudi: ['Saudi Arabia', 'sa'], Australian: ['Australia', 'au'], Turkish: ['Turkey', 'tr'],
	Swiss: ['Switzerland', 'ch'], Bulgarian: ['Bulgaria', 'bg'], Swedish: ['Sweden', 'se'], Belarusian: ['Belarus', 'by'],
	Mexican: ['Mexico', 'mx'], Brazilian: ['Brazil', 'br'], Israeli: ['Israel', 'il'], Czech: ['Czechia', 'cz'],
	Austrian: ['Austria', 'at'], Emirati: ['United Arab Emirates', 'ae'], Antiguan: ['Antigua and Barbuda', 'ag'],
	Slovak: ['Slovakia', 'sk'], Syrian: ['Syria', 'sy'], Mongolian: ['Mongolia', 'mn'], Danish: ['Denmark', 'dk'],
	Afghan: ['Afghanistan', 'af'], Vietnamese: ['Vietnam', 'vn'], Romanian: ['Romania', 'ro'], Kyrgyz: ['Kyrgyzstan', 'kg'],
	Malaysian: ['Malaysia', 'my'], Cuban: ['Cuba', 'cu'], Iranian: ['Iran', 'ir'], Portuguese: ['Portugal', 'pt'],
	Egyptian: ['Egypt', 'eg'], Pakistani: ['Pakistan', 'pk'], Singaporean: ['Singapore', 'sg'], Maltese: ['Malta', 'mt'],
	Panamanian: ['Panama', 'pa'], Norwegian: ['Norway', 'no'], Bahamian: ['Bahamas', 'bs'], Kittitian: ['Saint Kitts and Nevis', 'kn'],
	Kiwi: ['New Zealand', 'nz'], 'Puerto Rican': ['United States', 'us'], 'South Korean': ['South Korea', 'kr'],
	'South African': ['South Africa', 'za']
};

/** Resolve an LL2 demonym to { nationality, countryCode }. Multi-word demonyms ("South Korean") are
 *  matched whole; compound ones ("Vietnamese American", "American Australian") are split into their
 *  parts — if one part is the person's current country we keep it (LL2 confirms that citizenship),
 *  otherwise the first listed nationality wins. Returns null when unmappable (e.g. "Earthling" test
 *  dummies) so the caller leaves the existing value untouched. */
function resolveNationality(demonym: string | null | undefined, current: string): { nationality: string; countryCode: string } | null {
	if (!demonym) return null;
	const whole = DEMONYM[demonym];
	if (whole) return { nationality: whole[0], countryCode: whole[1] };
	const tokens = demonym.split(' ');
	const parts: [string, string][] = [];
	for (let i = 0; i < tokens.length; ) {
		const two = tokens.slice(i, i + 2).join(' ');
		if (DEMONYM[two]) { parts.push(DEMONYM[two]); i += 2; }
		else if (DEMONYM[tokens[i]]) { parts.push(DEMONYM[tokens[i]]); i += 1; }
		else i += 1;
	}
	if (!parts.length) return null;
	const pick = parts.find((p) => p[0] === current) ?? parts[0];
	return { nationality: pick[0], countryCode: pick[1] };
}

// Crewed *suborbital* programs — their "flights" are same-day, with no orbital re-entry / landing record.
const SUBORBITAL_RE =
	/New Shepard|Blue Origin|Virgin Galactic|SpaceShip(One|Two)?|VSS |\bX-15\b|Mercury-Redstone|Freedom 7|Liberty Bell 7/i;
const cleanMission = (s?: string | null) => (s ? (s.includes('|') ? s.split('|').pop()!.trim() : s.trim()) : '');

interface LL2Astro {
	id: number;
	name: string;
	wiki?: string | null;
	in_space?: boolean;
	time_in_space?: string | null;
	flights_count?: number;
	agency?: { name?: string; abbrev?: string; type?: string } | null;
	profile_image_thumbnail?: string | null;
	spacewalks_count?: number;
	// Present only with ?mode=detailed (or from the per-astronaut endpoint).
	flights?: any[];
	landings?: any[];
}

/** Trimmed per-astronaut detail we persist (full responses are ~90 KB; we keep ~1 KB).
 *  `name` is the launch's "Rocket | Spacecraft" string; `mission` its expedition label — naming is
 *  resolved in reconstructFlights so this stays faithful to the source. */
interface SlimDetail {
	id: number;
	name: string;
	in_space: boolean;
	time_in_space?: string | null;
	launches: { net: string; name: string | null; mission: string | null }[];
	landings: { end: string; craft: string | null }[];
}

// ---------------------------------------------------------------- throttled fetch
let calls = 0;
const BUDGET = Symbol('budget');
function retryWait(res: Response | null, attempt: number): number {
	const ra = res ? Number(res.headers.get('retry-after')) : NaN;
	if (Number.isFinite(ra) && ra > 0) return ra * 1000;
	return Math.min(5000 * 2 ** attempt, 600_000); // exponential, capped at 10 min
}

/** GET + parse JSON with pacing, Retry-After handling and capped backoff. Returns BUDGET when the
 *  per-run call budget is exhausted, null on a give-up. Only successful calls count toward MAX_CALLS. */
async function fetchJSON(url: string): Promise<any | null | typeof BUDGET> {
	if (calls >= MAX_CALLS) return BUDGET;
	for (let attempt = 0; ; attempt++) {
		if (calls > 0 && attempt === 0) await sleep(DELAY_MS);
		let res: Response;
		try {
			res = await fetch(url, { headers: HEADERS });
		} catch (err) {
			if (attempt >= MAX_RETRIES) {
				console.warn(`  ✗ network error for ${url} — ${(err as Error).message}`);
				return null;
			}
			await sleep(retryWait(null, attempt));
			continue;
		}
		if (res.ok) {
			calls++;
			return res.json();
		}
		if ((res.status === 429 || res.status === 403 || res.status === 503 || res.status === 504) && attempt < MAX_RETRIES) {
			const w = retryWait(res, attempt);
			console.warn(`  ⏳ throttled (HTTP ${res.status}) — waiting ${Math.round(w / 1000)}s (retry ${attempt + 1}/${MAX_RETRIES})`);
			await sleep(w);
			continue;
		}
		console.warn(`  ✗ LL2 HTTP ${res.status} for ${url} — giving up`);
		return null;
	}
}

// ---------------------------------------------------------------- Layer 1: list pages
async function loadList(): Promise<LL2Astro[]> {
	const records: LL2Astro[] = [];
	let offset = 0;
	let total = Infinity;
	while (offset < total) {
		const cacheFile = new URL(`ll2-${offset}.json`, CACHE);
		let data: { count?: number; results?: LL2Astro[] };
		if (await Bun.file(cacheFile).exists()) {
			data = await Bun.file(cacheFile).json();
		} else {
			const r = await fetchJSON(`${LL2}?mode=detailed&limit=${PAGE}&offset=${offset}`);
			if (r === BUDGET) {
				console.log(`  list: call budget reached at offset ${offset} — re-run to continue.`);
				break;
			}
			if (!r) break;
			data = r;
			await Bun.write(cacheFile, JSON.stringify(data));
			console.log(`  list: fetched offset ${offset} (${calls} calls)`);
		}
		total = data.count ?? total;
		records.push(...(data.results ?? []));
		offset += PAGE;
	}
	console.log(`  ${records.length} LL2 list records loaded.`);
	return records;
}

// ---------------------------------------------------------------- Layer 2: per-astronaut detail
function slimDetail(d: any): SlimDetail {
	return {
		id: d.id,
		name: d.name,
		in_space: !!d.in_space,
		time_in_space: d.time_in_space ?? null,
		launches: (d.flights ?? [])
			.map((f: any) => ({ net: f.net, name: f.name ?? null, mission: f.mission?.name ?? null }))
			.filter((x: any) => x.net),
		landings: (d.landings ?? [])
			.map((l: any) => ({ end: l.mission_end, craft: l.spacecraft?.spacecraft?.name ?? l.spacecraft?.name ?? null }))
			.filter((x: any) => x.end)
	};
}

async function loadDetail(id: number): Promise<SlimDetail | null | typeof BUDGET> {
	const cacheFile = new URL(`${id}.json`, DETAIL_CACHE);
	if (await Bun.file(cacheFile).exists()) return Bun.file(cacheFile).json();
	const r = await fetchJSON(`${LL2}${id}/`);
	if (r === BUDGET || !r) return r === BUDGET ? BUDGET : null;
	const slim = slimDetail(r);
	await Bun.write(cacheFile, JSON.stringify(slim));
	return slim;
}

// The Apollo Lunar Module ascent/descent is logged as its own launch+landing, but the crew were
// already in space — counting it as a separate flight duplicates the mission and desyncs pairing.
const LM_LAUNCH_RE = /Apollo LM|Lunar Module/i;
const LM_CRAFT_RE = /^LM\b|Lunar Module/i;

/** Rebuild a person's flights by zipping their launches with their returns in chronological order.
 *  A person flies serially, so the i-th return after the i-th launch (and before the next) is theirs
 *  — robust to seat-swaps (up- and down-craft differ) and to a still-in-space final launch. Returns
 *  the summed bar duration so the caller can sanity-check it against the authoritative time_in_space. */
function reconstructFlights(slim: SlimDetail, deceased: boolean): { flights: Flight[]; status: Status; days: number } | null {
	const launches = slim.launches
		.filter((f) => !LM_LAUNCH_RE.test(f.name ?? ''))
		.map((f) => ({
			t: Date.parse(f.net),
			// flight.name is "Rocket | Spacecraft" — its suffix is the real vehicle (e.g. "Soyuz TMA-17M"),
			// a better bar label than the expedition (e.g. "ISS 44"); fall back to the mission name.
			name: cleanMission(f.name) || cleanMission(f.mission) || 'Spaceflight',
			sub: SUBORBITAL_RE.test(`${f.name ?? ''} ${f.mission ?? ''}`)
		}))
		.filter((x) => !Number.isNaN(x.t))
		.sort((a, b) => a.t - b.t);
	if (!launches.length) return null;
	const lands = slim.landings
		.map((l) => ({ t: Date.parse(l.end), craft: cleanMission(l.craft) }))
		.filter((x) => !Number.isNaN(x.t) && !LM_CRAFT_RE.test(x.craft))
		.sort((a, b) => a.t - b.t);

	const flights: Flight[] = [];
	let ri = 0;
	let days = 0; // summed from full timestamps so it can be compared against time_in_space precisely
	for (let i = 0; i < launches.length; i++) {
		const L = launches[i];
		const nextT = i + 1 < launches.length ? launches[i + 1].t : Infinity;
		let landMs: number | null = null;
		let craft = '';
		if (ri < lands.length && lands[ri].t >= L.t && lands[ri].t < nextT) {
			landMs = lands[ri].t;
			craft = lands[ri].craft;
			ri++;
		}
		const ongoing = landMs === null && slim.in_space && i === launches.length - 1;
		const endMs = ongoing ? Date.now() : (landMs ?? L.t);
		if (endMs > L.t) days += (endMs - L.t) / 86400000;
		// Seat-swap (returned on a different craft) is only reliably labelled for Soyuz, where both
		// the launch suffix and the landing craft are capsule names (e.g. up MS-24 / down MS-25).
		const swap = craft && craft !== L.name && /^Soyuz /i.test(L.name) && /^Soyuz /i.test(craft);
		flights.push({
			mission: L.name,
			launch: dayISO(L.t),
			landing: landMs !== null ? dayISO(landMs) : ongoing ? null : dayISO(L.t),
			ongoing,
			orbital: !L.sub,
			approx: landMs === null && !ongoing && !L.sub,
			segments: swap ? [L.name, craft] : undefined
		});
	}
	const status: Status = slim.in_space ? 'in-space' : deceased ? 'deceased' : 'living';
	return { flights, status, days };
}

// ---------------------------------------------------------------- matching
type Index = Map<string, LL2Astro[]>;
const uniq = (m: Index, k: string) => {
	const a = m.get(k);
	return a && a.length === 1 ? a[0] : undefined;
};
function buildIndex(records: LL2Astro[]) {
	const byWiki: Index = new Map();
	const byName: Index = new Map();
	const byKey: Index = new Map();
	const push = (m: Index, k: string, r: LL2Astro) => m.set(k, [...(m.get(k) ?? []), r]);
	for (const r of records) {
		const w = normWiki(r.wiki);
		if (w) push(byWiki, w, r);
		const n = normName(r.name);
		push(byName, n, r);
		const t = n.split(' ');
		if (t.length >= 2 && t[0]) push(byKey, `${t[t.length - 1]}|${t[0][0]}`, r);
	}
	return (p: Person): LL2Astro | undefined => {
		const w = p.wiki ? normWiki(p.wiki) : null;
		const n = normName(p.name);
		const t = n.split(' ');
		return (
			(w ? uniq(byWiki, w) : undefined) ??
			uniq(byName, n) ??
			(t.length >= 2 ? uniq(byKey, `${t[t.length - 1]}|${t[0][0]}`) : undefined)
		);
	};
}

/** Recompute the count/coverage fields of meta.json from the enriched people so the About page
 *  stays consistent (Layer 2 changes flight counts; Layer 1 changes agencies). Timestamps, sources
 *  and the build-time in-space cross-check list are left to update-data. */
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
	await Bun.write(META, JSON.stringify(meta, null, 2));
}

// ---------------------------------------------------------------- pipeline
async function main() {
	console.log('▶ LL2 enrichment (optional, resumable)…');
	if (API_KEY) console.log('  using LL2_API_KEY (authenticated tier).');
	const records = await loadList();
	if (records.length === 0) {
		console.log('  nothing to apply (no cache, no budget). Skipping.');
		return;
	}
	const findLL2 = buildIndex(records);
	const people: Person[] = await Bun.file(DATA).json();
	const usedSlugs = new Set(people.map((p) => p.slug));

	let agencyFixed = 0,
		natFixed = 0,
		namesRecovered = 0,
		spacewalks = 0,
		photos = 0,
		daysFixed = 0,
		daysBig = 0,
		barsFixed = 0,
		barsSkipped = 0,
		detailFetched = 0,
		detailRemaining = 0,
		unmatched = 0;
	const topCorrections: { name: string; from: number; to: number }[] = [];
	const natChanges: { name: string; from: string; to: string }[] = [];
	const agencyBlanked: { name: string; from: string }[] = [];

	for (const p of people) {
		const r = findLL2(p);
		if (!r) {
			unmatched++;
			continue;
		}

		// ----- Name recovery: Wikidata had no label, so build-data fell back to the bare QID -----
		// (e.g. Q957368 → Franco Malerba). Take LL2's name and rebuild a real, unique slug.
		if (/^Q\d+$/.test(p.name) && r.name?.trim()) {
			const id = (p.qid ?? p.id).toLowerCase();
			usedSlugs.delete(p.slug);
			p.name = r.name.trim();
			let slug = slugify(p.name) || id;
			if (usedSlugs.has(slug)) slug = `${slug}-${id}`;
			usedSlugs.add(slug);
			p.slug = slug;
			namesRecovered++;
		}

		// ----- Nationality (LL2 authoritative): demonym → country + ISO code -----
		const nat = resolveNationality(r.nationality, p.nationality);
		if (nat && (nat.nationality !== p.nationality || nat.countryCode !== p.countryCode)) {
			if (nat.nationality !== p.nationality) natChanges.push({ name: p.name, from: p.nationality, to: nat.nationality });
			p.nationality = nat.nationality;
			p.countryCode = nat.countryCode;
			natFixed++;
		}

		// ----- Agency (LL2 authoritative) -----
		// Canonical short name when LL2's label maps to one; otherwise LL2's own label fills a blank.
		// When LL2 has the person but lists NO agency, trust that and blank ours — these are private
		// space tourists (Tito, Simonyi, Laliberté, Akiyama…) that build-data wrongly tagged with a
		// nation-default like NASA. (ESA grouping is preserved: a non-canonical LL2 label only fills an
		// Unknown, it never re-labels someone already grouped.)
		const llAgency = r.agency?.name?.trim();
		const canonical = matchAgency([r.agency?.abbrev, r.agency?.name]);
		const newAgency = canonical ?? (llAgency ? (p.agency === 'Unknown' ? llAgency : undefined) : 'Unknown');
		if (newAgency && newAgency !== p.agency) {
			if (newAgency === 'Unknown') agencyBlanked.push({ name: p.name, from: p.agency });
			p.agency = newAgency;
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

		// ----- Days in space + flight bars, from per-person launches/returns -----
		// Trust LL2 only when its own flight data corroborates its time_in_space. When they disagree
		// — a few Apollo/Gemini/Skylab records have a buggy time_in_space or a broken landing date
		// (mission_end == launch) — Wikidata is correct (these crews didn't seat-swap), so keep it.
		if ((r.flights_count ?? 0) > 0) {
			// Prefer flights/landings inlined by ?mode=detailed; else fetch the per-astronaut page.
			const slim = Array.isArray(r.flights) ? slimDetail(r) : await loadDetail(r.id);
			if (slim === BUDGET || !slim) {
				detailRemaining++;
				continue;
			}
			detailFetched++;
			const rebuilt = reconstructFlights(slim, !!p.dod);
			const tisDays = durationToDays(slim.time_in_space);
			const healthy =
				!!rebuilt && rebuilt.flights.length > 0 && rebuilt.days > 0 && tisDays != null && tisDays > 0 && Math.abs(rebuilt.days - tisDays) <= 2;
			if (rebuilt && healthy) {
				const v = Math.floor(tisDays!);
				const delta = Math.abs(v - p.totalDaysInSpace);
				if (delta >= 1) {
					daysFixed++;
					if (delta >= 30) {
						daysBig++;
						topCorrections.push({ name: p.name, from: p.totalDaysInSpace, to: v });
					}
				}
				p.totalDaysInSpace = v;
				p.flights = rebuilt.flights;
				p.status = rebuilt.status;
				p.firstLaunch = rebuilt.flights[0].launch;
				const landed = rebuilt.flights.filter((f) => !f.ongoing && f.landing);
				p.lastLanding = rebuilt.status === 'in-space' ? null : landed.length ? landed[landed.length - 1].landing : null;
				barsFixed++;
			} else {
				barsSkipped++; // keep Wikidata number + bars
			}
		}
	}

	// firstLaunch may have shifted for detailed people — keep the canonical ordering.
	people.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));
	await Bun.write(DATA, JSON.stringify(people));
	await refreshMeta(people);

	topCorrections.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
	natChanges.sort((a, b) => a.name.localeCompare(b.name));
	console.log('\n──────── LL2 enrichment report ────────');
	console.log(`matched:           ${people.length - unmatched}/${people.length}  (unmatched ${unmatched})`);
	console.log(`days corrected:    ${daysFixed}  (${daysBig} by ≥30 days)`);
	console.log(`flight bars rebuilt:${barsFixed}  (kept Wikidata for ${barsSkipped} with inconsistent LL2 data; detail used: ${detailFetched})`);
	console.log(`names recovered:   ${namesRecovered}  (Wikidata had only a QID)`);
	console.log(`nationalities set:  ${natFixed}  (changed ${natChanges.length})`);
	console.log(`agencies refined:  ${agencyFixed}  (incl. ${agencyBlanked.length} agency-less tourists blanked)`);
	console.log(`spacewalk counts:  ${spacewalks}`);
	console.log(`photos filled:     ${photos}`);
	console.log(`network calls:     ${calls}`);
	if (detailRemaining) console.log(`detail remaining:  ${detailRemaining}  ← re-run \`bun run enrich-ll2\` to fetch more`);
	if (natChanges.length) {
		console.log('nationality changes:');
		for (const c of natChanges) console.log(`   ${c.name}: ${c.from} → ${c.to}`);
	}
	if (agencyBlanked.length) {
		console.log('agency blanked (LL2 lists no agency):');
		for (const c of agencyBlanked.sort((a, b) => a.name.localeCompare(b.name))) console.log(`   ${c.name}: ${c.from} → Unknown`);
	}
	if (topCorrections.length) {
		console.log('largest day fixes:');
		for (const c of topCorrections.slice(0, 8)) console.log(`   ${c.name}: ${c.from} → ${c.to}`);
	}
	console.log('  (re-running `bun run update-data` resets this — run enrich-ll2 again afterwards.)');
	console.log('───────────────────────────────────────\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
