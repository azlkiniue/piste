<script lang="ts">
	import type { Person } from '$lib/types';
	import type { Filters } from '$lib/filters.svelte';
	import { colorFor, fullLabelFor, labelFor, valueOf, type ColorBy } from '$lib/colors';

	interface Props {
		people: Person[];
		by: ColorBy;
		/** Clicking an entry filters by it; without filters it fades every other colour instead (`highlight`). */
		filters?: Filters;
		highlight?: string | null;
	}
	let { people, by, filters, highlight = $bindable(null) }: Props = $props();

	// Distinct values of the colour dimension among the given people, by frequency.
	const entries = $derived.by(() => {
		const m = new Map<string, number>();
		for (const p of people) {
			const v = valueOf(p, by);
			m.set(v, (m.get(v) ?? 0) + 1);
		}
		return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
	});

	const isOn = (value: string) => (filters ? filters.setOf(by).has(value) : highlight === value);
	const anyOn = $derived(filters ? filters.setOf(by).size > 0 : highlight !== null);
	function pick(value: string) {
		if (filters) filters.toggle(by, value);
		else highlight = highlight === value ? null : value;
	}
</script>

<div class="flex flex-wrap gap-x-3 gap-y-1.5">
	{#each entries as [value, count] (value)}
		<button
			class="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-100 {isOn(value) || !anyOn ? 'opacity-100' : 'opacity-40'}"
			onclick={() => pick(value)}
			aria-pressed={isOn(value)}
			title="{filters ? 'Filter by' : 'Pick out'} {fullLabelFor(by, value) ?? labelFor(by, value)}"
		>
			<span class="h-2.5 w-2.5 rounded-sm" style="background:{colorFor(by, value)}"></span>
			<span class="text-zinc-600 dark:text-zinc-300">{labelFor(by, value)}</span>
			<span class="tabular-nums text-zinc-400">{count}</span>
		</button>
	{/each}
</div>
