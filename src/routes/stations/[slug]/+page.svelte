<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import StationTimeline from '$lib/components/StationTimeline.svelte';
	import Filters from '$lib/components/Filters.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import astronautsData from '$lib/data/astronauts.min.json';
	import stationData from '$lib/data/stations.min.json';
	import type { Person, StationData } from '$lib/types';
	import { STATIONS } from '$lib/stations';
	import { COLOR_BY_OPTIONS, type ColorBy } from '$lib/colors';
	import { colorChoice, personColor, setColorChoice } from '$lib/color-choice.svelte';
	import { Filters as FilterState, matches } from '$lib/filters.svelte';
	import { endMs, isVisitor, staysByStation, type StayRow } from '$lib/station-index';

	let { data } = $props();

	const people = astronautsData as Person[];
	const { stations, expeditions } = stationData as StationData;
	const byStation = staysByStation(people);

	const slug = $derived(data.slug);
	const station = $derived(STATIONS[slug]);
	const life = $derived(stations.find((s) => s.slug === slug)!);
	const stationExpeditions = $derived(expeditions.filter((exp) => exp.station === slug));
	const all = $derived(byStation.get(slug) ?? []);
	const occupied = $derived<[number, number]>([
		Math.min(...all.map((r) => Date.parse(r.stay.arrive))),
		Math.max(...all.map((r) => endMs(r.stay.depart)))
	]);

	// One row per person, in order of first arrival here, with all their Stays aboard.
	const rows = $derived.by(() => {
		const m = new Map<string, { person: Person; stays: StayRow[] }>();
		for (const r of all) {
			const row = m.get(r.person.slug) ?? { person: r.person, stays: [] };
			row.stays.push(r);
			m.set(r.person.slug, row);
		}
		return [...m.values()];
	});

	// Filters are this page's own, cleared when the Station changes. The Stay filter keeps a person's
	// matching Stays (Scott Kelly's STS-118 Stay, under "Visitor") and drops anyone left with none.
	const filters = new FilterState();
	$effect(() => {
		slug;
		untrack(() => filters.reset());
	});
	const keep = (r: StayRow) => filters.stayType === 'all' || (filters.stayType === 'visitor') === isVisitor(r.stay);
	const withStays = $derived(rows.map((row) => ({ person: row.person, stays: row.stays.filter(keep) })).filter((row) => row.stays.length));
	const stayPeople = $derived(withStays.map((row) => row.person));
	const visible = $derived(withStays.filter((row) => matches(row.person, filters)));
	const colorBy = $derived(personColor(colorChoice.by));
	let drawerOpen = $state(false);

	// Deep links: ?person= opens the detail panel, ?expedition= zooms to an Expedition. Read only in the browser —
	// the pages are prerendered, and a prerendered page has no query string.
	const param = (name: string) => (browser ? page.url.searchParams.get(name) : null);
	const focus = $derived(param('expedition'));
	// The panel follows the URL when it's navigated to (a Station line in the detail panel), and the URL follows
	// a click: replaceState doesn't update page.url, so the selection is kept here.
	let selected = $state<Person | null>(null);
	$effect(() => {
		const s = param('person');
		untrack(() => (selected = s ? (people.find((p) => p.slug === s) ?? null) : null));
	});
	function select(p: Person | null) {
		selected = p;
		const url = new URL(location.href);
		if (p) url.searchParams.set('person', p.slug);
		else url.searchParams.delete('person');
		replaceState(url, page.state);
	}
	const aboardNow = $derived(all.filter((r) => r.stay.ongoing).length);
	const years = $derived(`${life.launched.slice(0, 4)}–${life.deorbited ? life.deorbited.slice(0, 4) : 'now'}`);
</script>

<svelte:head>
	<title>{station.short} — Piste</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
	<header class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
		<div class="mr-auto min-w-0">
			<h1 class="text-base font-bold leading-tight tracking-tight">
				<a href="{base}/stations" class="hover:underline">Piste</a>
				<span class="font-normal text-zinc-400">· {station.name ?? station.short}</span>
			</h1>
			<p class="text-[11px] text-zinc-500 dark:text-zinc-400" title={station.note}>
				{years} · {rows.length.toLocaleString()} people · {stationExpeditions.length}
				{stationExpeditions.length === 1 ? 'Expedition' : 'Expeditions'}{#if aboardNow}{' · '}<span class="text-emerald-600 dark:text-emerald-400">{aboardNow} aboard now</span>{/if}
			</p>
		</div>

		<label class="flex items-center gap-1.5 text-xs text-zinc-500">
			Station
			<select
				value={slug}
				onchange={(e) => goto(`${base}/stations/${e.currentTarget.value}`)}
				class="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-zinc-700 focus:outline-none dark:border-zinc-700 dark:text-zinc-200"
			>
				{#each Object.entries(STATIONS) as [key, s] (key)}<option value={key}>{s.short}</option>{/each}
			</select>
		</label>

		<input
			type="search"
			placeholder="Search name…"
			bind:value={filters.search}
			class="w-36 rounded-md border border-zinc-300 bg-transparent px-2.5 py-1 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:focus:border-zinc-500"
		/>

		<label class="flex items-center gap-1.5 text-xs text-zinc-500">
			Colour
			<select
				value={colorBy}
				onchange={(e) => setColorChoice(e.currentTarget.value as ColorBy)}
				class="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-zinc-700 focus:outline-none dark:border-zinc-700 dark:text-zinc-200"
			>
				{#each COLOR_BY_OPTIONS as opt (opt.id)}<option value={opt.id}>{opt.label}</option>{/each}
			</select>
		</label>

		<nav class="flex items-center gap-3 text-xs text-zinc-500">
			<a href="{base}/stations" class="underline-offset-2 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200">All stations</a>
			<a href="{base}/" class="underline-offset-2 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200">People</a>
		</nav>
		<ThemeToggle />
		<button
			class="flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs md:hidden dark:border-zinc-700"
			onclick={() => (drawerOpen = true)}
		>
			Filters{#if filters.activeCount}<span class="rounded-full bg-zinc-900 px-1.5 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900">{filters.activeCount}</span>{/if}
		</button>
	</header>

	<div class="flex min-h-0 flex-1">
		{#if drawerOpen}
			<button class="fixed inset-0 z-30 bg-black/40 md:hidden" aria-label="Close filters" onclick={() => (drawerOpen = false)}></button>
		{/if}
		<aside
			class="fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform md:static md:z-auto md:w-64 md:translate-x-0 md:shadow-none dark:border-zinc-800 dark:bg-zinc-950 {drawerOpen
				? 'translate-x-0 shadow-2xl'
				: '-translate-x-full'}"
		>
			<div class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
				<span class="text-xs font-semibold uppercase tracking-wide text-zinc-500">
					Filters{#if filters.activeCount}<span class="ml-1 rounded-full bg-zinc-900 px-1.5 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900">{filters.activeCount}</span>{/if}
				</span>
				<div class="flex items-center gap-3">
					{#if filters.activeCount}
						<button class="text-xs text-zinc-500 underline-offset-2 hover:underline" onclick={() => filters.reset()}>Reset</button>
					{/if}
					<button class="text-zinc-400 hover:text-zinc-700 md:hidden dark:hover:text-zinc-200" aria-label="Close filters" onclick={() => (drawerOpen = false)}>
						<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
					</button>
				</div>
			</div>
			<div class="flex-1 overflow-y-auto p-3 scrollbar-thin">
				<Filters people={stayPeople} {filters} mode="stays" />
			</div>
		</aside>

		<main class="flex min-w-0 flex-1 flex-col">
			<div class="min-h-0 flex-1">
				{#key slug}
					<StationTimeline
						{life}
						expeditions={stationExpeditions}
						rows={visible}
						{occupied}
						{colorBy}
						{focus}
						selectedSlug={selected?.slug ?? null}
						onselect={select}
					/>
				{/key}
			</div>
			<div class="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
				<Legend people={visible.map((row) => row.person)} by={colorBy} {filters} />
			</div>
		</main>
	</div>

	{#if selected}
		<DetailPanel person={selected} onclose={() => select(null)} />
	{/if}
</div>
