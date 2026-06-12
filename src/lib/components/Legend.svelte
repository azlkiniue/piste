<script lang="ts">
	import type { Person } from '$lib/types';
	import type { Filters } from '$lib/filters.svelte';
	import { colorFor, labelFor, valueOf } from '$lib/colors';

	let { people, filters }: { people: Person[]; filters: Filters } = $props();

	// Distinct values of the active colour dimension among the visible people, by frequency.
	const entries = $derived.by(() => {
		const m = new Map<string, number>();
		for (const p of people) {
			const v = valueOf(p, filters.colorBy);
			m.set(v, (m.get(v) ?? 0) + 1);
		}
		return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
	});
</script>

<div class="flex flex-wrap gap-x-3 gap-y-1.5">
	{#each entries as [value, count] (value)}
		{@const on = filters.setOf(filters.colorBy).has(value)}
		<button
			class="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-100 {on || filters.setOf(filters.colorBy).size === 0
				? 'opacity-100'
				: 'opacity-40'}"
			onclick={() => filters.toggle(filters.colorBy, value)}
			title="Filter by {labelFor(filters.colorBy, value)}"
		>
			<span class="h-2.5 w-2.5 rounded-sm" style="background:{colorFor(filters.colorBy, value)}"></span>
			<span class="text-zinc-600 dark:text-zinc-300">{labelFor(filters.colorBy, value)}</span>
			<span class="tabular-nums text-zinc-400">{count}</span>
		</button>
	{/each}
</div>
