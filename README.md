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

`update-data` is the primary, self-sufficient pipeline. **Launch Library 2** enrichment (cleaner
agency, spacewalk counts, extra photos) is optional and rate-limited (~15 calls/hour on the free
tier), so it runs separately and caches its pages:

```bash
bun run enrich-ll2       # run AFTER update-data; re-run later to resume
```

Sources: **Wikidata** (CC0, primary), **Open Notify** (in-space cross-check), **Launch Library 2**
(CC BY-NC 4.0, optional). See the in-app About page for methodology and caveats.

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
