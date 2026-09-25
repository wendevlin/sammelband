<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { mode, setMode } from 'mode-watcher';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import SunMoon from '@lucide/svelte/icons/sun-moon';
	import UserIcon from '@lucide/svelte/icons/user';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { auth } from '$lib/stores/auth.svelte';
	import { cn } from '$lib/utils';

	const links = $derived([
		{ href: '/', label: 'Library', active: !page.url.pathname.startsWith('/admin') },
		...(auth.isAdmin
			? [
					{ href: '/admin/users', label: 'Users', active: page.url.pathname === '/admin/users' },
					{
						href: '/admin/storage',
						label: 'Storage',
						active: page.url.pathname === '/admin/storage'
					}
				]
			: [])
	]);

	async function signOut() {
		await auth.signOut();
		await goto('/login', { invalidateAll: true });
	}
</script>

<header class="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
	<div class="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
		<a href="/" class="font-heading text-xl tracking-tight">Sammelband</a>
		<nav class="flex items-center gap-1">
			{#each links as link (link.href)}
				<a
					href={link.href}
					class={cn(
						'px-3 py-2 text-xs font-semibold tracking-widest uppercase transition-colors',
						link.active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
					)}
				>
					{link.label}
				</a>
			{/each}
		</nav>
		<div class="ml-auto flex items-center gap-1">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-sm" aria-label="Theme">
							{#if mode.current === 'dark'}<Moon />{:else}<Sun />{/if}
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Item onclick={() => setMode('light')}><Sun /> Light</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => setMode('dark')}><Moon /> Dark</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => setMode('system')}>
						<SunMoon /> System
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button {...props} variant="ghost" size="icon-sm" aria-label="Account">
							<UserIcon />
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-56">
					<DropdownMenu.Label>
						<div class="text-sm">{auth.user?.name}</div>
						<div class="text-xs font-normal text-muted-foreground">{auth.user?.email}</div>
					</DropdownMenu.Label>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={signOut}><LogOut /> Sign out</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>
</header>
