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
 * name it. Their baseline entries share the file, keyed `expedition:<station>/<expedition>`.
 *
 * NOTE: run AFTER the other enrichers. Re-running `update-data` resets astronauts.json — run the
 * three enrichers then this, in order.
 */
import type { Expedition, Meta, Person, StationData, Status } from '../src/lib/types';
import { DATA, STATION_DATA, writeAstronauts, writeStations } from './dataset';
import { expeditionOverrides, overrides } from './overrides';
import { expeditionCrew, setExpeditionCrew } from './stations';

const ROOT = new URL('..', import.meta.url);
const META = new URL('src/lib/data/meta.json', ROOT);
const BASELINE = new URL('scripts/cache/manual/baseline.json', ROOT);

const normName = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

type FieldSnap = { base: unknown; applied: unknown };
type Baseline = Record<string, Record<string, FieldSnap>>;

const EXP = 'expedition:'; // baseline keys of Expedition corrections
const EXPEDITION_FIELDS = ['start', 'end', 'name', 'station'] as const;

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

	// Expedition corrections likewise — after the people's, since a reverted `flights` brings its Stays back.
	// An Expedition moved to another Station is found where it was moved to; its crew is cleared there and put
	// back where it came from.
	const expeditions = stationData?.expeditions ?? [];
	const findExpedition = (station: string, slug: string) => expeditions.find((x) => x.station === station && x.slug === slug);
	const crewAt = (x: Expedition, station: string) => expeditionCrew(people, { ...x, station });
	const setCrewAt = (x: Expedition, station: string, crew: string[]) => setExpeditionCrew(people, { ...x, station }, crew, expeditions);
	for (const [key, fields] of Object.entries(prior)) {
		if (!key.startsWith(EXP)) continue;
		const [station, slug] = key.slice(EXP.length).split('/');
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

	// ----- 2. Apply current overrides; rebuild the baseline from the (now pipeline-valued) records ---
	const next: Baseline = {};
	const seen = new Set<string>();
	const changes: { name: string; field: string; from: unknown; to: unknown }[] = [];
	const unmatched: string[] = [];
	let dupes = 0;

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

	people.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));
	if (stationData) await writeStations(stationData);
	await writeAstronauts(people);
	await Bun.write(BASELINE, JSON.stringify(next, null, 2));
	await refreshMeta(people);

	const fmt = (v: unknown, field = '') => (Array.isArray(v) ? `[${v.length} ${field === 'crew' ? 'people' : 'flights'}]` : JSON.stringify(v));
	console.log('\n──────── Manual overrides report ────────');
	console.log(
		`override entries:  ${Object.keys(overrides).length} people, ${Object.keys(expeditionOverrides).length} Expeditions  (unmatched ${unmatched.length}${dupes ? `, ${dupes} dupes` : ''})`
	);
	console.log(`fields applied:    ${changes.length}`);
	console.log(`fields reverted:   ${reverted}  (emptied/removed since last run → back to pipeline value)`);
	if (changes.length) {
		console.log('changes:');
		for (const c of changes) console.log(`   ${c.name} · ${c.field}: ${fmt(c.from, c.field)} → ${fmt(c.to, c.field)}`);
	}
	if (unplaced.length) console.log(`   ⚠ crew not aboard during the Expedition: ${unplaced.join(', ')}`);
	if (unmatched.length) {
		console.log('unmatched keys (no person by id / slug / name, or Expedition by <station>/<expedition>):');
		for (const k of unmatched) console.log(`   ${k}`);
	}
	console.log('  (re-running `update-data` resets astronauts.json — run the 3 enrichers then this, in order.)');
	console.log('─────────────────────────────────────────\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
