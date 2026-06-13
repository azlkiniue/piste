# Piste 🛰️

A Gantt-style timeline of **everyone who has been to space** — from Yuri Gagarin (1961) to the
people in orbit right now. Filter by nationality, agency, gender, status and orbital/suborbital;
click anyone for their full flight history.

_Piste_ is an acronym and also means a trail or track — each bar traces a person's time in space.

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
bun run update-data      # Wikidata + open-notify — no rate limits, ~1 min
```

`update-data` is the primary, self-sufficient pipeline. **Launch Library 2** enrichment is optional
but recommended — it is the authoritative source for two things Wikidata gets wrong:

- **Flight timelines** — each person's flights are rebuilt by zipping their LL2 launches with their
  returns, so the Gantt bars show real intervals (and seat-swap up/down craft, e.g. Kononenko's
  record MS-24→MS-25 mission).
- **Days in space** — taken from LL2's lifetime `time_in_space`, but only when those rebuilt flights
  corroborate it. Wikidata derives days from each *spacecraft's* launch/landing dates, over-counting
  every seat-swapping crew member (a visitor inherits the craft's whole 6-month span instead of their
  ~10-day stay): Kononenko →1110, Whitson →695, Avdeyev 1142→747. The dozen Apollo/Gemini/Skylab
  veterans whose LL2 `time_in_space` is itself buggy (e.g. Conrad) keep their correct Wikidata figure.

It fetches the astronaut list with `?mode=detailed` (flights & landings inlined), so a full refresh
is **~9 paginated calls**. LL2's free tier is heavily rate-limited (~15 calls/hour), so the script
paces calls, honours `Retry-After`, backs off, and caches every page — it **resumes** wherever it
left off. It also fills cleaner agency, spacewalk counts and missing photos.

```bash
bun run enrich-ll2                     # run AFTER update-data; re-run later to resume
MAX_LL2_CALLS=100 bun run enrich-ll2   # cap network calls this run (resume later)
MAX_LL2_CALLS=0   bun run enrich-ll2   # apply cached pages only, no network
LL2_DELAY_MS=4000 bun run enrich-ll2   # gentler pacing (default 2000ms)
LL2_API_KEY=…     bun run enrich-ll2   # authenticated tier — higher throttle ceiling
```

Sources: **Wikidata** (CC0, primary), **Open Notify** (in-space cross-check), **Launch Library 2**
(CC BY-NC 4.0 — authoritative day counts & timelines). See the in-app About page for methodology.

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
