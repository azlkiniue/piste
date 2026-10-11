/**
 * Crewed launches that never reached space. The dataset counts from the US 50-mile / 80 km astronaut
 * boundary, but Wikidata and LL2 both log these as flights — so build-data and enrich-ll2 drop them from
 * every log, and someone they leave with no flight at all isn't in the dataset (Chaffee on Apollo 1;
 * McAuliffe, Jarvis and Smith on Challenger). Matched by name — a Wikidata label, or an LL2 launch's
 * spacecraft or mission name. (SpaceShipTwo's glide and powered test runs are dropped by their test codes
 * in scripts/enrich-ll2.ts.)
 */
const NEVER_REACHED_SPACE = [
	/^Apollo 1\b/, // 27 Jan 1967 — the cabin fire, in a launch rehearsal on the pad
	/^Soyuz (7K-ST No\. ?16L|T-10-1\b|T-10a\b)/, // 26 Sep 1983 — Soyuz T-10-1's pad abort: the escape tower pulled the capsule off the burning rocket
	/^STS-51-L$/, // 28 Jan 1986 — Challenger broke apart 73 s after liftoff, ~15 km up
	/^VSS Unity VF-02$/ // 12 Dec 2020 — the rocket motor never lit after release, so Unity glided home
];

export const neverReachedSpace = (name?: string | null) => !!name && NEVER_REACHED_SPACE.some((re) => re.test(name));

/**
 * Crewed launches that aborted on the way to orbit yet still crossed the 80 km line on a ballistic arc:
 * real spaceflights, so they stay, but suborbital ones. Neither source says so — LL2 gives the orbit they
 * were bound for — so build-data and enrich-ll2 mark them by name, matched as above.
 */
const SUBORBITAL_ABORTS = [
	/^Soyuz (7K-T No\. ?39\b|18a\b|18-1\b)/, // 5 Apr 1975 — Soyuz 18a: the second stage didn't separate cleanly; the capsule arced to ~190 km
	/^Soyuz MS-10$/ // 11 Oct 2018 — a strap-on booster struck the core stage as it separated; the capsule arced to ~93 km
];

export const suborbitalAbort = (name?: string | null) => !!name && SUBORBITAL_ABORTS.some((re) => re.test(name));
