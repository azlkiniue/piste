<script lang="ts">
	import { theme, cycleTheme } from '$lib/theme.svelte';

	const labels = { system: 'System', light: 'Light', dark: 'Dark' };
</script>

<button
	onclick={cycleTheme}
	class="grid h-8 w-8 place-items-center rounded-md border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
	title="Theme: {labels[theme.value]} (click to change)"
	aria-label="Theme: {labels[theme.value]}"
>
	{#if theme.value === 'light'}
		<!-- sun -->
		<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
		</svg>
	{:else if theme.value === 'dark'}
		<!-- moon -->
		<svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor">
			<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
		</svg>
	{:else}
		<!-- monitor (system) -->
		<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<rect x="2" y="4" width="20" height="13" rx="2" />
			<path d="M8 21h8M12 17v4" />
		</svg>
	{/if}
</button>
