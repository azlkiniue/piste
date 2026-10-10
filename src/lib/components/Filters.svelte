<script lang="ts">
	import type { Person } from '$lib/types';
	import { facetCounts, type Filters, type Dim, type FlightType } from '$lib/filters.svelte';
	import { colorFor, fullLabelFor, labelFor } from '$lib/colors';
	import Flags from './Flags.svelte';

	let { people, filters }: { people: Person[]; filters: Filters } = $props();

	const counts = $derived({
		nationality: facetCounts(people, filters, 'nationality'),
		agency: facetCounts(people, filters, 'agency'),
		gender: facetCounts(people, filters, 'gender'),
		status: facetCounts(people, filters, 'status')
	});

	function entries(m: Map<string, number>) {
		return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	}

	// Agencies are listed by short name; this shows each one's full name beneath it.
	let fullNames = $state(false);

	const FLIGHT_TYPES: { id: FlightType; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'orbital', label: 'Orbital' },
		{ id: 'suborbital', label: 'Suborbital' }
	];
</script>

{#snippet facet(dim: Dim, scroll = false)}
	<ul class="space-y-0.5 {scroll ? `${dim === 'agency' && fullNames ? 'max-h-80' : 'max-h-52'} overflow-y-auto pr-1 scrollbar-thin` : ''}">
		{#each entries(counts[dim]) as [value, count] (value)}
			{@const on = filters.setOf(dim).has(value)}
			{@const full = fullLabelFor(dim, value)}
			{@const twoLine = fullNames && !!full}
			<li>
				<button
					class="flex w-full gap-2 rounded px-1.5 py-1 text-left text-[13px] transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 {twoLine
						? 'items-start'
						: 'items-center'} {on ? 'font-medium text-zinc-900 dark:text-zinc-50' : 'text-zinc-600 dark:text-zinc-300'}"
					onclick={() => filters.toggle(dim, value)}
					aria-pressed={on}
					title={full}
				>
					<span
						class="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border {twoLine ? 'mt-0.5' : ''} {on
							? 'border-transparent'
							: 'border-zinc-300 dark:border-zinc-600'}"
						style={on ? `background:${colorFor(dim, value)}` : ''}
					>
						{#if on}<svg viewBox="0 0 10 10" class="h-2.5 w-2.5 text-white"><path d="M1 5l2.5 2.5L9 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>{/if}
					</span>
					{#if dim === 'nationality'}<Flags countries={[value]} />{/if}
					{#if twoLine}
						<span class="min-w-0">
							<span class="block truncate">{labelFor(dim, value)}</span>
							<span class="block text-[11px] font-normal leading-snug text-zinc-400 dark:text-zinc-500">{full}</span>
						</span>
					{:else}
						<span class="truncate">{labelFor(dim, value)}</span>
					{/if}
					<span class="ml-auto shrink-0 tabular-nums text-xs text-zinc-400 {twoLine ? 'mt-px' : ''}">{count}</span>
				</button>
			</li>
		{/each}
	</ul>
{/snippet}

<div class="space-y-4 text-sm">
	<section>
		<h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Flight type</h3>
		<div class="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
			{#each FLIGHT_TYPES as ft (ft.id)}
				<button
					class="flex-1 rounded px-2 py-1 text-xs transition-colors {filters.flightType === ft.id
						? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
						: 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}"
					onclick={() => (filters.flightType = ft.id)}>{ft.label}</button
				>
			{/each}
		</div>
	</section>

	<section>
		<h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</h3>
		{@render facet('status')}
	</section>

	<section>
		<h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Gender</h3>
		{@render facet('gender')}
	</section>

	<section>
		<div class="mb-1.5 flex items-baseline justify-between">
			<h3 class="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Agency</h3>
			<button
				class="text-[11px] text-zinc-400 underline-offset-2 hover:text-zinc-700 hover:underline dark:hover:text-zinc-200"
				onclick={() => (fullNames = !fullNames)}
				aria-pressed={fullNames}>{fullNames ? 'Short names' : 'Full names'}</button
			>
		</div>
		{@render facet('agency', true)}
	</section>

	<section>
		<h3 class="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Nationality</h3>
		{@render facet('nationality', true)}
	</section>
</div>
