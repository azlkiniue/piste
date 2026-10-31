<script lang="ts">
	import { base } from '$app/paths';
	import StationLanes from '$lib/components/StationLanes.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import astronautsData from '$lib/data/astronauts.min.json';
	import stationData from '$lib/data/stations.min.json';
	import type { Person, StationData } from '$lib/types';
	import { COLOR_BY_OPTIONS } from '$lib/colors';
	import { colour, personColour, setColour, type ColourChoice } from '$lib/colour.svelte';
	import { crewByExpedition, staysByStation } from '$lib/station-index';

	const people = astronautsData as Person[];
	const { stations, expeditions } = stationData as StationData;
	const byStation = staysByStation(people);
	const crew = crewByExpedition(byStation);
	// Everyone in an Expedition, once — the Legend counts them.
	const crewPeople = [...new Set([...crew.values()].flat().map((r) => r.person))];
	const aboardNow = [...byStation.values()].flat().filter((r) => r.stay.ongoing).length;

	let highlight = $state<string | null>(null);
	$effect(() => {
		colour.by; // a new colour dimension has new values: drop the pick
		highlight = null;
	});
</script>

<svelte:head>
	<title>Space stations — Piste</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
	<header class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
		<div class="mr-auto">
			<h1 class="text-base font-bold leading-tight tracking-tight">
				Piste <span class="font-normal text-zinc-400">· Space stations</span>
			</h1>
			<p class="text-[11px] text-zinc-500 dark:text-zinc-400">
				{stations.length} stations · {expeditions.length} expeditions ·
				<span class="text-emerald-600 dark:text-emerald-400">{aboardNow} aboard now</span>
			</p>
		</div>

		<label class="flex items-center gap-1.5 text-xs text-zinc-500">
			Colour
			<select
				value={colour.by}
				onchange={(e) => setColour(e.currentTarget.value as ColourChoice)}
				class="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-zinc-700 focus:outline-none dark:border-zinc-700 dark:text-zinc-200"
			>
				<option value="expedition">Expedition</option>
				{#each COLOR_BY_OPTIONS as opt (opt.id)}<option value={opt.id}>{opt.label}</option>{/each}
			</select>
		</label>

		<nav class="flex items-center gap-3 text-xs text-zinc-500">
			<a href="{base}/" class="underline-offset-2 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200">People</a>
			<a href="{base}/about" class="hidden underline-offset-2 hover:text-zinc-800 hover:underline sm:inline dark:hover:text-zinc-200">About</a>
		</nav>
		<ThemeToggle />
	</header>

	<main class="flex min-h-0 flex-1 flex-col">
		<div class="min-h-0 flex-1">
			<StationLanes
				lives={stations}
				{expeditions}
				{crew}
				colourBy={colour.by}
				{highlight}
				stationHref={(slug) => `${base}/stations/${slug}`}
				expeditionHref={(x) => `${base}/stations/${x.station}?expedition=${x.slug}`}
			/>
		</div>
		{#if colour.by !== 'expedition'}
			<div class="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
				<Legend people={crewPeople} by={personColour(colour.by)} bind:highlight />
			</div>
		{/if}
	</main>
</div>
