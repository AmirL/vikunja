import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {ref, effectScope} from 'vue'
import {useAutoRefresh} from './useAutoRefresh'

describe('useAutoRefresh', () => {
	let scope: ReturnType<typeof effectScope>

	beforeEach(() => {
		vi.useFakeTimers()
		scope = effectScope()
		// Ensure tab is "visible" by default
		Object.defineProperty(document, 'hidden', {value: false, writable: true, configurable: true})
	})

	afterEach(() => {
		scope.stop()
		vi.useRealTimers()
	})

	it('calls the fetch callback at the configured interval', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		expect(fetchFn).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(2)

		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(3)
	})

	it('uses 30 seconds as the default interval', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn)
		})

		await vi.advanceTimersByTimeAsync(29_999)
		expect(fetchFn).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(1)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('pauses when the tab is hidden and resumes when visible', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		// Simulate tab becoming hidden
		Object.defineProperty(document, 'hidden', {value: true, configurable: true})
		document.dispatchEvent(new Event('visibilitychange'))

		// Advance past several intervals: no calls expected
		await vi.advanceTimersByTimeAsync(20_000)
		expect(fetchFn).not.toHaveBeenCalled()

		// Tab becomes visible again: should fire immediately
		Object.defineProperty(document, 'hidden', {value: false, configurable: true})
		document.dispatchEvent(new Event('visibilitychange'))

		// The visibility handler calls silentFetch synchronously
		expect(fetchFn).toHaveBeenCalledTimes(1)

		// And resumes normal interval
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(2)
	})

	it('defers fetch when user is interacting, then fires when interaction ends', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		const interacting = ref(false)

		scope.run(() => {
			useAutoRefresh(fetchFn, {
				intervalMs: 5000,
				isUserInteracting: interacting,
			})
		})

		// Start interacting before tick fires
		interacting.value = true

		await vi.advanceTimersByTimeAsync(5000)
		// Fetch was deferred because user is interacting
		expect(fetchFn).not.toHaveBeenCalled()

		// End interaction: deferred fetch should fire
		interacting.value = false
		await vi.advanceTimersByTimeAsync(0) // flush microtasks
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('clears timers when scope is disposed', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		scope.stop()

		await vi.advanceTimersByTimeAsync(15_000)
		expect(fetchFn).not.toHaveBeenCalled()
	})

	it('removes the visibilitychange listener on dispose', () => {
		const removeSpy = vi.spyOn(document, 'removeEventListener')
		const fetchFn = vi.fn().mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn)
		})

		scope.stop()

		expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
		removeSpy.mockRestore()
	})

	it('silently swallows fetch errors and continues polling', async () => {
		const fetchFn = vi.fn()
			.mockRejectedValueOnce(new Error('network error'))
			.mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		// First tick: error is swallowed
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(1)

		// Second tick: succeeds normally
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(2)
	})

	it('resets the timer when resetOn source changes', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		const trigger = ref(0)

		scope.run(() => {
			useAutoRefresh(fetchFn, {
				intervalMs: 5000,
				resetOn: trigger,
			})
		})

		// Advance 3 seconds, then trigger reset
		await vi.advanceTimersByTimeAsync(3000)
		trigger.value++
		await vi.advanceTimersByTimeAsync(0) // flush

		// The timer was reset, so another 3 seconds shouldn't fire
		await vi.advanceTimersByTimeAsync(3000)
		expect(fetchFn).not.toHaveBeenCalled()

		// But 5 seconds from the reset point should
		await vi.advanceTimersByTimeAsync(2000)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('supports multiple isUserInteracting refs', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		const dragging = ref(false)
		const editing = ref(false)

		scope.run(() => {
			useAutoRefresh(fetchFn, {
				intervalMs: 5000,
				isUserInteracting: [dragging, editing],
			})
		})

		// One interaction active: should defer
		dragging.value = true
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).not.toHaveBeenCalled()

		// Stop dragging but still editing: still deferred
		dragging.value = false
		editing.value = true
		await vi.advanceTimersByTimeAsync(0)
		// The deferred refresh should NOT fire because editing is still true
		// Actually it will try because dragging went false, but isInteracting is still true
		// Let me check the logic... the watch fires when isInteracting changes value.
		// dragging=false,editing=true -> isInteracting still true -> no fire
		expect(fetchFn).not.toHaveBeenCalled()

		// Stop all interactions
		editing.value = false
		await vi.advanceTimersByTimeAsync(0)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('exposes start/stop controls', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		let controls!: ReturnType<typeof useAutoRefresh>

		scope.run(() => {
			controls = useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		expect(controls.isPolling.value).toBe(true)

		controls.stop()
		expect(controls.isPolling.value).toBe(false)

		await vi.advanceTimersByTimeAsync(10_000)
		expect(fetchFn).not.toHaveBeenCalled()

		controls.start()
		expect(controls.isPolling.value).toBe(true)

		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})
})
