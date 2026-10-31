/**
 * Station data — Stations, Expeditions and each Person's Stays — built from Launch Library 2 inside
 * enrich-ll2 (docs/adr/0001), which fetches the records and hands them to buildStations. The Stays go on
 * the Persons' Flights (docs/adr/0002); the Stations' lifetimes and the Expeditions become the station
 * dataset. Vocabulary as in CONTEXT.md.
 *
 *  - STAYS come from LL2's docking events. An event names no crew, only the launch of the craft that
 *    docked, so a Person's crew seat is found by launch: the craft they rode up (an astronaut record's
 *    `flights[].id`) boards them at its docking; the craft they came home in (`landings[].launch.id`)
 *    takes them off at its undocking. That handles seat-swaps (Thagard up on Soyuz TM-21, home on STS-71)
 *    and arrivals by one craft type for a stay of another (Solovyev and Budarin up on Atlantis). A craft's
 *    consecutive dockings at one Station are one run — moving to another port doesn't end a Stay — while
 *    flying to another Station does: Soyuz T-15 makes three Stays, Mir, Salyut 7, Mir.
 *  - EXPEDITIONS are LL2's expedition records, less the guest crews and the crews who never went aboard
 *    (both listed below). A Stay belongs to every Expedition whose LL2 crew list names that Person during
 *    it, so Pesquet's one Stay is in Expeditions 50 and 51; a Stay in none is a Visitor's.
 *  - Where a crew list names someone the docking events never put aboard (an event LL2 lacks), the Stay
 *    falls back to their Flight's dates, marked approximate.
 *
 * Everything is measured as of when the astronaut records were fetched, as enrich-ll2's flights are: a
 * docking after that, or an Expedition starting after it, hasn't happened yet, so replaying an old cache
 * reproduces the run that fetched it.
 */
import { STATIONS } from '../src/lib/stations';
import type { Expedition, Flight, Person, Stay, StationData, StationLife } from '../src/lib/types';

// ---------------------------------------------------------------- LL2 records (the fields read here)
export interface LL2Station {
	id: number;
	name: string;
	founded?: string | null;
	deorbited?: string | null;
}
export interface LL2Expedition {
	id: number;
	name: string;
	start: string;
	end?: string | null;
	spacestation?: { name?: string } | null;
	crew?: { astronaut?: { id: number; name?: string } | null }[];
}
export interface LL2Docking {
	id: number;
	launch_id?: string | null;
	docking?: string | null;
	departure?: string | null;
	docking_location?: { spacestation?: { name?: string } | null } | null;
}
/** An astronaut list record (`?mode=detailed`), for the launches it rode up and came home on. */
export interface LL2Rider {
	id: number;
	name?: string;
	flights?: { id?: string; name?: string | null; net?: string }[];
	landings?: { mission_end?: string | null; launch?: { id?: string; name?: string | null } | null }[];
	fetchedAt?: number;
}

export interface StationInput {
	stations: LL2Station[];
	expeditions: LL2Expedition[];
	dockings: LL2Docking[];
	riders: LL2Rider[];
	/** The Person each LL2 astronaut matched (or was backfilled as), with their final Flights. */
	personByLL2: Map<number, Person>;
	/** LL2's other records of people already in the dataset under a name variant (Evgeny/Yevgeny Tarelkin):
	 *  a crew list may name either record, and a person's launches are those of all their records. */
	aliasByLL2?: Map<number, Person>;
}

// ---------------------------------------------------------------- researched lists
// Crews who reached a Station but never went aboard: a docking that failed, or one whose hatch wouldn't
// open. LL2 logs Soyuz 10's docking, and lists several of these as "expeditions", so each is dropped from
// both — without this, the flight-date fallback would put the crew aboard. Matched by craft or record name.
const NEVER_ABOARD = [
	/\bSoyuz 10$/, // Apr 1971 — docked to Salyut 1 for 5½ hours, but the hatch wouldn't open
	/\bSoyuz 15$/, // Aug 1974 — its automatic docking system failed at Salyut 3
	/\bSoyuz 23$/, // Oct 1976 — couldn't dock with Salyut 5
	/\bSoyuz 25$/, // Oct 1977 — couldn't dock with Salyut 6
	/\bSoyuz 33$/, // Apr 1979 — its main engine failed on the approach to Salyut 6
	/\bSoyuz T-8$/ // Apr 1983 — its rendezvous antenna was torn off at launch; couldn't dock with Salyut 7
];
const neverAboard = (name?: string | null) => !!name && NEVER_ABOARD.some((re) => re.test(name.trim()));

// LL2 expedition records that are guest crews, not Expeditions: their Stays are Visitors'. A list rather
// than a rule, because neither obvious rule holds. By length ("an Expedition lasts 30 days or more"),
// Salyut 1's only crew (Soyuz 11, 23 days) and Tiangong-1's first (Shenzhou 9, 13 days) would be guests,
// and Merbold's 31-day Euromir 94 visit to Mir an Expedition. By nesting ("a Stay inside another crew's
// is a guest's"), residents would be guests, since Rubio's 371-day Stay holds other residents' whole ones.
const GUEST_CREWS = [
	/^Salyut [67] EP-\d+$/, // the Soviet "visiting expeditions": about a week, often with an Interkosmos guest
	/^Axiom Mission \d+$/, // Ax-1 to Ax-4: two or three weeks on the ISS alongside its Expedition
	/^Soyuz MS-20$/, // Maezawa and Hirano's 12-day visit, December 2021
	/^Challenge Movie Crew$/ // Peresild and Shipenko, filming "The Challenge", October 2021
];
const guestCrew = (name: string) => GUEST_CREWS.some((re) => re.test(name.trim()));

// …and guests that a resident record lists among its crew: [record, person].
const GUEST_MEMBERS: [RegExp, RegExp][] = [
	[/^Mir EO-27$/, /^Ivan Bella$/], // Slovakia's first cosmonaut: a week aboard in February 1999, home with EO-26
	[/^Expedition 70$/, /^Marina Vasilevskaya$/] // Belarus's first cosmonaut: two weeks aboard in March–April 2024
];
const guestMember = (record: string, person?: string | null) =>
	!!person && GUEST_MEMBERS.some(([r, p]) => r.test(record.trim()) && p.test(person.trim()));

// Craft whose docking events LL2 has wrong or lacks, replaced whole by these runs (UTC, from the missions'
// records; a bare date where the hour isn't known). A run spans its port moves. Matched by craft name, as above.
const DOCKING_FIXES: { craft: RegExp; runs: { station: string; dock: string; undock: string }[] }[] = [
	{ craft: /\bSoyuz 11$/, runs: [{ station: 'salyut-1', dock: '1971-06-07T07:45:00Z', undock: '1971-06-29T18:25:15Z' }] }, // no undocking
	{ craft: /\bSoyuz TM-28$/, runs: [{ station: 'mir', dock: '1998-08-15T10:56:54Z', undock: '1999-02-27T22:55:11Z' }] }, // undocked the 27th, not the 7th
	{ craft: /^STS-76$/, runs: [{ station: 'mir', dock: '1996-03-24T02:50:09Z', undock: '1996-03-29T01:08:03Z' }] }, // missing
	{ craft: /\bSoyuz TM-24$/, runs: [{ station: 'mir', dock: '1996-08-19T14:50:23Z', undock: '1997-03-02T03:24:57Z' }] }, // missing
	// 1987–88: LL2 files each of these undockings under the next craft (TM-2's under TM-3, TM-5's under TM-6…).
	{ craft: /\bSoyuz TM-2$/, runs: [{ station: 'mir', dock: '1987-02-07T23:27:40Z', undock: '1987-07-29T20:44:00Z' }] },
	{ craft: /\bSoyuz TM-3$/, runs: [{ station: 'mir', dock: '1987-07-24T03:31:23Z', undock: '1987-12-29T05:58:00Z' }] },
	{ craft: /\bSoyuz TM-4$/, runs: [{ station: 'mir', dock: '1987-12-23T12:51:00Z', undock: '1988-06-17T06:20:50Z' }] },
	{ craft: /\bSoyuz TM-5$/, runs: [{ station: 'mir', dock: '1988-06-09T15:57:10Z', undock: '1988-09-05T23:54:57Z' }] },
	{ craft: /\bSoyuz TM-6$/, runs: [{ station: 'mir', dock: '1988-08-31T05:40:44Z', undock: '1988-12-21T02:32:54Z' }] },
	{
		// LL2 has T-15 at Salyut 7 from 15 March to 16 July, overlapping its Mir docking, and no return to Mir.
		craft: /\bSoyuz T-15$/,
		runs: [
			{ station: 'mir', dock: '1986-03-15T13:38:42Z', undock: '1986-05-05T12:12:09Z' },
			{ station: 'salyut-7', dock: '1986-05-06', undock: '1986-06-25' },
			{ station: 'mir', dock: '1986-06-26', undock: '1986-07-16T09:09:50Z' }
		]
	}
];

// ---------------------------------------------------------------- naming
/** LL2's station name → a key of src/lib/stations.ts, or null for one never crewed (Salyut 2, Genesis). */
export function stationSlug(name?: string | null): string | null {
	const n = (name ?? '').trim().toLowerCase();
	if (n === 'international space station' || n === 'iss') return 'iss';
	if (/^tiangong( space station)?$/.test(n)) return 'tiangong';
	const slug = n.replace(/\s+/g, '-');
	return STATIONS[slug] ? slug : null;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
/** An Expedition's name as its Station gave it: "Salyut 6 EO-1" → "EO-1", "Skylab II" → "Skylab 2". */
function expeditionName(name: string): string {
	return name
		.trim()
		.replace(/^(?:Salyut \d|Mir)\s+(?=E[OP]-)/, '')
		.replace(/^Skylab (I{1,3}|IV)$/, (_, r: string) => `Skylab ${ROMAN[r]}`);
}

const slugify = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const craftName = (s?: string | null) => (s ?? '').split('|').pop()!.trim();
const DAY = 86400000;
const dayISO = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);

// ---------------------------------------------------------------- stays from dockings
/** A craft's time at one Station: consecutive dockings there merged, so a port move doesn't end it. */
interface Run {
	station: string;
	dock: number;
	undock: number | null;
}

/** Each craft's runs, by launch id. `names` gives each launch's craft name, for the researched lists. */
function runsByLaunch(dockings: LL2Docking[], names: Map<string, string>): Map<string, Run[]> {
	const byLaunch = new Map<string, { station: string; dock: number; undock: number | null }[]>();
	const seen = new Set<number>();
	for (const d of dockings) {
		if (seen.has(d.id)) continue;
		seen.add(d.id);
		const station = stationSlug(d.docking_location?.spacestation?.name);
		const dock = ms(d.docking);
		const name = names.get(d.launch_id ?? '');
		if (!d.launch_id || !station || Number.isNaN(dock) || neverAboard(name) || DOCKING_FIXES.some((x) => x.craft.test(name ?? ''))) continue;
		const undock = ms(d.departure);
		const list = byLaunch.get(d.launch_id) ?? [];
		list.push({ station, dock, undock: Number.isNaN(undock) ? null : undock });
		byLaunch.set(d.launch_id, list);
	}
	for (const [launch, name] of names)
		for (const x of DOCKING_FIXES)
			if (x.craft.test(name)) byLaunch.set(launch, x.runs.map((r) => ({ station: r.station, dock: ms(r.dock), undock: ms(r.undock) })));
	const runs = new Map<string, Run[]>();
	for (const [launch, events] of byLaunch) {
		events.sort((a, b) => a.dock - b.dock);
		const merged: Run[] = [];
		for (const e of events) {
			const last = merged.at(-1);
			if (last && last.station === e.station) last.undock = e.undock;
			else merged.push({ ...e });
		}
		runs.set(launch, merged);
	}
	return runs;
}

/** A Stay before it's placed on a Flight: full timestamps, either end possibly unknown. */
interface RawStay {
	station: string;
	arrive: number | null;
	depart: number | null;
}

/** Walk a rider's boardings and departures in time order. Only those within the rider's own trip count:
 *  the craft they came home in may have undocked to change ports long before they launched (and LL2 can
 *  lack the re-docking). A departure with no boarding before it (a docking LL2 lacks) or a boarding never
 *  followed by one (still aboard, or a missing undocking) leaves that end open, for placeOnFlight to fill
 *  from the Flight. */
function staysFromDockings(rider: LL2Rider, runs: Map<string, Run[]>, asOf: number): RawStay[] {
	const ups = (rider.flights ?? []).map((f) => ({ launch: f.id ?? '', t: ms(f.net) })).filter((x) => !Number.isNaN(x.t));
	const downs = (rider.landings ?? []).map((l) => ({ launch: l.launch?.id ?? '', t: ms(l.mission_end) })).filter((x) => !Number.isNaN(x.t));
	// Boarding, leaving — and landing, which ends any Stay whose undocking LL2 lacks.
	const BOARD = 0, LEAVE = 1, HOME = 2;
	const marks: { t: number; kind: number; station: string }[] = [];
	for (const u of ups) {
		const home = Math.min(asOf, ...downs.filter((d) => d.t >= u.t).map((d) => d.t));
		for (const r of runs.get(u.launch) ?? []) if (r.dock >= u.t && r.dock <= home) marks.push({ t: r.dock, kind: BOARD, station: r.station });
	}
	for (const d of downs) {
		const left = Math.max(-Infinity, ...ups.filter((u) => u.t <= d.t).map((u) => u.t));
		for (const r of runs.get(d.launch) ?? [])
			if (r.undock !== null && r.undock >= left && r.undock <= Math.min(d.t, asOf)) marks.push({ t: r.undock, kind: LEAVE, station: r.station });
		if (d.t <= asOf) marks.push({ t: d.t, kind: HOME, station: '' });
	}
	marks.sort((a, b) => a.t - b.t || a.kind - b.kind);

	const stays: RawStay[] = [];
	let aboard = null as { station: string; t: number } | null;
	for (const m of marks) {
		if (m.kind === BOARD) {
			if (aboard?.station === m.station) continue; // already aboard — another seat's craft arriving
			if (aboard) stays.push({ station: aboard.station, arrive: aboard.t, depart: null });
			aboard = { station: m.station, t: m.t };
		} else if (m.kind === LEAVE && aboard?.station === m.station) {
			stays.push({ station: m.station, arrive: aboard.t, depart: m.t });
			aboard = null;
		} else if (m.kind === LEAVE && !aboard) {
			stays.push({ station: m.station, arrive: null, depart: m.t });
		} else if (m.kind === HOME && aboard) {
			stays.push({ station: aboard.station, arrive: aboard.t, depart: null });
			aboard = null;
		}
	}
	if (aboard) stays.push({ station: aboard.station, arrive: aboard.t, depart: null });
	return stays;
}

// ---------------------------------------------------------------- placing stays on flights
const flightEnd = (f: Flight, today: string) => f.landing ?? (f.ongoing ? today : f.launch);
const shiftDay = (day: string, days: number) => dayISO(Date.parse(day) + days * DAY);

/** The Flight a moment falls in — or within two days of, since a Flight Wikidata dated (kept where LL2's
 *  own record is inconsistent) can be a day or two off the dockings. */
function flightAt(p: Person, day: string, today: string): Flight | undefined {
	return (
		p.flights.find((f) => f.launch <= day && day <= flightEnd(f, today)) ??
		p.flights.find((f) => shiftDay(f.launch, -2) <= day && day <= shiftDay(flightEnd(f, today), 2))
	);
}

/** Turn a RawStay into a Stay on the Flight it belongs to, clamped to that Flight's dates; an open end
 *  takes the Flight's own date and marks the Stay approximate. Returns null when no Flight holds it — or
 *  when the Stay runs more than two days past it, a Flight whose own dates are wrong (Wikidata gives Wang
 *  Haoze's Shenzhou 19 no landing), which clamping would only hide. */
function placeOnFlight(p: Person, raw: RawStay, today: string): Stay | null {
	const f = flightAt(p, dayISO((raw.arrive ?? raw.depart)!), today);
	if (!f) return null;
	const outside = (t: number | null) =>
		t !== null && (dayISO(t) < shiftDay(f.launch, -2) || dayISO(t) > shiftDay(flightEnd(f, today), 2));
	return outside(raw.arrive) || outside(raw.depart) ? null : addStay(f, raw, today);
}

function addStay(f: Flight, raw: RawStay, today: string): Stay {
	const end = flightEnd(f, today);
	const clamp = (d: string) => (d < f.launch ? f.launch : d > end ? end : d);
	const ongoing = raw.depart === null && f.ongoing;
	const stay: Stay = {
		station: raw.station,
		arrive: raw.arrive === null ? f.launch : clamp(dayISO(raw.arrive)),
		depart: ongoing ? null : raw.depart === null ? f.landing ?? end : clamp(dayISO(raw.depart)),
		ongoing,
		expeditions: [],
		approx: raw.arrive === null || (raw.depart === null && !ongoing)
	};
	(f.stays ??= []).push(stay);
	return stay;
}

const stayEnd = (s: Stay, today: string) => s.depart ?? today;
const overlapDays = (a0: string, a1: string, b0: string, b1: string) =>
	(Math.min(Date.parse(a1), Date.parse(b1)) - Math.max(Date.parse(a0), Date.parse(b0))) / DAY;

// ---------------------------------------------------------------- Expedition crews (for enrich-manual)
/** The slugs of everyone whose Stays name an Expedition, in the dataset's order. */
export function expeditionCrew(people: Person[], x: Expedition): string[] {
	return people
		.filter((p) => p.flights.some((f) => f.stays?.some((s) => s.station === x.station && s.expeditions.includes(x.slug))))
		.map((p) => p.slug);
}

/** Make `crew` the Expedition's whole membership: it's added to each listed person's Stays aboard its Station
 *  during it — by the same rule buildStations uses — and taken off everyone else's. Each Stay's Expeditions
 *  stay in date order. Returns the people it couldn't place, to report. */
export function setExpeditionCrew(people: Person[], x: Expedition, crew: string[], all: Expedition[]): string[] {
	const today = dayISO(Date.now());
	const starts = new Map(all.filter((e) => e.station === x.station).map((e) => [e.slug, e.start]));
	const bySlug = new Map(people.map((p) => [p.slug, p]));
	for (const p of people)
		for (const f of p.flights) for (const s of f.stays ?? []) if (s.station === x.station) s.expeditions = s.expeditions.filter((e) => e !== x.slug);
	const missed: string[] = [];
	for (const slug of crew) {
		const p = bySlug.get(slug);
		const at = (p?.flights ?? []).flatMap((f) => f.stays ?? []).filter((s) => s.station === x.station);
		const days = (s: Stay) => overlapDays(s.arrive, stayEnd(s, today), x.start, x.end ?? today);
		let mine = at.filter((s) => days(s) > 0);
		if (!mine.length) mine = at.filter((s) => days(s) === 0).slice(0, 1);
		if (!mine.length) missed.push(p ? `${p.name} (no Stay aboard during ${x.name})` : `"${slug}" (no such person)`);
		for (const s of mine) {
			s.expeditions.push(x.slug);
			s.expeditions.sort((a, b) => (starts.get(a) ?? '').localeCompare(starts.get(b) ?? ''));
		}
	}
	return missed;
}

// ---------------------------------------------------------------- Wikidata cross-check
/** A row of Wikidata's ISS Expedition crews: the Expedition's English label, and a crew member. */
export interface WikidataCrew {
	expedition: string;
	qid: string;
	name: string;
}

/** Where our ISS Expedition crews and Wikidata's disagree, one line per Expedition — warnings only, never a
 *  change. Only the Expeditions Wikidata lists crew for are compared (its "visiting mission" items have none),
 *  and only people with a Wikidata item can be matched. */
export function crossCheckWikidata(people: Person[], rows: WikidataCrew[]): string[] {
	const theirs = new Map<string, Map<string, string>>();
	for (const r of rows) {
		const n = r.expedition.match(/^Expedition (\d+)$/)?.[1];
		if (n) theirs.set(`expedition-${n}`, (theirs.get(`expedition-${n}`) ?? new Map()).set(r.qid, r.name));
	}
	const ours = new Map<string, Map<string, string>>();
	for (const p of people)
		for (const f of p.flights)
			for (const s of f.stays ?? [])
				if (s.station === 'iss' && p.qid)
					for (const x of s.expeditions) ours.set(x, (ours.get(x) ?? new Map()).set(p.qid, p.name));
	const lines: string[] = [];
	for (const [slug, crew] of [...theirs].sort((a, b) => Number(a[0].slice(11)) - Number(b[0].slice(11)))) {
		const mine = ours.get(slug) ?? new Map<string, string>();
		const onlyThem = [...crew].filter(([q]) => !mine.has(q)).map(([, n]) => n);
		const onlyUs = [...mine].filter(([q]) => !crew.has(q)).map(([, n]) => n);
		if (onlyThem.length || onlyUs.length)
			lines.push(
				`Expedition ${slug.slice(11)}: ${[...onlyThem.map((n) => `${n} (Wikidata only)`), ...onlyUs.map((n) => `${n} (ours only)`)].join(', ')}`
			);
	}
	return lines;
}

// ---------------------------------------------------------------- build
export interface StationReport {
	stays: number;
	visitorStays: number;
	approxStays: number;
	expeditions: Record<string, number>;
	guestRecords: number;
	neverAboard: string[];
	/** Crew a record names whom no Person matches, or whose Flight we can't find — by record. */
	unresolvedCrew: string[];
	/** Astronauts LL2 puts on a docked craft whom no Person matches — by craft. */
	unmatchedRiders: string[];
	/** Stays from dockings that fall in none of the Person's Flights. */
	unplaced: string[];
	/** Expeditions no Stay names. */
	empty: string[];
}

/** Build the station dataset and put each Person's Stays on their Flights (replacing any already there). */
export function buildStations({ stations, expeditions, dockings, riders, personByLL2, aliasByLL2 }: StationInput): {
	data: StationData;
	report: StationReport;
} {
	const asOf = Math.min(...riders.map((r) => r.fetchedAt ?? Date.now()));
	const today = dayISO(asOf);
	const people = new Set([...personByLL2.values(), ...(aliasByLL2?.values() ?? [])]);
	for (const p of people) for (const f of p.flights) delete f.stays;

	const report: StationReport = {
		stays: 0,
		visitorStays: 0,
		approxStays: 0,
		expeditions: {},
		guestRecords: 0,
		neverAboard: [],
		unresolvedCrew: [],
		unmatchedRiders: [],
		unplaced: [],
		empty: []
	};

	// Craft names by launch, for the researched lists.
	const names = new Map<string, string>();
	for (const r of riders) for (const f of r.flights ?? []) if (f.id) names.set(f.id, craftName(f.name));
	for (const name of new Set(names.values())) if (neverAboard(name)) report.neverAboard.push(name);
	const runs = runsByLaunch(dockings, names);

	// 1. Stays from dockings, from each person's launches across all their LL2 records.
	const ridesOf = new Map<Person, LL2Rider>();
	for (const r of riders) {
		const p = personByLL2.get(r.id) ?? aliasByLL2?.get(r.id);
		if (!p) {
			const docked = [...(r.flights ?? []).map((f) => f.id), ...(r.landings ?? []).map((l) => l.launch?.id)].find((id) => runs.has(id ?? ''));
			if (docked) report.unmatchedRiders.push(`${r.name ?? `LL2 #${r.id}`} (${names.get(docked) ?? docked})`);
			continue;
		}
		const had = ridesOf.get(p);
		if (!had) {
			ridesOf.set(p, r);
			continue;
		}
		const ups = new Set((had.flights ?? []).map((f) => f.id));
		const downs = new Set((had.landings ?? []).map((l) => l.launch?.id));
		ridesOf.set(p, {
			...had,
			flights: [...(had.flights ?? []), ...(r.flights ?? []).filter((f) => !ups.has(f.id))],
			landings: [...(had.landings ?? []), ...(r.landings ?? []).filter((l) => !downs.has(l.launch?.id))]
		});
	}
	for (const [p, r] of ridesOf)
		for (const raw of staysFromDockings(r, runs, asOf))
			if (!placeOnFlight(p, raw, today)) report.unplaced.push(`${p.name} (${raw.station}, ${dayISO(raw.arrive ?? raw.depart!)})`);

	// 2. Expeditions and guest crews, with the flight-date fallback for anyone the dockings missed.
	const seen = new Set<number>();
	const out: Expedition[] = [];
	const slugsByStation = new Map<string, Set<string>>();
	const records = expeditions
		.filter((e) => !seen.has(e.id) && seen.add(e.id))
		.sort((a, b) => ms(a.start) - ms(b.start) || a.id - b.id);
	for (const e of records) {
		const station = stationSlug(e.spacestation?.name);
		const start = ms(e.start);
		if (!station || Number.isNaN(start) || start > asOf) continue;
		if (neverAboard(e.name)) {
			if (!report.neverAboard.includes(e.name)) report.neverAboard.push(e.name);
			continue;
		}
		const guest = guestCrew(e.name);
		let exp: Expedition | null = null;
		if (guest) report.guestRecords++;
		else {
			const name = expeditionName(e.name);
			const taken = slugsByStation.get(station) ?? new Set<string>();
			let slug = slugify(name);
			if (taken.has(slug)) slug = `${slug}-${e.id}`;
			taken.add(slug);
			slugsByStation.set(station, taken);
			const endMs = ms(e.end);
			const ongoing = Number.isNaN(endMs) || endMs > asOf;
			exp = { slug, station, name, start: dayISO(start), end: ongoing ? null : dayISO(endMs), ongoing };
			out.push(exp);
		}
		const e0 = dayISO(start);
		const e1 = exp ? (exp.end ?? today) : Number.isNaN(ms(e.end)) ? today : dayISO(Math.min(ms(e.end), asOf));
		for (const c of e.crew ?? []) {
			const id = c.astronaut?.id ?? -1;
			const p = personByLL2.get(id) ?? aliasByLL2?.get(id);
			if (!p) {
				report.unresolvedCrew.push(`${c.astronaut?.name ?? '?'} (${e.name})`);
				continue;
			}
			// Their Stays at this Station during the record (both of Kizim's Mir Stays on T-15 are EO-1's)…
			const at = p.flights.flatMap((f) => f.stays ?? []).filter((s) => s.station === station);
			const days = (s: Stay) => overlapDays(s.arrive, stayEnd(s, today), e0, e1);
			let mine = at.filter((s) => days(s) > 0);
			if (!mine.length) mine = at.filter((s) => days(s) === 0).slice(0, 1); // a one-day record, or dates a day apart
			// …or, if the dockings never put them aboard, a Stay as long as the Flight that overlaps the record.
			if (!mine.length) {
				const during = p.flights.filter((f) => overlapDays(f.launch, flightEnd(f, today), e0, e1) >= 0);
				const f = during.find((f) => !f.stays?.length);
				if (!f) {
					// A guest record LL2 filed under the wrong Station (Salyut 6 EP-5, under Salyut 5) needs nothing:
					// the dockings already put its crew aboard the right one.
					if (!(guest && during.length)) report.unresolvedCrew.push(`${p.name} (${e.name})`);
					continue;
				}
				mine = [addStay(f, { station, arrive: null, depart: null }, today)];
			}
			if (exp && !guestMember(e.name, c.astronaut?.name))
				for (const s of mine) if (!s.expeditions.includes(exp.slug)) s.expeditions.push(exp.slug);
		}
	}

	// Tidy: Stays in order on each Flight; tally.
	const named = new Set<string>();
	for (const p of people)
		for (const f of p.flights) {
			if (!f.stays) continue;
			f.stays.sort((a, b) => a.arrive.localeCompare(b.arrive));
			for (const s of f.stays) {
				report.stays++;
				if (!s.expeditions.length) report.visitorStays++;
				if (s.approx) report.approxStays++;
				for (const x of s.expeditions) named.add(`${s.station}/${x}`);
			}
		}
	const order = Object.keys(STATIONS);
	out.sort((a, b) => order.indexOf(a.station) - order.indexOf(b.station) || a.start.localeCompare(b.start));
	for (const x of out) {
		report.expeditions[x.station] = (report.expeditions[x.station] ?? 0) + 1;
		if (!named.has(`${x.station}/${x.slug}`)) report.empty.push(`${x.station}/${x.slug}`);
	}

	const lives: StationLife[] = [];
	for (const s of stations) {
		const slug = stationSlug(s.name);
		if (slug && s.founded) lives.push({ slug, launched: s.founded.slice(0, 10), deorbited: s.deorbited ? s.deorbited.slice(0, 10) : null });
	}
	lives.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
	return { data: { stations: lives, expeditions: out }, report };
}
