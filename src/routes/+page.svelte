<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import Timeline from '$lib/components/Timeline.svelte';
	import Filters from '$lib/components/Filters.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import DetailPanel from '$lib/components/DetailPanel.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import astronautsData from '$lib/data/astronauts.json';
	import metaData from '$lib/data/meta.json';
	import type { Person, Meta } from '$lib/types';
	import { COLOR_BY_OPTIONS } from '$lib/colors';
	import { Filters as FilterState, applyFilters, SORT_OPTIONS } from '$lib/filters.svelte';

	const people = astronautsData as Person[];
	const meta = metaData as Meta;

	const filters = new FilterState();
	let selected = $state<Person | null>(null);
	let drawerOpen = $state(false);

	const visible = $derived(applyFilters(people, filters));
	const visibleFlights = $derived(visible.reduce((n, p) => n + p.flights.length, 0));
	const visibleInSpace = $derived(visible.filter((p) => p.status === 'in-space').length);

	// Deep link: ?person=slug
	onMount(() => {
		const slug = new URLSearchParams(location.search).get('person');
		if (slug) selected = people.find((p) => p.slug === slug) ?? null;
	});
	$effect(() => {
		if (!browser) return;
		const url = new URL(location.href);
		if (selected) url.searchParams.set('person', selected.slug);
		else url.searchParams.delete('person');
		history.replaceState(history.state, '', url);
	});
</script>

<svelte:head>
	<title>Piste — everyone who has been to space</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
	<header class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
		<div class="mr-auto">
			<h1 class="text-base font-bold leading-tight tracking-tight">
				Piste <span class="font-normal text-zinc-400">· people in space</span>
			</h1>
			<p class="text-[11px] text-zinc-500 dark:text-zinc-400">
				{#if filters.activeCount}
					<span class="font-medium text-zinc-700 dark:text-zinc-200">{visible.length.toLocaleString()}</span> of
				{/if}
				{people.length.toLocaleString()} people · {visibleFlights.toLocaleString()} flights ·
				<span class="text-emerald-600 dark:text-emerald-400">{visibleInSpace} in space now</span>
			</p>
		</div>

		<input
			type="search"
			placeholder="Search name…"
			bind:value={filters.search}
			class="w-40 rounded-md border border-zinc-300 bg-transparent px-2.5 py-1 text-sm placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:focus:border-zinc-500"
		/>

		<label class="flex items-center gap-1.5 text-xs text-zinc-500">
			Sort
			<select
				bind:value={filters.sort}
				class="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-zinc-700 focus:outline-none dark:border-zinc-700 dark:text-zinc-200"
			>
				{#each SORT_OPTIONS as opt (opt.id)}<option value={opt.id}>{opt.label}</option>{/each}
			</select>
		</label>

		<label class="flex items-center gap-1.5 text-xs text-zinc-500">
			Colour
			<select
				bind:value={filters.colorBy}
				class="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-zinc-700 focus:outline-none dark:border-zinc-700 dark:text-zinc-200"
			>
				{#each COLOR_BY_OPTIONS as opt (opt.id)}<option value={opt.id}>{opt.label}</option>{/each}
			</select>
		</label>

		<a
			href="{base}/about"
			class="hidden text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline sm:inline dark:hover:text-zinc-200"
			>About</a
		>
		<ThemeToggle />
		<button
			class="flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs md:hidden dark:border-zinc-700"
			onclick={() => (drawerOpen = true)}
		>
			Filters{#if filters.activeCount}<span class="rounded-full bg-zinc-900 px-1.5 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900">{filters.activeCount}</span>{/if}
		</button>
	</header>

	<div class="flex min-h-0 flex-1">
		<!-- mobile drawer backdrop -->
		{#if drawerOpen}
			<button class="fixed inset-0 z-30 bg-black/40 md:hidden" aria-label="Close filters" onclick={() => (drawerOpen = false)}></button>
		{/if}
		<!-- filters sidebar (static on desktop, slide-in drawer on mobile) -->
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
				<Filters {people} {filters} />
			</div>
		</aside>

		<!-- timeline + legend -->
		<main class="flex min-w-0 flex-1 flex-col">
			<div class="min-h-0 flex-1">
				<Timeline people={visible} colorBy={filters.colorBy} selectedSlug={selected?.slug ?? null} onselect={(p) => (selected = p)} />
			</div>
			<div class="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
				<Legend people={visible} {filters} />
			</div>
		</main>
	</div>

	{#if selected}
		<DetailPanel person={selected} onclose={() => (selected = null)} />
	{/if}
</div>
