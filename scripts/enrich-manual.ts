/**
 * FINAL enrichment layer — hand-authored manual overrides (scripts/overrides.ts).
 *
 * Runs LAST, after update-data → enrich-ll2 → enrich-supercluster. Every other layer derives values
 * from a data source; this one lets you correct anything by hand and have the last word. For each
 * person in overrides.ts, any field you give a value to WINS over what the pipeline computed.
 * Emptying a field ('' / null / [] / or deleting the line) drops the override, so the field reverts
 * to whatever the pipeline produced — "the last value that was there before". This layer can only
 * SET values, never blank them (emptying == revert); to clear a field, fix it upstream.
 *
 * How reverting works without re-running the whole chain: this keeps a gitignored baseline of
 * (pipeline value, value written) for every field it touches, at scripts/cache/manual/baseline.json.
 * On each run it first restores those fields to their pipeline value — but ONLY when the file still
 * holds exactly what it last wrote, so an LL2/SC re-run (or a hand edit) that legitimately changed a
 * field is respected — then re-applies the current overrides. Net effect: edit overrides.ts, re-run
 * this alone, and emptying a field brings the pipeline value back.
 *
 * update-data discards the baseline: its fresh base holds none of our values. Kept, the baseline would
 * mistake a field the pipeline has since got right by itself for our own write (it holds the same value),
 * so deleting the now-redundant override would roll the field back to the stale value we once replaced.
 *
 *   bun run enrich-manual    # apply overrides.ts as the final layer (idempotent, offline)
 *
 * Expedition corrections (`expeditionOverrides` in overrides.ts) work the same way on the station dataset:
 * their dates, name and Station, and `crew`, which sets who is in the Expedition by rewriting the Stays that
 * name it, and `remove`, which drops an LL2 record that isn't an Expedition. Their baseline entries share the
 * file, keyed `expedition:<station>/<expedition>`. Station corrections (`stationOverrides`) do the same for a
 * Station's launch and deorbit dates, keyed `station:<slug>`; Stay corrections (`stayOverrides`) for a craft's
 * docking or undocking date, on everyone's Stays with that date, keyed `stay:<station>/<date>`. Flight
 * corrections (`flightOverrides`) do the same for a Mission's landing date, keyed `flight:<mission>/<date>`; the
 * last landing and days in space they move with it are person fields, in their people's entries.
 *
 * NOTE: run AFTER the other enrichers. Re-running `update-data` resets astronauts.json — run the
 * three enrichers then this, in order.
 */
import { STATIONS } from '../src/lib/stations';
import type { Expedition, Flight, Meta, Person, StationData, Status } from '../src/lib/types';
import { DATA, STATION_DATA, writeAstronauts, writeStations } from './dataset';
import { expeditionOverrides, flightOverrides, overrides, stationOverrides, stayOverrides } from './overrides';
import { expeditionCrew, setExpeditionCrew } from './stations';

const ROOT = new URL('..', import.meta.url);
const META = new URL('src/lib/data/meta.json', ROOT);
const BASELINE = new URL('scripts/cache/manual/baseline.json', ROOT);

const normName = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

const staysOf = (p: Person) => p.flights.flatMap((f) => f.stays ?? []);

/** A field's pipeline value and the value written; a Stay correction also names whose Stays it wrote. */
type FieldSnap = { base: unknown; applied: unknown; people?: string[] };
type Baseline = Record<string, Record<string, FieldSnap>>;

const EXP = 'expedition:'; // baseline keys of Expedition corrections
const EXPEDITION_FIELDS = ['start', 'end', 'name', 'station'] as const;
const STA = 'station:'; // baseline keys of Station corrections
const STATION_FIELDS = ['launched', 'deorbited'] as const;
const STAY = 'stay:'; // baseline keys of Stay corrections
const STAY_FIELDS = ['arrive', 'depart'] as const;
const FLT = 'flight:'; // baseline keys of Flight corrections
/** `<mission>/<date>` → [mission, date]. Split at the last slash: a Mission's name can hold one (Soyuz 18a / 18-1). */
const missionKey = (key: string) => [key.slice(0, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1)];

// Derived fields recomputed from an overridden flights[] unless the override sets them explicitly.
const DERIVED = ['firstLaunch', 'lastLanding', 'totalDaysInSpace', 'status'] as const;
function recompute(field: (typeof DERIVED)[number], p: Person): unknown {
	const fs = p.flights ?? [];
	switch (field) {
		case 'firstLaunch':
			return fs.reduce((m, f) => (f.launch < m ? f.launch : m), fs[0]?.launch ?? p.firstLaunch);
		case 'status':
			return (fs.some((f) => f.ongoing) ? 'in-space' : p.dod ? 'deceased' : 'living') as Status;
		case 'lastLanding': {
			if (fs.some((f) => f.ongoing)) return null;
			const landed = fs.filter((f) => !f.ongoing && f.landing).map((f) => f.landing!);
			return landed.length ? landed.reduce((m, d) => (d > m ? d : m)) : null;
		}
		case 'totalDaysInSpace': {
			let days = 0;
			for (const f of fs) {
				const s = Date.parse(f.launch);
				const e = f.ongoing ? Date.now() : Date.parse(f.landing ?? f.launch);
				if (e > s) days += (e - s) / 86400000;
			}
			return Math.round(days);
		}
	}
}

/** Recompute counts/coverage from the overridden people so the About page stays consistent
 *  (timestamps, sources and the in-space cross-check list are left to update-data). */
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

async function main() {
	console.log('▶ Manual overrides (final layer)…');
	const people: Person[] = await Bun.file(DATA).json();
	const stationData: StationData | null = (await Bun.file(STATION_DATA).exists()) ? await Bun.file(STATION_DATA).json() : null;
	const prior: Baseline = (await Bun.file(BASELINE).exists()) ? await Bun.file(BASELINE).json() : {};

	const byId = new Map(people.map((p) => [p.id, p]));
	const bySlug = new Map(people.map((p) => [p.slug, p]));
	const byName = new Map(people.map((p) => [normName(p.name), p]));
	const resolve = (key: string) => byId.get(key) ?? bySlug.get(key) ?? byName.get(normName(key));

	// ----- 1. Revert prior manual edits to their pipeline value -----
	// Only when the field still holds exactly what we last wrote; if LL2/SC (or a hand edit) has since
	// changed it, that newer value IS the pipeline value, so leave it alone. (After update-data there is
	// no baseline at all — see the header.)
	let reverted = 0;
	for (const [id, fields] of Object.entries(prior)) {
		const p = byId.get(id);
		if (!p) continue;
		for (const [field, snap] of Object.entries(fields)) {
			if (jsonEq((p as Record<string, unknown>)[field], snap.applied)) {
				(p as Record<string, unknown>)[field] = clone(snap.base);
				reverted++;
			}
		}
	}

	// Flight corrections likewise: each Flight still holding the landing we wrote, and each one removed back in
	// launch order, unless a pipeline re-run already brought it back. (The fields they moved with them — last
	// landing, days in space, first launch — are the people's own, reverted just above.)
	for (const [key, fields] of Object.entries(prior)) {
		if (!key.startsWith(FLT)) continue;
		const [mission, date] = missionKey(key.slice(FLT.length));
		const snap = fields.landing;
		for (const id of snap?.people ?? []) {
			for (const f of byId.get(id)?.flights ?? []) {
				if (f.mission === mission && f.landing === snap!.applied) {
					f.landing = snap!.base as string;
					reverted++;
				}
			}
		}
		for (const [id, flights] of Object.entries((fields.removed?.base ?? {}) as Record<string, Flight[]>)) {
			const p = byId.get(id);
			if (!p || p.flights.some((f) => f.mission === mission && f.landing === date)) continue;
			for (const flight of flights) {
				const at = p.flights.findIndex((f) => f.launch > flight.launch);
				p.flights.splice(at < 0 ? p.flights.length : at, 0, clone(flight));
			}
			reverted++;
		}
	}

	// Stay corrections likewise: each Stay still holding the date we wrote. After the people's, since a reverted
	// `flights` brings its Stays back, and before the Expeditions', whose crews are placed by the Stays' dates.
	for (const [key, fields] of Object.entries(prior)) {
		if (!key.startsWith(STAY)) continue;
		const station = key.slice(STAY.length).split('/')[0];
		for (const field of STAY_FIELDS) {
			const snap = fields[field];
			for (const id of snap?.people ?? []) {
				const p = byId.get(id);
				for (const s of p ? staysOf(p) : []) {
					if (s.station === station && s[field] === snap!.applied) {
						s[field] = snap!.base as string;
						reverted++;
					}
				}
			}
		}
	}

	// Expedition corrections likewise — after the people's, since a reverted `flights` brings its Stays back.
	// An Expedition moved to another Station is found where it was moved to; its crew is cleared there and put
	// back where it came from. One removed comes back with its crew, unless a pipeline re-run already brought it.
	const expeditions = stationData?.expeditions ?? [];
	const findExpedition = (station: string, slug: string) => expeditions.find((x) => x.station === station && x.slug === slug);
	const crewAt = (x: Expedition, station: string) => expeditionCrew(people, { ...x, station });
	const setCrewAt = (x: Expedition, station: string, crew: string[]) => setExpeditionCrew(people, { ...x, station }, crew, expeditions);
	for (const [key, fields] of Object.entries(prior)) {
		if (!key.startsWith(EXP)) continue;
		const [station, slug] = key.slice(EXP.length).split('/');
		const removed = fields.removed?.base as { record: Expedition; crew: string[] } | undefined;
		if (removed) {
			if (!findExpedition(station, slug)) {
				expeditions.push(clone(removed.record));
				setCrewAt(removed.record, station, removed.crew);
				reverted++;
			}
			continue;
		}
		const movedTo = (fields.station?.applied as string | undefined) ?? station;
		const x = findExpedition(movedTo, slug);
		if (!x) continue;
		const rec = x as unknown as Record<string, unknown>;
		for (const field of EXPEDITION_FIELDS) {
			const snap = fields[field];
			if (snap && jsonEq(rec[field], snap.applied)) {
				rec[field] = clone(snap.base);
				reverted++;
			}
		}
		const crew = fields.crew;
		if (crew && jsonEq(crewAt(x, movedTo), crew.applied)) {
			if (movedTo !== x.station) setCrewAt(x, movedTo, []);
			setCrewAt(x, x.station, crew.base as string[]);
			reverted++;
		}
	}

	// Station corrections likewise.
	const findStation = (slug: string) => stationData?.stations.find((s) => s.slug === slug);
	for (const [key, fields] of Object.entries(prior)) {
		if (!key.startsWith(STA)) continue;
		const rec = findStation(key.slice(STA.length)) as unknown as Record<string, unknown> | undefined;
		if (!rec) continue;
		for (const field of STATION_FIELDS) {
			const snap = fields[field];
			if (snap && jsonEq(rec[field], snap.applied)) {
				rec[field] = clone(snap.base);
				reverted++;
			}
		}
	}

	// ----- 2. Apply current overrides; rebuild the baseline from the (now pipeline-valued) records ---
	const next: Baseline = {};
	const seen = new Set<string>();
	const changes: { name: string; field: string; from: unknown; to: unknown }[] = [];
	const unmatched: string[] = [];
	let dupes = 0;
	// What each person's own override sets — it has the last word over the Flight corrections below.
	const ownOverride = new Map<string, Record<string, unknown>>();
	const setsOwn = (p: Person, field: string) => !isEmpty(ownOverride.get(p.id)?.[field]);

	for (const [key, ov] of Object.entries(overrides)) {
		const p = resolve(key);
		if (!p) {
			unmatched.push(key);
			continue;
		}
		if (seen.has(p.id)) {
			console.warn(`  ⚠ duplicate override key for ${p.name} (${p.id}) — keeping the first.`);
			dupes++;
			continue;
		}
		seen.add(p.id);
		ownOverride.set(p.id, ov as Record<string, unknown>);

		const entry: Record<string, FieldSnap> = {};
		const rec = p as Record<string, unknown>;
		const set = (field: string, value: unknown) => {
			if (jsonEq(rec[field], value)) return; // already equal — nothing to override or revert
			changes.push({ name: p.name, field, from: rec[field], to: value });
			entry[field] = { base: clone(rec[field]), applied: clone(value) };
			rec[field] = clone(value);
		};

		for (const [field, value] of Object.entries(ov)) {
			if (isEmpty(value)) continue; // emptied → leave (pipeline) value untouched
			set(field, value);
		}
		// Overriding flights replaces the whole array → keep the derived fields consistent.
		if (!isEmpty((ov as Record<string, unknown>).flights)) {
			for (const d of DERIVED) if (isEmpty((ov as Record<string, unknown>)[d])) set(d, recompute(d, p));
		}
		if (Object.keys(entry).length) next[p.id] = entry;
	}

	// Flight corrections: every Flight of the Mission that landed on that date — not someone's who came home in
	// another craft — and with it each one's last landing, and their days in space by as many days as the landing
	// moves: the sources' totals carry the same error, hours and all. A removed Flight takes its days with it, and
	// may change who flew first. Someone whose own override sets their `flights` is left out, and one that sets
	// a field moved here keeps that.
	const derive = (p: Person, field: 'firstLaunch' | 'lastLanding' | 'totalDaysInSpace' | 'status', value: unknown) => {
		const rec = p as unknown as Record<string, unknown>;
		if (setsOwn(p, field) || jsonEq(rec[field], value)) return;
		const entry = (next[p.id] ??= {});
		changes.push({ name: p.name, field, from: rec[field], to: value });
		entry[field] = { base: field in entry ? entry[field].base : clone(rec[field]), applied: clone(value) };
		rec[field] = clone(value);
	};
	const daysOf = (f: Flight) => Math.max(0, Date.parse(f.landing ?? f.launch) - Date.parse(f.launch)) / 86400000;
	for (const [key, ov] of Object.entries(flightOverrides)) {
		if (isEmpty(ov.landing) && !ov.remove) continue;
		const [mission, date] = missionKey(key);
		const matches = (f: Flight) => f.mission === mission && f.landing === date;
		let who = people.filter((p) => p.flights.some(matches) && !setsOwn(p, 'flights'));
		if (ov.remove) {
			// Someone left with no flight at all isn't a Person: that takes a fix upstream, in scripts/spaceflight.ts.
			const only = who.filter((p) => p.flights.every(matches));
			if (only.length) console.warn(`  ⚠ ${key} is the only flight of ${only.map((p) => p.name).join(', ')} — not removed; list it in scripts/spaceflight.ts`);
			who = who.filter((p) => !only.includes(p));
		}
		if (!who.length) {
			unmatched.push(key);
			continue;
		}
		if (ov.remove) {
			const removed: Record<string, Flight[]> = {};
			for (const p of who) removed[p.id] = p.flights.filter(matches);
			changes.push({ name: `${mission} flights of ${who.map((p) => p.name).join(', ')}`, field: 'removed', from: Object.values(removed).flat(), to: [] });
			next[`${FLT}${key}`] = { removed: { base: clone(removed), applied: true, people: who.map((p) => p.id) } };
			for (const p of who) {
				p.flights = p.flights.filter((f) => !matches(f));
				for (const field of ['firstLaunch', 'lastLanding', 'status'] as const) derive(p, field, recompute(field, p));
				derive(p, 'totalDaysInSpace', p.totalDaysInSpace - Math.round(removed[p.id].reduce((n, f) => n + daysOf(f), 0)));
			}
			continue;
		}
		const shift = (Date.parse(ov.landing!) - Date.parse(date)) / 86400000;
		changes.push({ name: `${mission} flights: ${who.map((p) => p.name).join(', ')}`, field: 'landing', from: date, to: ov.landing });
		next[`${FLT}${key}`] = { landing: { base: date, applied: ov.landing, people: who.map((p) => p.id) } };
		for (const p of who) {
			for (const f of p.flights) if (matches(f)) f.landing = ov.landing!;
			derive(p, 'lastLanding', recompute('lastLanding', p));
			derive(p, 'totalDaysInSpace', p.totalDaysInSpace + shift);
		}
	}

	// Stay corrections: every Stay aboard the Station with that date, so a craft's whole crew moves together.
	// Before the Expeditions', whose crews are placed by these dates.
	for (const [key, ov] of Object.entries(stayOverrides)) {
		const [station, date] = key.split('/');
		const entry: Record<string, FieldSnap> = {};
		for (const field of STAY_FIELDS) {
			const value = ov[field];
			if (isEmpty(value)) continue;
			const matches = (s: { station: string; arrive: string; depart: string | null }) => s.station === station && s[field] === date;
			const who = people.filter((p) => staysOf(p).some(matches));
			if (!who.length) unmatched.push(`${key} (${field})`);
			else {
				for (const p of who) for (const s of staysOf(p)) if (matches(s)) s[field] = value!;
				changes.push({ name: `Stays aboard ${station}: ${who.map((p) => p.name).join(', ')}`, field, from: date, to: value });
				entry[field] = { base: date, applied: value, people: who.map((p) => p.id) };
			}
		}
		if (Object.keys(entry).length) next[`${STAY}${key}`] = entry;
	}

	// Expedition corrections: the record's fields, then its crew (placed by the corrected dates and Station).
	const unplaced: string[] = [];
	for (const [key, ov] of Object.entries(expeditionOverrides)) {
		const [station, slug] = key.split('/');
		const x = findExpedition(station, slug);
		if (!x) {
			unmatched.push(key);
			continue;
		}
		const entry: Record<string, FieldSnap> = {};
		const rec = x as unknown as Record<string, unknown>;
		const label = `${x.name} (${key})`;
		if (ov.remove) {
			const crew = crewAt(x, station);
			setCrewAt(x, station, []);
			expeditions.splice(expeditions.indexOf(x), 1);
			changes.push({ name: `${label} removed`, field: 'crew', from: crew, to: [] });
			next[`${EXP}${key}`] = { removed: { base: { record: clone(x), crew }, applied: true } };
			continue;
		}
		for (const field of EXPEDITION_FIELDS) {
			const value = ov[field];
			if (isEmpty(value) || jsonEq(rec[field], value)) continue;
			changes.push({ name: label, field, from: rec[field], to: value });
			entry[field] = { base: clone(rec[field]), applied: clone(value) };
			rec[field] = clone(value);
		}
		const moved = x.station !== station;
		if (moved && isEmpty(ov.crew)) console.warn(`  ⚠ ${label} moved to ${x.station} — give it a crew there too.`);
		if (!isEmpty(ov.crew) || moved) {
			const before = crewAt(x, station);
			if (moved) setCrewAt(x, station, []);
			if (!isEmpty(ov.crew)) unplaced.push(...setCrewAt(x, x.station, ov.crew!).map((m) => `${m} — ${key}`));
			const after = crewAt(x, x.station);
			if (!jsonEq(before, after) || moved) {
				changes.push({ name: label, field: 'crew', from: before, to: after });
				entry.crew = { base: before, applied: after };
			}
		}
		if (Object.keys(entry).length) next[`${EXP}${key}`] = entry;
	}

	// Station corrections: a lifetime's dates.
	for (const [slug, ov] of Object.entries(stationOverrides)) {
		const rec = findStation(slug) as unknown as Record<string, unknown> | undefined;
		if (!rec) {
			unmatched.push(slug);
			continue;
		}
		const entry: Record<string, FieldSnap> = {};
		for (const field of STATION_FIELDS) {
			const value = ov[field];
			if (isEmpty(value) || jsonEq(rec[field], value)) continue;
			changes.push({ name: `Station ${slug}`, field, from: rec[field], to: value });
			entry[field] = { base: clone(rec[field]), applied: clone(value) };
			rec[field] = clone(value);
		}
		if (Object.keys(entry).length) next[`${STA}${slug}`] = entry;
	}

	// A crew correction can rewrite the Stays inside a `flights` override: record what was finally written,
	// so that field still reverts when its override is emptied.
	for (const [id, entry] of Object.entries(next)) if (entry.flights) entry.flights.applied = clone(byId.get(id)!.flights);

	people.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));
	// Back in the pipeline's order, in case a correction moved one or a revert brought one back.
	const order = Object.keys(STATIONS);
	expeditions.sort((a, b) => order.indexOf(a.station) - order.indexOf(b.station) || a.start.localeCompare(b.start));
	if (stationData) await writeStations(stationData);
	await writeAstronauts(people);
	await Bun.write(BASELINE, JSON.stringify(next, null, 2));
	await refreshMeta(people);

	const fmt = (v: unknown, field = '') => (Array.isArray(v) ? `[${v.length} ${field === 'crew' ? 'people' : 'flights'}]` : JSON.stringify(v));
	console.log('\n──────── Manual overrides report ────────');
	console.log(
		`override entries:  ${Object.keys(overrides).length} people, ${Object.keys(flightOverrides).length} Flight landings, ${Object.keys(stationOverrides).length} Stations, ${Object.keys(stayOverrides).length} Stay dates, ${Object.keys(expeditionOverrides).length} Expeditions  (unmatched ${unmatched.length}${dupes ? `, ${dupes} dupes` : ''})`
	);
	console.log(`fields applied:    ${changes.length}`);
	console.log(`fields reverted:   ${reverted}  (emptied/removed since last run → back to pipeline value)`);
	if (changes.length) {
		console.log('changes:');
		for (const c of changes) console.log(`   ${c.name} · ${c.field}: ${fmt(c.from, c.field)} → ${fmt(c.to, c.field)}`);
	}
	if (unplaced.length) console.log(`   ⚠ crew not aboard during the Expedition: ${unplaced.join(', ')}`);
	if (unmatched.length) {
		console.log(
			'unmatched keys (no person by id / slug / name, Flight by <mission>/<landing>, Station by slug, Stay by <station>/<date>, or Expedition by <station>/<expedition>):'
		);
		for (const k of unmatched) console.log(`   ${k}`);
	}
	console.log('  (re-running `update-data` resets astronauts.json — run the 3 enrichers then this, in order.)');
	console.log('─────────────────────────────────────────\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
