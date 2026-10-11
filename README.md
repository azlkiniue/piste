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

The app reads two committed files in `src/lib/data/`: `astronauts.min.json` (everyone and their
flights) and `meta.json` (build date, counts and sources). Four Bun scripts rebuild them, each layering
a source onto the last:

```bash
bun run update-data            # 1. Wikidata + ISS APIs base — no rate limits, ~1 min
bun run enrich-ll2             # 2. Launch Library 2 — authoritative; rate-limited, resumable
bun run enrich-supercluster    # 3. Supercluster — nationalities; gap-fills gender & tourist agencies; cross-checks agencies
bun run enrich-manual          # 4. Manual overrides — hand-fix anything; empty a field to revert
```

- **Wikidata** (CC0) is the base: the crew list, flight dates, photos, gender, and birth and death dates.
- The **[International Space Station APIs](https://github.com/corquaid/international-space-station-APIs)**
  (MIT) cross-check who's in space right now.
- **Launch Library 2** (CC BY-NC 4.0) is authoritative where the two disagree — agencies, flight
  timelines and days in space — and adds the recent fliers Wikidata is missing.
- **Supercluster** (editorial) supplies nationalities and fills gaps, such as gender for recent
  suborbital tourists; it also cross-checks agencies.
- **Manual overrides** in `scripts/overrides.ts` have the final say.

"In space" means past the US 50-mile / 80 km line, so Virgin Galactic counts, while launches that never
got there (Apollo 1, Challenger, …) don't. Every script also writes `astronauts.json`, a pretty-printed
copy, so each refresh reads as a per-field diff.

See [DATA.md](DATA.md) for the details: how the sources are merged, the nationality and agency rules, LL2
caching and offline replays, and how manual overrides revert.

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
