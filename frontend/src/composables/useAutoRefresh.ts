import {ref, watch, onScopeDispose, type Ref, computed} from 'vue'

export interface UseAutoRefreshOptions {
	/** Polling interval in milliseconds. Default: 30000 (30 seconds). */
	intervalMs?: number
	/** Refs that signal the user is interacting (e.g. dragging, editing). When any is true, refresh defers. */
	interactionRefs?: Ref<boolean>[]
	/** Whether to start polling immediately. Default: true. */
	enabled?: boolean
}

export interface UseAutoRefreshReturn {
	/** Manually start polling. */
	start: () => void
	/** Manually stop polling. */
	stop: () => void
	/** Whether polling is currently active. */
	isActive: Ref<boolean>
}

/**
 * Composable that periodically calls a fetch callback.
 *
 * - Pauses when the browser tab is hidden (Page Visibility API)
 * - Resumes immediately when the tab becomes visible again
 * - Defers the fetch when the user is mid-interaction
 * - Silently ignores fetch errors (the view keeps stale data)
 * - Cleans up timers when the scope is disposed
 */
export function useAutoRefresh(
	fetchCallback: () => Promise<unknown>,
	options: UseAutoRefreshOptions = {},
): UseAutoRefreshReturn {
	const {
		intervalMs = 30_000,
		interactionRefs = [],
		enabled = true,
	} = options

	const isActive = ref(false)
	let timerId: ReturnType<typeof setTimeout> | null = null
	let deferredRefresh = false

	const isInteracting = computed(() => interactionRefs.some(r => r.value))

	async function doRefresh() {
		if (isInteracting.value) {
			deferredRefresh = true
			return
		}
		try {
			await fetchCallback()
		} catch {
			// Silently swallow errors; polling retries on next interval
		}
	}

	function scheduleNext() {
		clearTimer()
		if (!isActive.value) return
		timerId = setTimeout(async () => {
			await doRefresh()
			scheduleNext()
		}, intervalMs)
	}

	function clearTimer() {
		if (timerId !== null) {
			clearTimeout(timerId)
			timerId = null
		}
	}

	function start() {
		if (isActive.value) return
		isActive.value = true
		scheduleNext()
	}

	function stop() {
		isActive.value = false
		clearTimer()
		deferredRefresh = false
	}

	// Page Visibility API: pause when hidden, resume + immediate fetch when visible
	function handleVisibilityChange() {
		if (document.hidden) {
			clearTimer()
		} else if (isActive.value) {
			// Tab just became visible: fetch immediately then resume interval
			doRefresh().then(() => scheduleNext())
		}
	}

	document.addEventListener('visibilitychange', handleVisibilityChange)

	// When interaction ends, fire deferred refresh
	watch(isInteracting, (interacting) => {
		if (!interacting && deferredRefresh && isActive.value) {
			deferredRefresh = false
			doRefresh().then(() => scheduleNext())
		}
	})

	// Auto-start if enabled
	if (enabled) {
		start()
	}

	// Cleanup on scope dispose
	onScopeDispose(() => {
		stop()
		document.removeEventListener('visibilitychange', handleVisibilityChange)
	})

	return {
		start,
		stop,
		isActive,
	}
}
