# Piste 🛰️

A Gantt-style timeline of **everyone who has been to space** — from Yuri Gagarin (1961) to the
people in orbit right now. Filter by nationality, agency, gender, status and orbital/suborbital;
click anyone for their full flight history.

_Piste_ is an acronym for "People in space timeline" and also a word originating from French which means a trail or track — each bar traces a person's time in space.

- **Static site** — the whole dataset is baked in at build time, no runtime API calls.
- **Stack** — SvelteKit (Svelte 5) · Tailwind v4 · TypeScript, built and run with **Bun**.
- **Deploys to** GitHub Pages or Cloudflare Pages.

## Develop

```bash
bun install
bun --bun run dev        # http://localhost:5173
```

Other scripts:

```bash
bun --bun run build      # static output → ./build
bun --bun run preview    # preview the production build
bun --bun run check      # type-check
```

## Data

Two committed files drive the app: `src/lib/data/astronauts.json` and `meta.json`. Regenerate them
with:

```bash
bun run update-data            # 1. Wikidata + open-notify base — no rate limits, ~1 min
bun run enrich-ll2             # 2. Launch Library 2 — authoritative; rate-limited, resumable
bun run enrich-supercluster    # 3. Supercluster — gap-fills gender & tourist agencies
bun run enrich-manual          # 4. Manual overrides — hand-fix anything; empty a field to revert
```

`update-data` builds a complete, self-sufficient dataset from Wikidata. **Launch Library 2** enrichment
then runs as the **authoritative source** wherever it and Wikidata disagree — Wikidata supplies the base
(the crew list, dates, photos, gender, dob/dod) and LL2 corrects four things on top of it, then backfills
the people Wikidata never had:

- **Nationality** — LL2's flown-under nation overrides Wikidata, which often stores a *birthplace*
  (Kononenko was tagged Turkmenistan, not Russia) or a stale/secondary citizenship.
- **Agency** — LL2's affiliation fills the gaps Wikidata leaves blank (e.g. Yi So-yeon → Korean
  Astronaut Program) and sharpens the rest. Where LL2 has a person but lists *no* agency, that's
  trusted too: early space tourists (Tito, Simonyi…) are left agency-less rather than inheriting a
  nation-default like NASA.
- **Flight timelines** — each person's flights are rebuilt by zipping their LL2 launches with their
  returns, so the Gantt bars show real intervals (and seat-swap up/down craft, e.g. Kononenko's
  record MS-24→MS-25 mission).
- **Days in space** — taken from LL2's lifetime `time_in_space`, but only when those rebuilt flights
  corroborate it. Wikidata derives days from each *spacecraft's* launch/landing dates, over-counting
  every seat-swapping crew member (a visitor inherits the craft's whole 6-month span instead of their
  ~10-day stay): Kononenko →1110, Whitson →695, Avdeyev 1142→747. The dozen Apollo/Gemini/Skylab
  veterans whose LL2 `time_in_space` is itself buggy (e.g. Conrad) keep their correct Wikidata figure.

And then it **backfills people Wikidata is missing**. Wikidata has no item (or no crew-link) for most
recent suborbital tourists, so the base list stops ~700; LL2 catalogues ~800 who have flown, and anyone
it lists as flown but no Wikidata person matched is added as a new record (`id: "ll2-<id>"`). This is the
broad **US 50-mile / 80 km** definition the dataset already uses — it counts Virgin Galactic, whose
SpaceShipTwo tops out ~85 km, below the 100 km Kármán line (so the total runs a little above the
Kármán-only tally you'll see quoted elsewhere). Three things are deliberately left out: non-human test
articles LL2 lists as astronauts (Starman, the Artemis-I manikins, zero-g-indicator plushes…),
name-variant duplicates already in the set (caught by an exact-DOB guard), and "flights" that never
reached space — the Apollo 1 pad fire and the SpaceShipTwo glide/powered atmospheric tests (which also
trims real pilots' logs, e.g. Sturckow 17→12). LL2 carries no gender, so backfilled people take theirs
from bio pronouns where present, else `unknown`.

It fetches the astronaut list with `?mode=detailed` (flights & landings inlined), so a full refresh
is **~9 paginated calls**. LL2's free tier is heavily rate-limited (~15 calls/hour), so the script
paces calls, honours `Retry-After`, backs off, and caches every page — it **resumes** wherever it
left off. It also fills spacewalk counts and missing photos.

```bash
bun run enrich-ll2                     # run AFTER update-data; re-run later to resume
MAX_LL2_CALLS=100 bun run enrich-ll2   # cap network calls this run (resume later)
MAX_LL2_CALLS=0   bun run enrich-ll2   # apply cached pages only, no network
LL2_DELAY_MS=4000 bun run enrich-ll2   # gentler pacing (default 2000ms)
LL2_API_KEY=…     bun run enrich-ll2   # authenticated tier — higher throttle ceiling
```

**Supercluster** runs last as a light, gap-filling pass — it never overrides LL2's nationality or
agency wholesale. From [Supercluster's astronaut database](https://www.supercluster.com/astronauts)
(793 humans who have reached space, fetched from its public Sanity API — no key, no rate limit) it does
four things: fills **gender** for the recent suborbital tourists LL2 leaves blank (it lists nearly
everyone); sets **Space Adventures** as the agency for the orbital tourists it brokered (Tito, Simonyi,
Shuttleworth, Olsen, Ansari, R. Garriott, Laliberté) plus the dearMoon pair Maezawa & Hirano (whom
Wikidata mis-tagged as JAXA); fills a still-**Unknown** agency only when Supercluster names a
*commercial* provider (so Akiyama, the TBS journalist it files under "CCCP", stays agency-less rather
than becoming "Roscosmos"); and applies five hand-reviewed agency corrections. It also **backfills the
two SpaceShipOne pilots** (Melvill & Binnie — the first commercial astronauts, 2004) that LL2's filters
drop. Where Supercluster credits a launch *operator* but LL2 credits the flier's *nation* (e.g. a Saudi
national on an Axiom seat), the national agency is kept by design.

```bash
bun run enrich-supercluster                  # run AFTER enrich-ll2
SC_MAX_CALLS=0 bun run enrich-supercluster    # apply cached data only, no network
```

**Manual overrides** run last (`scripts/overrides.ts` → `bun run enrich-manual`). Every other layer
derives values from a source; this one is hand-authored, so it has the final say. List a person by
`id`, `slug`, or exact `name`, then set any [`Person`](src/lib/types.ts) field to correct it — the
value wins over everything the pipeline computed. **Empty a field** (`''`, `null`, `[]`, or just
delete the line) and the override drops, so the field falls back to the pipeline's value — _the last
value that was there before_. (So this layer can only set values, never blank them; emptying means
revert. To genuinely clear a field, fix it upstream.) Overriding `flights` replaces the whole array
and recomputes `firstLaunch` / `lastLanding` / `totalDaysInSpace` / `status` from it.

Reverting works without re-running the whole chain: a gitignored baseline
(`scripts/cache/manual/baseline.json`) remembers each touched field's pipeline value and the value
written, so emptying an override restores the former. It only reverts a field still holding exactly
what it wrote, so a later `update-data`/LL2/SC change is respected.

```bash
bun run enrich-manual    # apply scripts/overrides.ts as the final layer (idempotent, offline)
```

Sources: **Wikidata** (CC0, base dataset), **Open Notify** (in-space cross-check), **Launch Library 2**
(CC BY-NC 4.0 — authoritative for nationality, agency, day counts, timelines & backfilling the people
Wikidata misses) and **Supercluster** (editorial — gender, the Space Adventures tourists, and the
SpaceShipOne pilots). See the in-app About page for methodology.

## Deploy

### Cloudflare Pages (serves at root)

- Build command: `bun run build`
- Build output directory: `build`
- Framework preset: none

### GitHub Pages (project site, served under `/<repo>`)

Push to `main` — the included workflow (`.github/workflows/deploy.yml`) builds with Bun and deploys.
In the repo: **Settings → Pages → Source: GitHub Actions**. The workflow sets `BASE_PATH` to your
repo name automatically.

For a custom domain or a user/org root site, build with an empty base path:

```bash
BASE_PATH= bun --bun run build
```

> The base path is read from `process.env.BASE_PATH` in `vite.config.ts` — empty for root, or
> `/<repo>` for a GitHub project site.
