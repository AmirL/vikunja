import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {ref, effectScope} from 'vue'
import {useAutoRefresh} from './useAutoRefresh'

describe('useAutoRefresh', () => {
	let scope: ReturnType<typeof effectScope>

	beforeEach(() => {
		vi.useFakeTimers()
		scope = effectScope()
	})

	afterEach(() => {
		scope.stop()
		vi.useRealTimers()
		vi.restoreAllMocks()
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

	it('pauses polling when the tab is hidden and resumes on visibility', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		// Simulate tab hidden
		Object.defineProperty(document, 'hidden', {value: true, writable: true, configurable: true})
		document.dispatchEvent(new Event('visibilitychange'))

		// Advance past multiple intervals: should not fire
		await vi.advanceTimersByTimeAsync(15_000)
		expect(fetchFn).not.toHaveBeenCalled()

		// Simulate tab visible: should fire immediately
		Object.defineProperty(document, 'hidden', {value: false, writable: true, configurable: true})
		document.dispatchEvent(new Event('visibilitychange'))

		// The immediate fetch is async, flush it
		await vi.advanceTimersByTimeAsync(0)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('defers fetch when user is interacting, then fires when interaction ends', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		const interacting = ref(true)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000, interactionRefs: [interacting]})
		})

		// Timer fires but interaction blocks it
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).not.toHaveBeenCalled()

		// End interaction: deferred refresh fires
		interacting.value = false
		await vi.advanceTimersByTimeAsync(0)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('cleans up timers and listeners on scope dispose', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		const removeListenerSpy = vi.spyOn(document, 'removeEventListener')

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		scope.stop()

		await vi.advanceTimersByTimeAsync(10_000)
		expect(fetchFn).not.toHaveBeenCalled()
		expect(removeListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
	})

	it('silently swallows fetch errors and continues polling', async () => {
		const fetchFn = vi.fn()
			.mockRejectedValueOnce(new Error('network error'))
			.mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		// First interval: error is swallowed
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(1)

		// Second interval: polling continues
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(2)
	})

	it('resets the timer when start is called after stop', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		let controls: ReturnType<typeof useAutoRefresh>

		scope.run(() => {
			controls = useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		controls!.stop()
		await vi.advanceTimersByTimeAsync(10_000)
		expect(fetchFn).not.toHaveBeenCalled()

		controls!.start()
		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('handles multiple interaction refs (any true defers)', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		const dragging = ref(false)
		const editing = ref(true)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000, interactionRefs: [dragging, editing]})
		})

		await vi.advanceTimersByTimeAsync(5000)
		expect(fetchFn).not.toHaveBeenCalled()

		editing.value = false
		await vi.advanceTimersByTimeAsync(0)
		expect(fetchFn).toHaveBeenCalledTimes(1)
	})

	it('does not start polling when enabled is false', async () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)

		scope.run(() => {
			useAutoRefresh(fetchFn, {intervalMs: 5000, enabled: false})
		})

		await vi.advanceTimersByTimeAsync(15_000)
		expect(fetchFn).not.toHaveBeenCalled()
	})

	it('exposes isActive reflecting current polling state', () => {
		const fetchFn = vi.fn().mockResolvedValue(undefined)
		let controls: ReturnType<typeof useAutoRefresh>

		scope.run(() => {
			controls = useAutoRefresh(fetchFn, {intervalMs: 5000})
		})

		expect(controls!.isActive.value).toBe(true)
		controls!.stop()
		expect(controls!.isActive.value).toBe(false)
		controls!.start()
		expect(controls!.isActive.value).toBe(true)
	})
})
