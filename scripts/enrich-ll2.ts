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
 * LL2 also corrects two descriptive attributes Wikidata gets wrong: NATIONALITY (Wikidata often stores a
 * birthplace — Kononenko → Turkmenistan — or a stale/secondary citizenship; LL2's demonym is closer to
 * the flown-under nation, though Supercluster later supplies the full list, see scripts/nationality.ts)
 * and AGENCY (LL2's affiliation fills the gaps Wikidata leaves blank, e.g. Korea/Yi So-yeon; it's the
 * present-day one, so scripts/agency.ts then dates it flight by flight — NASDA before JAXA). Also
 * fills spacewalk counts and photos.
 *
 * Data comes from the astronaut LIST fetched with `?mode=detailed`, which inlines each person's
 * flights & landings — so the whole dataset is ~9 paginated calls, not one per astronaut. (If a
 * record lacks inline flights — e.g. an older cached page — it falls back to the per-astronaut
 * detail endpoint.) LL2's public tier is heavily rate-limited (~15 calls/hour), so this paces calls,
 * honours `Retry-After`, backs off, and caches every page — a cold full run resumes where it left
 * off. List pages older than LL2_CACHE_HOURS are re-fetched, so a later run picks up launches and
 * landings since; an old page is reused only when it can't be refreshed (or MAX_LL2_CALLS=0), and then
 * measures anyone in space as of when it was fetched, so replaying a cache reproduces the run that
 * fetched it rather than drifting as the days pass. And since LL2 can still lag
 * Wikidata, a flight Wikidata already has but LL2 hasn't logged is kept, never rolled back. The site
 * is fully functional WITHOUT this step.
 *
 *   bun run enrich-ll2                       # Layer 1 + 2: fetch what's missing or stale, merge, save
 *   MAX_LL2_CALLS=50 bun run enrich-ll2      # do 50 network calls then stop (re-run to continue)
 *   MAX_LL2_CALLS=0 bun run enrich-ll2       # apply already-cached pages only (no network)
 *   LL2_CACHE_HOURS=0 bun run enrich-ll2     # re-fetch every list page now (default: reuse pages < 6h old)
 *   LL2_DELAY_MS=4000 bun run enrich-ll2     # gentler pacing between calls (default 2000ms)
 *   LL2_API_KEY=… bun run enrich-ll2         # authenticated tier (higher throttle ceiling)
 *
 * NOTE: run AFTER `bun run update-data` (which rebuilds astronauts.json from Wikidata). Re-running
 * is idempotent given the cache.
 */
import type { Flight, Gender, Meta, Person, Status } from '../src/lib/types';
import { agencyOf, settleAgencies } from './agency';
import { DATA, paddedDate, writeAstronauts } from './dataset';
import { settleNationalities } from './nationality';
import { neverReachedSpace, suborbitalAbort } from './spaceflight';

const UA = 'PisteDataPipeline/1.0 (https://github.com/piste; static people-in-space timeline)';
const LL2 = 'https://ll.thespacedevs.com/2.2.0/astronaut/';
const PAGE = 100;
const ROOT = new URL('..', import.meta.url);
const CACHE = new URL('scripts/cache/ll2/', ROOT);
const DETAIL_CACHE = new URL('scripts/cache/ll2/detail/', ROOT);
const META = new URL('src/lib/data/meta.json', ROOT);

// ---- throttle / budget knobs ----
const DELAY_MS = Number(process.env.LL2_DELAY_MS ?? 2000); // pause between successful network calls
const MAX_CALLS = Number(process.env.MAX_LL2_CALLS ?? Infinity); // network-call budget for this run (0 = offline)
const MAX_RETRIES = Number(process.env.LL2_MAX_RETRIES ?? 6);
const CACHE_HOURS = Number(process.env.LL2_CACHE_HOURS ?? 6); // cached list pages older than this are re-fetched
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

// LL2 affiliations that name no agency in src/lib/agencies.ts, deliberately: the person keeps the agency
// they had. Any other label that maps to none is reported, to be added to scripts/agency.ts.
const LL2_NOT_AGENCIES = new Set([
	'Boeing', // Christopher Ferguson's employer after NASA; he never flew Starliner
	'Lockheed Martin', // payload specialists on NASA science missions fly for NASA (Acton, Spacelab 2)
	'US Navy', // … likewise Bartoe, a Naval Research Laboratory scientist
	'International Institute for Aeronautical Sciences', // a nonprofit that bought Kellie Gerardi's Virgin Galactic seat
	'National Research Council', // ambiguous (Canada's NRC or Italy's CNR) — Carlucci is in scripts/agency.ts
	'Space Research Institute of Saudi Arabia', // Sultan bin Salman flew for ARABSAT — scripts/agency.ts
	'Bulgarian Space Agency', // Aleksandrov flew under Interkosmos — scripts/agency.ts
	'Turkish Air Force' // Gezeravcı flew for the Turkish Space Agency — scripts/agency.ts
]);
const unmappedAgencies = new Set<string>();
/** LL2's affiliation as an agency key: undefined when LL2 lists none, null when it maps to none. */
function ll2Agency(agency: LL2Astro['agency']): string | null | undefined {
	const label = agency?.name?.trim();
	if (!label) return undefined;
	const key = agencyOf(label) ?? agencyOf(agency?.abbrev);
	if (!key && !LL2_NOT_AGENCIES.has(label)) unmappedAgencies.add(label);
	return key ?? null;
}

// LL2 reports nationality as a demonym ("Russian"), occasionally compound ("Vietnamese American").
// It beats Wikidata, which frequently stores a *birthplace* (Kononenko → Turkmenistan) or a
// historic/secondary citizenship. Map each demonym to its name in src/lib/countries.ts.
const DEMONYM: Record<string, string> = {
	American: 'United States', Russian: 'Russia', Chinese: 'China', Canadian: 'Canada',
	French: 'France', German: 'Germany', Japanese: 'Japan', British: 'United Kingdom',
	Italian: 'Italy', Ukrainian: 'Ukraine', Kazakh: 'Kazakhstan', Spanish: 'Spain',
	Indian: 'India', Belgian: 'Belgium', Hungarian: 'Hungary', Polish: 'Poland',
	Dutch: 'Netherlands', Saudi: 'Saudi Arabia', Australian: 'Australia', Turkish: 'Turkey',
	Swiss: 'Switzerland', Bulgarian: 'Bulgaria', Swedish: 'Sweden', Belarusian: 'Belarus',
	Mexican: 'Mexico', Brazilian: 'Brazil', Israeli: 'Israel', Czech: 'Czechia',
	Austrian: 'Austria', Emirati: 'United Arab Emirates', Antiguan: 'Antigua and Barbuda',
	Slovak: 'Slovakia', Syrian: 'Syria', Mongolian: 'Mongolia', Danish: 'Denmark',
	Afghan: 'Afghanistan', Vietnamese: 'Vietnam', Romanian: 'Romania', Kyrgyz: 'Kyrgyzstan',
	Malaysian: 'Malaysia', Cuban: 'Cuba', Iranian: 'Iran', Portuguese: 'Portugal',
	Egyptian: 'Egypt', Pakistani: 'Pakistan', Singaporean: 'Singapore', Maltese: 'Malta',
	Panamanian: 'Panama', Norwegian: 'Norway', Bahamian: 'Bahamas', Kittitian: 'Saint Kitts and Nevis',
	Kiwi: 'New Zealand', Greek: 'Greece', Nigerian: 'Nigeria', 'Puerto Rican': 'United States',
	'South Korean': 'South Korea', 'South African': 'South Africa'
};

/** Resolve an LL2 demonym to one country. Multi-word demonyms ("South Korean") are matched whole;
 *  compound ones ("Vietnamese American", "American Australian") are split into their parts — if one
 *  part is already among the person's nationalities we keep it (LL2 confirms that citizenship),
 *  otherwise the first listed wins. Only one: LL2's compounds mix heritage in ("Vietnamese American"
 *  is a US-born American), so the multi-nationality list is left to Supercluster. Returns null when
 *  unmappable (e.g. "Earthling" test dummies) so the caller leaves the existing value untouched. */
function resolveNationality(demonym: string | null | undefined, current: string[]): string | null {
	if (!demonym) return null;
	if (DEMONYM[demonym]) return DEMONYM[demonym];
	const tokens = demonym.split(' ');
	const parts: string[] = [];
	for (let i = 0; i < tokens.length; ) {
		const two = tokens.slice(i, i + 2).join(' ');
		if (DEMONYM[two]) { parts.push(DEMONYM[two]); i += 2; }
		else if (DEMONYM[tokens[i]]) { parts.push(DEMONYM[tokens[i]]); i += 1; }
		else i += 1;
	}
	return parts.find((p) => current.includes(p)) ?? parts[0] ?? null;
}

// Crewed *suborbital* programs — their "flights" are same-day, with no orbital re-entry / landing record.
const SUBORBITAL_RE =
	/New Shepard|Blue Origin|Virgin Galactic|SpaceShip(One|Two)?|VSS |\bX-15\b|Mercury-Redstone|Freedom 7|Liberty Bell 7/i;
const cleanMission = (s?: string | null) => (s ? (s.includes('|') ? s.split('|').pop()!.trim() : s.trim()) : '');

// SpaceShipTwo/One glide (GF), captive-carry (CC), cold-flow (CF) and powered (PF) runs are logged as
// "flights" but never reached space — the VSS Enterprise era topped out ~22 km. Drop them so a test
// pilot keeps only real spaceflights (e.g. Mark Stucky's 30 LL2 entries collapse to one: VSS Unity VP-03).
const SS2_TEST_CODE = /^(GF|CF|CC|PF)\d*$/i;
const isSpaceShipTest = (name?: string | null) =>
	/SpaceShip(One|Two)/i.test(name ?? '') && SS2_TEST_CODE.test((name ?? '').split('|').pop()!.trim().split(' ').pop()!);

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
	// Used by the backfill layer (people Wikidata missed) — present on every list record.
	bio?: string | null;
	nationality?: string | null;
	date_of_birth?: string | null;
	date_of_death?: string | null;
	profile_image?: string | null;
	first_flight?: string | null;
	// Ours, not LL2's: when the record was fetched (ms) — see reconstructFlights.
	fetchedAt?: number;
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
	fetchedAt?: number;
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
let stalePages = 0; // cached pages past CACHE_HOURS that we fell back to because they couldn't be refreshed
async function loadList(): Promise<LL2Astro[]> {
	const records: LL2Astro[] = [];
	let offset = 0;
	let total = Infinity;
	let gaveUp = false; // LL2 down / hard-throttled — don't sit through the retries again for every page
	while (offset < total) {
		// The cache is for resuming an interrupted run, not for pinning LL2 to an old snapshot — a page
		// past CACHE_HOURS is re-fetched, and only reused if that fails (budget spent, offline, gave up).
		const cacheFile = Bun.file(new URL(`ll2-${offset}.json`, CACHE));
		const cached = await cacheFile.exists();
		let data: { count?: number; results?: LL2Astro[]; fetchedAt?: number };
		if (cached && Date.now() - cacheFile.lastModified < CACHE_HOURS * 3600_000) {
			data = await cacheFile.json();
		} else {
			const r = gaveUp ? null : await fetchJSON(`${LL2}?mode=detailed&limit=${PAGE}&offset=${offset}`);
			if (r && r !== BUDGET) {
				data = { ...r, fetchedAt: Date.now() };
				await Bun.write(cacheFile, JSON.stringify(data));
				console.log(`  list: fetched offset ${offset} (${calls} calls)`);
			} else if (cached) {
				gaveUp ||= r === null;
				data = await cacheFile.json();
				stalePages++;
			} else {
				if (r === BUDGET) console.log(`  list: call budget reached at offset ${offset} — re-run to continue.`);
				break;
			}
		}
		total = data.count ?? total;
		const fetchedAt = data.fetchedAt ?? cacheFile.lastModified; // pages cached before fetchedAt: written when fetched
		records.push(...(data.results ?? []).map((r) => ({ ...r, fetchedAt })));
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
			.filter((x: any) => x.end),
		fetchedAt: d.fetchedAt
	};
}

async function loadDetail(id: number): Promise<SlimDetail | null | typeof BUDGET> {
	const cacheFile = Bun.file(new URL(`${id}.json`, DETAIL_CACHE));
	if (await cacheFile.exists()) {
		const slim: SlimDetail = await cacheFile.json();
		return { ...slim, fetchedAt: slim.fetchedAt ?? cacheFile.lastModified };
	}
	const r = await fetchJSON(`${LL2}${id}/`);
	if (r === BUDGET || !r) return r === BUDGET ? BUDGET : null;
	const slim = { ...slimDetail(r), fetchedAt: Date.now() };
	await Bun.write(cacheFile, JSON.stringify(slim));
	return slim;
}

// The Apollo Lunar Module ascent/descent is logged as its own launch+landing, but the crew were
// already in space — counting it as a separate flight duplicates the mission and desyncs pairing.
const LM_LAUNCH_RE = /Apollo LM|Lunar Module/i;
const LM_CRAFT_RE = /^LM\b|Lunar Module/i;
// What a craft is compared by: a launch can carry aliases its landing record leaves off ("Soyuz 7K-T No.39
// (Soyuz 18a / Soyuz 18-1)" lands as "Soyuz 7K-T No.39"), so a trailing parenthetical and spacing don't count.
const craftKey = (name: string) => name.replace(/\s*\([^()]*\)$/, '').replace(/\s+/g, '');

/** Rebuild a person's flights by zipping their launches with their returns in chronological order.
 *  A person flies serially, so the i-th return after the i-th launch (and before the next) is theirs
 *  — robust to seat-swaps (up- and down-craft differ) and to a still-in-space final launch. Launches
 *  that never reached space (SpaceShipTwo's atmospheric tests, Apollo 1, Challenger…) are zipped too,
 *  then dropped, so each return pairs with its own launch: filtered out first, their returns would stall
 *  the pairing and leave every later flight without one. Returns the summed bar duration so the caller
 *  can sanity-check it against the authoritative time_in_space (which a stalled pairing fails: Mackay's
 *  and Masucci's VSS Unity flights would sum to zero days). */
function reconstructFlights(slim: SlimDetail, deceased: boolean): { flights: Flight[]; status: Status; days: number } | null {
	const launches = slim.launches
		.filter((f) => !LM_LAUNCH_RE.test(f.name ?? ''))
		.map((f) => ({
			t: Date.parse(f.net),
			// flight.name is "Rocket | Spacecraft" — its suffix is the real vehicle (e.g. "Soyuz TMA-17M"),
			// a better bar label than the expedition (e.g. "ISS 44"); fall back to the mission name.
			name: cleanMission(f.name) || cleanMission(f.mission) || 'Spaceflight',
			sub:
				SUBORBITAL_RE.test(`${f.name ?? ''} ${f.mission ?? ''}`) ||
				suborbitalAbort(cleanMission(f.name)) ||
				suborbitalAbort(cleanMission(f.mission)),
			never: isSpaceShipTest(f.name) || neverReachedSpace(cleanMission(f.name)) || neverReachedSpace(cleanMission(f.mission))
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
		if (L.never) continue;
		const ongoing = landMs === null && slim.in_space && i === launches.length - 1;
		// A flight still in space runs to when LL2 was asked, not to now: the time_in_space the caller checks
		// it against is from then too, so replaying an old cache reaches the same verdict as the run that
		// fetched it.
		const endMs = ongoing ? (slim.fetchedAt ?? Date.now()) : (landMs ?? L.t);
		if (endMs > L.t) days += (endMs - L.t) / 86400000;
		// Seat-swap (returned on a different craft) is only reliably labelled for Soyuz, where both
		// the launch suffix and the landing craft are capsule names (e.g. up MS-24 / down MS-25).
		const swap = craft && craftKey(craft) !== craftKey(L.name) && /^Soyuz /i.test(L.name) && /^Soyuz /i.test(craft);
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

/** True when Wikidata already has the person on a flight that launched after their last LL2 return —
 *  LL2's record predates it (a page cached before the launch, or a launch LL2 hasn't logged yet), so a
 *  rebuild would drop that flight and mark someone in orbit as landed (e.g. Watkins on Crew-13 while
 *  LL2 still listed only Crew-4). Two days' slack absorbs the sources' differing date conventions;
 *  future-dated (planned) Wikidata flights don't count. */
function wikidataAhead(wikidata: Flight[], ll2: Flight[]): boolean {
	const last = ll2.at(-1);
	if (!last || last.ongoing) return false; // LL2 already has them in space
	const returned = Date.parse(last.landing ?? last.launch) + 2 * 86400000;
	return wikidata.some((f) => {
		const t = Date.parse(f.launch);
		return t > returned && t <= Date.now();
	});
}

// ---------------------------------------------------------------- Layer 3: backfill (people Wikidata missed)
// Wikidata is the base list, but it lacks items (or crew-links) for most recent suborbital tourists —
// so build-data never sees them. LL2 catalogs ~800 people who have flown; this adds the flown ones no
// existing person matched. They reached space under the broad US 50-mile/80 km definition the dataset
// already uses (it includes Virgin Galactic, whose SpaceShipTwo tops out ~85 km, below the Kármán line).
//
// Three things are deliberately NOT added:
//   • non-human test articles LL2 lists as "astronauts" (mannequins, mascots, zero-g indicators);
//   • people already present under a name variant the surname+initial matcher missed (exact-DOB guard);
//   • people who never reached space — SpaceShipTwo atmospheric test pilots whose only flights were
//     glide/powered runs (the VSS Enterprise era never crossed 80 km), and anyone left with no flight once
//     reconstructFlights drops the launches that never got there (scripts/spaceflight.ts): Chaffee on
//     Apollo 1; McAuliffe, Jarvis and Smith on Challenger.
const NON_HUMAN = new Set(
	['Mannequin Skywalker', 'Starman', 'Little Earth', 'Ripley', 'Rosie the Astronaut',
	 'Commander Moonikin Campos', 'Helga', 'Zohar', 'Shaun the Sheep', 'Snoopy'].map(normName)
);
const NEVER_REACHED_SPACE = new Set(
	['Peter Siebold', 'Michael Alsbury', 'Clint Nichols', 'Doug Shane', 'William Brian Binnie', 'Keith Colmer'].map(normName)
);

// LL2 has no gender field; infer from the bio's pronouns (best-effort — else 'unknown').
function genderFromBio(bio?: string | null): Gender {
	const b = ` ${(bio ?? '').toLowerCase()} `;
	const f = (b.match(/\b(?:she|her|hers)\b/g) ?? []).length;
	const m = (b.match(/\b(?:he|his|him)\b/g) ?? []).length;
	if (f > m) return 'female';
	if (m > f) return 'male';
	return 'unknown';
}

/** Already in the dataset under a name variant? True when the candidate shares an exact birth date and
 *  a ≥3-char name token with an existing person — catches Evgeny/Yevgeny Tarelkin, Wang Haozhe/Haoze,
 *  Uznański/Uznański-Wiśniewski, Robert S./Shane Kimbrough, Gregory R./Reid Wiseman (the surname+initial
 *  matcher misses these). Exact-DOB keeps it tight: same-surname-same-year collisions don't trip it. */
function isVariantDuplicate(r: LL2Astro, tokensByDob: Map<string, Set<string>>): boolean {
	const dob = r.date_of_birth?.slice(0, 10);
	const have = dob ? tokensByDob.get(dob) : undefined;
	if (!have) return false;
	for (const tok of normName(r.name).replace(/-/g, ' ').split(' ')) if (tok.length >= 3 && have.has(tok)) return true;
	return false;
}

/** Build new Person records for flown LL2 people no existing person matched. Pure cache work — no
 *  network. Returns the additions and a skip tally for the report. */
function backfillFromLL2(records: LL2Astro[], people: Person[], matchedIds: Set<number>, usedSlugs: Set<string>) {
	const tokensByDob = new Map<string, Set<string>>();
	for (const p of people) {
		if (!p.dob) continue;
		const dob = paddedDate(p.dob); // LL2's form of it, so a month-only "1975-10" still meets its "1975-10-01"
		const s = tokensByDob.get(dob) ?? new Set<string>();
		for (const tok of normName(p.name).replace(/-/g, ' ').split(' ')) if (tok.length >= 3) s.add(tok);
		tokensByDob.set(dob, s);
	}
	const added: Person[] = [];
	const skipped = { nonHuman: 0, neverSpace: 0, variantDup: 0, noFlights: 0 };
	const byAgency: Record<string, number> = {};
	for (const r of records) {
		if (matchedIds.has(r.id)) continue;
		if ((r.flights_count ?? 0) < 1 && !r.first_flight) continue; // not flown
		const key = normName(r.name);
		if (NON_HUMAN.has(key)) { skipped.nonHuman++; continue; }
		if (NEVER_REACHED_SPACE.has(key)) { skipped.neverSpace++; continue; }
		if (isVariantDuplicate(r, tokensByDob)) { skipped.variantDup++; continue; }

		const dod = r.date_of_death ? r.date_of_death.slice(0, 10) : null;
		const slim = slimDetail(r);
		const rebuilt = reconstructFlights(slim, !!dod); // SS2 atmospheric tests and launches that never reached space dropped inside
		if (!rebuilt || rebuilt.flights.length === 0) {
			skipped[slim.launches.length ? 'neverSpace' : 'noFlights']++; // launches, but none reached space
			continue;
		}

		const nat = resolveNationality(r.nationality, []);
		const agency = ll2Agency(r.agency);
		const tisDays = durationToDays(r.time_in_space);
		const days = Math.round(tisDays != null && tisDays > 0 ? tisDays : rebuilt.days);
		let slug = slugify(r.name) || `ll2-${r.id}`;
		if (usedSlugs.has(slug)) slug = `${slug}-ll2-${r.id}`;
		usedSlugs.add(slug);
		const landed = rebuilt.flights.filter((f) => !f.ongoing && f.landing);

		added.push({
			id: `ll2-${r.id}`,
			qid: null,
			name: r.name,
			slug,
			nationalities: nat ? [nat] : [], // settled with everyone else's once the backfill is in
			gender: genderFromBio(r.bio),
			agencies: agency ? [agency] : [], // likewise
			status: rebuilt.status,
			dob: r.date_of_birth ? r.date_of_birth.slice(0, 10) : null,
			dod,
			wiki: r.wiki ?? null,
			image: r.profile_image ?? r.profile_image_thumbnail ?? null,
			totalDaysInSpace: days,
			firstLaunch: rebuilt.flights[0].launch,
			lastLanding: rebuilt.status === 'in-space' ? null : landed.length ? landed[landed.length - 1].landing : null,
			flights: rebuilt.flights,
			spacewalks: r.spacewalks_count ?? 0
		});
		const label = agency ?? r.agency?.name?.trim() ?? 'none';
		byAgency[label] = (byAgency[label] ?? 0) + 1;
	}
	return { added, skipped, byAgency };
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

	let namesRecovered = 0,
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
	const agencyChanges: { name: string; from: string; to: string }[] = [];
	const agencyBlanked: { name: string; from: string }[] = [];
	const lagging: string[] = []; // LL2 hasn't caught up with a flight Wikidata already has
	const matchedIds = new Set<number>(); // LL2 records claimed by a person — the rest feed the backfill
	const natBefore = new Map(people.map((p) => [p.id, p.nationalities.join(' + ')]));
	const agencyBefore = new Map(people.map((p) => [p.id, p.agencies.join(' + ')]));

	for (const p of people) {
		const r = findLL2(p);
		if (!r) {
			unmatched++;
			continue;
		}
		matchedIds.add(r.id);

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

		// ----- Nationality: LL2's demonym, unless it's already one of ours (settled below, once flights are rebuilt) -----
		const nat = resolveNationality(r.nationality, p.nationalities);
		if (nat && !p.nationalities.includes(nat)) p.nationalities = [nat];

		// ----- Agency (LL2 authoritative): its present-day affiliation, dated flight by flight below -----
		// When LL2 has the person but lists NO agency, trust that and blank ours — these are private
		// space tourists (Tito, Simonyi, Laliberté, Akiyama…) that build-data wrongly tagged with a
		// nation-default like NASA. An affiliation that names no agency (a payload specialist's
		// employer) leaves ours alone.
		const agency = ll2Agency(r.agency);
		if (agency === undefined) {
			if (p.agencies.length) agencyBlanked.push({ name: p.name, from: p.agencies.join(' + ') });
			p.agencies = [];
		} else if (agency) p.agencies = [agency];
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
			const behind = !!rebuilt && wikidataAhead(p.flights, rebuilt.flights);
			if (behind) lagging.push(p.name);
			if (rebuilt && healthy && !behind) {
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

	// ----- Layer 3: backfill people Wikidata missed (mostly recent suborbital tourists) -----
	const before = people.length;
	const { added, skipped, byAgency } = backfillFromLL2(records, people, matchedIds, usedSlugs);
	people.push(...added);

	// Settle nationalities and agencies against the rebuilt flights (a flight before 26 Dec 1991 is a
	// Soviet one, a Japanese flight before October 2003 NASDA's).
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

	// firstLaunch may have shifted for detailed people — keep the canonical ordering.
	people.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));
	await writeAstronauts(people);
	await refreshMeta(people);

	topCorrections.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
	natChanges.sort((a, b) => a.name.localeCompare(b.name));
	console.log('\n──────── LL2 enrichment report ────────');
	console.log(`matched:           ${before - unmatched}/${before}  (unmatched ${unmatched})`);
	console.log(
		`backfilled:        +${added.length}  (${before} → ${people.length})  ` +
			`skipped ${skipped.nonHuman} non-human, ${skipped.variantDup} name-variant dupes, ${skipped.neverSpace} never-reached-space`
	);
	if (added.length) console.log(`   by agency: ${Object.entries(byAgency).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
	console.log(`days corrected:    ${daysFixed}  (${daysBig} by ≥30 days)`);
	console.log(`flight bars rebuilt:${barsFixed}  (kept Wikidata for ${barsSkipped} with inconsistent LL2 data; detail used: ${detailFetched})`);
	if (lagging.length) console.log(`   LL2 behind Wikidata (newer flight kept): ${lagging.join(', ')}`);
	console.log(`names recovered:   ${namesRecovered}  (Wikidata had only a QID)`);
	console.log(`nationalities:     ${natChanges.length} changed`);
	console.log(`agencies:          ${agencyChanges.length} changed  (incl. ${agencyBlanked.length} agency-less tourists blanked)`);
	if (unmappedAgencies.size) console.log(`   ⚠ unmapped LL2 agencies (add to scripts/agency.ts): ${[...unmappedAgencies].join(', ')}`);
	console.log(`spacewalk counts:  ${spacewalks}`);
	console.log(`photos filled:     ${photos}`);
	console.log(`network calls:     ${calls}`);
	if (stalePages) console.log(`stale list pages:  ${stalePages}  ← older than ${CACHE_HOURS}h and couldn't be refreshed; re-run \`bun run enrich-ll2\``);
	if (detailRemaining) console.log(`detail remaining:  ${detailRemaining}  ← re-run \`bun run enrich-ll2\` to fetch more`);
	if (natChanges.length) {
		console.log('nationality changes:');
		for (const c of natChanges) console.log(`   ${c.name}: ${c.from} → ${c.to}`);
	}
	if (agencyChanges.length) {
		console.log('agency changes:');
		for (const c of agencyChanges.sort((a, b) => a.name.localeCompare(b.name))) console.log(`   ${c.name}: ${c.from || '—'} → ${c.to || '—'}`);
	}
	if (agencyBlanked.length) {
		console.log('agency blanked (LL2 lists no agency):');
		for (const c of agencyBlanked.sort((a, b) => a.name.localeCompare(b.name))) console.log(`   ${c.name}: ${c.from} → —`);
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
