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
			<a class="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100" href="https://github.com/corquaid/international-space-station-APIs" target="_blank" rel="noopener">International Space Station APIs</a>
			<span class="text-zinc-400">· MIT</span> — cross-check for who is in space now.
		</li>
		<li>
			<a class="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100" href="https://thespacedevs.com/llapi" target="_blank" rel="noopener">Launch Library 2</a>
			<span class="text-zinc-400">· CC BY-NC 4.0</span> — the authoritative source for agency, flight
			timelines, day counts, spacewalks and photos, and the backfill for recent fliers Wikidata is missing.
		</li>
		<li>
			<a class="font-medium text-zinc-800 underline-offset-2 hover:underline dark:text-zinc-100" href="https://www.supercluster.com/astronauts" target="_blank" rel="noopener">Supercluster</a>
			<span class="text-zinc-400">· editorial</span> — nationalities, including defunct states and second
			citizenships, plus gaps the others leave: gender for recent suborbital fliers, the space-tourism
			brokers (Space Adventures), and the two SpaceShipOne pilots. It also cross-checks agencies.
		</li>
	</ul>

	<h2 class="mt-8 text-lg font-semibold">Caveats</h2>
	<ul class="mt-2 list-disc space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-300">
		<li><strong>Nationality</strong> is every state a person flew for — including ones that no longer exist — plus any other citizenship they held at the time, so some people have two. Gagarin flew for the Soviet Union; Krikalev, in orbit as it dissolved and flying again in 1994, for the Soviet Union and Russia; Ulf Merbold for West Germany and then reunified Germany; Michael Foale is American and British. It comes from Supercluster, with flight dates deciding Soviet versus Russian and a hand-checked list of corrections; heritage alone doesn't count, and territories count as their country (Puerto Rico → United States).</li>
		<li><strong>Agency</strong> is every agency a person flew for, as it was at the time, so some people have two or three. Koichi Wakata flew for NASDA, then for JAXA, which it merged into; Sergei Krikalev for the Soviet space programme (CCCP), then Roscosmos; Joe Engle flew the X-15 for the US Air Force, then the Shuttle for NASA; Peggy Whitson flew for NASA, then Axiom Space. A guest on another country's spacecraft counts for their own agency, a paying customer for the company that flew them (Space Adventures, Axiom Space…), and a seat a government bought on a commercial flight for both. It starts from Launch Library 2, with flight dates deciding the era and a hand-checked list of corrections; Supercluster is a cross-check. Agencies show by their short name — open a person, or switch the filter to <em>Full names</em>, for the full one.</li>
		<li><strong>Status</strong> is <em>In space / Living / Deceased</em>; "in space now" is a snapshot taken when the data was built.</li>
		<li><strong>"In space"</strong> here means past the US 50-mile / 80 km astronaut boundary, so Virgin Galactic counts even though SpaceShipTwo falls below the 100 km Kármán line — the total therefore sits a little above Kármán-only tallies quoted elsewhere.</li>
		<li>Recent suborbital tourists are filled in from Launch Library 2, which carries no gender; Supercluster supplies most of the rest, so only a couple still read <em>Unknown</em>. A few obscure early flights may still be missing.</li>
	</ul>

	<div class="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800">
		{meta.counts.people.toLocaleString()} people · {meta.counts.flights.toLocaleString()} flights ·
		{meta.counts.countries} countries · data built {generated}.
		Built with SvelteKit, Tailwind and Bun; flags from
		<a class="underline-offset-2 hover:underline" href="https://github.com/HatScripts/circle-flags" target="_blank" rel="noopener">circle-flags</a> (MIT).
	</div>
</div>
