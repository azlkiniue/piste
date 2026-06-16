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
 * holds exactly what it last wrote, so a fresh update-data/LL2/SC run (or a hand edit) that
 * legitimately changed a field is respected — then re-applies the current overrides. Net effect:
 * edit overrides.ts, re-run this alone, and emptying a field brings the pipeline value back.
 *
 *   bun run enrich-manual    # apply overrides.ts as the final layer (idempotent, offline)
 *
 * NOTE: run AFTER the other enrichers. Re-running `update-data` resets astronauts.json — run the
 * three enrichers then this, in order.
 */
import type { Meta, Person, Status } from '../src/lib/types';
import { overrides } from './overrides';

const ROOT = new URL('..', import.meta.url);
const DATA = new URL('src/lib/data/astronauts.json', ROOT);
const META = new URL('src/lib/data/meta.json', ROOT);
const BASELINE = new URL('scripts/cache/manual/baseline.json', ROOT);

const normName = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
const jsonEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

type FieldSnap = { base: unknown; applied: unknown };
type Baseline = Record<string, Record<string, FieldSnap>>;

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

async function main() {
	console.log('▶ Manual overrides (final layer)…');
	const people: Person[] = await Bun.file(DATA).json();
	const prior: Baseline = (await Bun.file(BASELINE).exists()) ? await Bun.file(BASELINE).json() : {};

	const byId = new Map(people.map((p) => [p.id, p]));
	const bySlug = new Map(people.map((p) => [p.slug, p]));
	const byName = new Map(people.map((p) => [normName(p.name), p]));
	const resolve = (key: string) => byId.get(key) ?? bySlug.get(key) ?? byName.get(normName(key));

	// ----- 1. Revert prior manual edits to their pipeline value -----
	// Only when the field still holds exactly what we last wrote; if update-data/LL2/SC (or a hand
	// edit) has since changed it, that newer value IS the pipeline value, so leave it alone.
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

	people.sort((a, b) => a.firstLaunch.localeCompare(b.firstLaunch) || a.name.localeCompare(b.name));
	await Bun.write(DATA, JSON.stringify(people));
	await Bun.write(BASELINE, JSON.stringify(next, null, 2));
	await refreshMeta(people);

	const fmt = (v: unknown) => (Array.isArray(v) ? `[${v.length} flights]` : JSON.stringify(v));
	console.log('\n──────── Manual overrides report ────────');
	console.log(
		`override entries:  ${Object.keys(overrides).length}  (matched ${seen.size}, unmatched ${unmatched.length}${dupes ? `, ${dupes} dupes` : ''})`
	);
	console.log(`fields applied:    ${changes.length}`);
	console.log(`fields reverted:   ${reverted}  (emptied/removed since last run → back to pipeline value)`);
	if (changes.length) {
		console.log('changes:');
		for (const c of changes) console.log(`   ${c.name} · ${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`);
	}
	if (unmatched.length) {
		console.log('unmatched keys (no person by id / slug / name):');
		for (const k of unmatched) console.log(`   ${k}`);
	}
	console.log('  (re-running `update-data` resets astronauts.json — run the 3 enrichers then this, in order.)');
	console.log('─────────────────────────────────────────\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
