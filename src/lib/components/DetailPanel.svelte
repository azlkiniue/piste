<script lang="ts">
	import type { Person } from '$lib/types';
	import { formatDate, formatDuration } from '$lib/time-scale';
	import { colorFor, flagEmoji, STATUS_LABEL, GENDER_LABEL } from '$lib/colors';

	let { person, onclose }: { person: Person; onclose: () => void } = $props();

	let imgError = $state(false);
	$effect(() => {
		person.slug;
		imgError = false;
	});

	const initials = $derived(
		person.name
			.split(/\s+/)
			.map((s) => s[0])
			.filter(Boolean)
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);

	function age(dob: string | null, dod: string | null): number | null {
		if (!dob) return null;
		const end = dod ? new Date(dod) : new Date();
		return end.getUTCFullYear() - new Date(dob).getUTCFullYear();
	}

	const statusClass: Record<string, string> = {
		'in-space': 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
		living: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
		deceased: 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400'
	};
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<button class="fixed inset-0 z-40 cursor-default bg-black/40 md:bg-black/10" aria-label="Close details" onclick={onclose}></button>

<aside
	class="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
>
	<!-- header -->
	<div class="flex items-start gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
		{#if person.image && !imgError}
			<img
				src={person.image}
				alt={person.name}
				loading="lazy"
				onerror={() => (imgError = true)}
				class="h-16 w-16 shrink-0 rounded-lg object-cover"
			/>
		{:else}
			<div
				class="grid h-16 w-16 shrink-0 place-items-center rounded-lg text-lg font-semibold text-white"
				style="background:{colorFor('nationality', person.nationality)}"
			>
				{initials}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<h2 class="text-lg font-bold leading-tight">{person.name}</h2>
			<p class="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
				{flagEmoji(person.countryCode)}
				{person.nationality} · {person.agency}
			</p>
			<span class="mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium {statusClass[person.status]}">
				{STATUS_LABEL[person.status]}
			</span>
		</div>
		<button
			onclick={onclose}
			class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
			aria-label="Close"
		>
			<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
		</button>
	</div>

	<!-- stats -->
	<dl class="grid grid-cols-3 gap-px border-b border-zinc-200 bg-zinc-200 text-center dark:border-zinc-800 dark:bg-zinc-800">
		<div class="bg-white py-2.5 dark:bg-zinc-950">
			<dt class="text-[10px] uppercase tracking-wide text-zinc-400">Days in space</dt>
			<dd class="text-lg font-semibold tabular-nums">{person.totalDaysInSpace.toLocaleString()}</dd>
		</div>
		<div class="bg-white py-2.5 dark:bg-zinc-950">
			<dt class="text-[10px] uppercase tracking-wide text-zinc-400">Flights</dt>
			<dd class="text-lg font-semibold tabular-nums">{person.flights.length}</dd>
		</div>
		<div class="bg-white py-2.5 dark:bg-zinc-950">
			<dt class="text-[10px] uppercase tracking-wide text-zinc-400">{person.spacewalks != null ? 'Spacewalks' : 'Gender'}</dt>
			<dd class="text-lg font-semibold tabular-nums">{person.spacewalks != null ? person.spacewalks : GENDER_LABEL[person.gender]}</dd>
		</div>
	</dl>

	<div class="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
		{#if person.dob}Born {formatDate(person.dob)}{#if person.dod} · Died {formatDate(person.dod)} (aged {age(person.dob, person.dod)}){:else} · {age(person.dob, null)} years old{/if}{/if}
	</div>

	<!-- flights -->
	<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin">
		<h3 class="sticky top-0 bg-white py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-950">
			{person.flights.length} {person.flights.length === 1 ? 'flight' : 'flights'}
		</h3>
		<ol class="space-y-2.5">
			{#each person.flights as f, i (i)}
				<li class="rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
					<div class="flex items-baseline justify-between gap-2">
						<span class="font-medium text-zinc-800 dark:text-zinc-100">{f.mission}</span>
						<span class="shrink-0 text-xs text-zinc-500">{formatDuration(f.launch, f.ongoing ? null : f.landing)}</span>
					</div>
					<div class="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
						<span>{formatDate(f.launch)}</span>
						<span>→</span>
						{#if f.ongoing}
							<span class="font-medium text-emerald-600 dark:text-emerald-400">in space now</span>
						{:else}
							<span>{formatDate(f.landing)}</span>
						{/if}
						<span class="ml-auto rounded px-1.5 py-px text-[10px] {f.orbital ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}">
							{f.orbital ? 'orbital' : 'suborbital'}
						</span>
					</div>
					{#if f.segments}
						<div class="mt-1 text-[11px] text-zinc-400">via {f.segments.join(' · ')}</div>
					{/if}
				</li>
			{/each}
		</ol>

		{#if person.wiki}
			<a
				href={person.wiki}
				target="_blank"
				rel="noopener noreferrer"
				class="mt-3 flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
			>
				Wikipedia
				<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8" /></svg>
			</a>
		{/if}
	</div>
</aside>
