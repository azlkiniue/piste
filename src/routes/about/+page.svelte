<script lang="ts">
	import { base } from '$app/paths';
	import metaData from '$lib/data/meta.json';
	import type { Meta } from '$lib/types';

	const meta = metaData as Meta;
	const generated = new Date(meta.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
</script>

<svelte:head>
	<title>About — Piste</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-5 py-10 leading-relaxed">
	<a href="{base}/" class="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200">← Back to the timeline</a>

	<h1 class="mt-6 text-3xl font-bold tracking-tight">People in space timeline (Piste)</h1>
	<p class="mt-2 text-zinc-600 dark:text-zinc-300">
		A Gantt-style timeline of everyone who has been to space, from Yuri Gagarin in 1961 to the people in orbit
		right now. <em>Piste</em> — originating from French — means a trail or track: each bar traces a person's time off the planet.
	</p>

	<h2 class="mt-8 text-lg font-semibold">How it works</h2>
	<p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
		Every spaceflight is a separate bar on a person's row (launch → landing). Station stays that span several
		ferries — a Soyuz up, a different Soyuz down, with expeditions in between — are merged into one continuous
		trip, so the bar reflects real time in space rather than double-counting overlapping records. Suborbital
		hops (Blue Origin, Virgin Galactic, X-15) are included and can be filtered out.
	</p>
	<p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
		The whole dataset is baked into the page at build time — there are no live API calls, so the site is fast,
		works offline, and hosts anywhere static.
	</p>

	<h2 class="mt-8 text-lg font-semibold">Data sources</h2>
	<ul class="mt-2 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
		<li>
			<a class="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100" href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a>
			<span class="text-zinc-400">· CC0</span> — the base dataset: people, gender, photos, and
			per-mission launch/landing dates via crew links.
		</li>
		<li>
			<a class="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100" href="http://open-notify.org" target="_blank" rel="noopener">Open Notify</a>
			<span class="text-zinc-400">· public</span> — cross-check for who is in space now.
		</li>
		<li>
			<a class="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100" href="https://thespacedevs.com/llapi" target="_blank" rel="noopener">Launch Library 2</a>
			<span class="text-zinc-400">· CC BY-NC 4.0</span> — the authoritative source for nationality, agency,
			flight timelines, day counts, spacewalks and photos, and the backfill for recent fliers Wikidata is missing.
		</li>
		<li>
			<a class="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100" href="https://www.supercluster.com/astronauts" target="_blank" rel="noopener">Supercluster</a>
			<span class="text-zinc-400">· editorial</span> — a gap-filling pass: gender for recent suborbital
			fliers, the space-tourism brokers (Space Adventures), and the two SpaceShipOne pilots.
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-semibold">Caveats</h2>
	<ul class="mt-2 list-disc space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
		<li><strong>Nationality</strong> and <strong>agency</strong> come from Launch Library 2 where it has a record, falling back to Wikidata. Nationality is the nation a person flew under (so Soviet-era cosmonauts show their present-day country, e.g. Gagarin → Russia), Europeans are grouped under ESA, and the space tourists show the company that flew them (e.g. Space Adventures) — with only a couple of early self-funded fliers left agency-less.</li>
		<li><strong>Status</strong> is <em>In space / Living / Deceased</em>; "in space now" is a snapshot taken when the data was built.</li>
		<li><strong>"In space"</strong> here means past the US 50-mile / 80 km astronaut boundary, so Virgin Galactic counts even though SpaceShipTwo falls below the 100 km Kármán line — the total therefore sits a little above Kármán-only tallies quoted elsewhere.</li>
		<li>Recent suborbital tourists are filled in from Launch Library 2, which carries no gender; Supercluster supplies most of the rest, so only a couple still read <em>Unknown</em>. A few obscure early flights may still be missing.</li>
	</ul>

	<div class="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800">
		{meta.counts.people.toLocaleString()} people · {meta.counts.flights.toLocaleString()} flights ·
		{meta.counts.countries} countries · data built {generated}.
		Built with SvelteKit, Tailwind and Bun.
	</div>
</div>
