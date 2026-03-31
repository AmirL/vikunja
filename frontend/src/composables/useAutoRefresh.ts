import {ref, watch, onScopeDispose, type Ref, type WatchSource, computed} from 'vue'

const DEFAULT_INTERVAL_MS = 30_000

export interface UseAutoRefreshOptions {
	/**
	 * Polling interval in milliseconds. Defaults to 30 000 (30 s).
	 */
	intervalMs?: number

	/**
	 * Reactive flag(s) indicating that the user is mid-interaction
	 * (e.g. dragging a task, editing inline). While any of them is
	 * `true` the refresh is deferred until they all become `false`.
	 */
	isUserInteracting?: Ref<boolean> | Ref<boolean>[]

	/**
	 * Optional watch source that, when changed, should reset the
	 * polling timer (e.g. the reactive params/projectId object that
	 * already triggers a manual fetch). This avoids a redundant
	 * fetch right after the view already loaded fresh data.
	 */
	resetOn?: WatchSource
}

/**
 * Composable that calls `fetchCallback` at a fixed interval while the
 * browser tab is visible and the user is not mid-interaction.
 *
 * - Pauses when the tab is hidden (Page Visibility API).
 * - Fires immediately when the tab becomes visible again.
 * - Defers while any `isUserInteracting` ref is `true`.
 * - Silently swallows errors so stale data stays on screen.
 * - Cleans up automatically when the calling scope is disposed.
 */
export function useAutoRefresh(
	fetchCallback: () => Promise<unknown>,
	options: UseAutoRefreshOptions = {},
) {
	const {
		intervalMs = DEFAULT_INTERVAL_MS,
		isUserInteracting = [],
		resetOn,
	} = options

	const interactingRefs = Array.isArray(isUserInteracting)
		? isUserInteracting
		: [isUserInteracting]

	const isInteracting = computed(() => interactingRefs.some(r => r.value))

	let timerId: ReturnType<typeof setTimeout> | null = null
	const isPolling = ref(false)

	// Track whether a deferred refresh is pending
	let deferredRefresh = false

	async function silentFetch() {
		try {
			await fetchCallback()
		} catch {
			// Swallow errors: the view keeps showing the last successful data.
			// Polling will retry on the next interval automatically.
		}
	}

	function scheduleNext() {
		stopTimer()
		timerId = setTimeout(tick, intervalMs)
	}

	async function tick() {
		if (document.hidden) {
			// Tab is not visible; don't fetch, don't reschedule.
			// The visibility handler will resume polling.
			return
		}

		if (isInteracting.value) {
			deferredRefresh = true
			scheduleNext()
			return
		}

		await silentFetch()
		scheduleNext()
	}

	function stopTimer() {
		if (timerId !== null) {
			clearTimeout(timerId)
			timerId = null
		}
	}

	function start() {
		if (isPolling.value) return
		isPolling.value = true
		scheduleNext()
	}

	function stop() {
		isPolling.value = false
		stopTimer()
		deferredRefresh = false
	}

	// --- Page Visibility API ---
	function onVisibilityChange() {
		if (document.hidden) {
			stopTimer()
		} else if (isPolling.value) {
			// Tab just became visible: fetch immediately, then resume interval
			silentFetch()
			scheduleNext()
		}
	}

	document.addEventListener('visibilitychange', onVisibilityChange)

	// --- Deferred refresh: fire when interaction ends ---
	watch(isInteracting, (interacting) => {
		if (!interacting && deferredRefresh && isPolling.value) {
			deferredRefresh = false
			silentFetch()
			scheduleNext()
		}
	})

	// --- Reset timer when underlying data source already refreshed ---
	if (resetOn) {
		watch(resetOn, () => {
			if (isPolling.value) {
				// Data was just loaded by the view itself; restart the
				// interval so the next poll is a full interval away.
				scheduleNext()
			}
		})
	}

	// Start polling by default
	start()

	// --- Cleanup ---
	onScopeDispose(() => {
		stop()
		document.removeEventListener('visibilitychange', onVisibilityChange)
	})

	return {
		/** Whether polling is currently active */
		isPolling,
		/** Manually start polling (called automatically on creation) */
		start,
		/** Manually stop polling */
		stop,
	}
}
