// Complete implementation of condition-based waiting utilities
// From: Lace test infrastructure improvements (2025-10-03)
// Context: Fixed 15 flaky tests by replacing arbitrary timeouts

/**
 * Wait for a specific event type to appear in thread
 *
 * @param getEvents - Function returning current events list
 * @param eventType - Type of event to wait for
 * @param timeoutMs - Maximum time to wait (default 5000ms)
 * @returns Promise resolving to the first matching event
 */
export function waitForEvent<T>(
  getEvents: () => T[],
  matchFn: (event: T) => boolean,
  description: string,
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      const events = getEvents();
      const event = events.find(matchFn);

      if (event) {
        resolve(event);
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`));
      } else {
        setTimeout(check, 10); // Poll every 10ms for efficiency
      }
    };

    check();
  });
}

/**
 * Generic polling function for any condition
 *
 * @param condition - Function that returns truthy value when condition met
 * @param description - Human-readable description for error messages
 * @param timeoutMs - Maximum time to wait (default 5000ms)
 * @returns Promise resolving to the truthy return value
 */
export async function waitFor<T>(
  condition: () => T | undefined | null | false,
  description: string,
  timeoutMs = 5000
): Promise<T> {
  const startTime = Date.now();

  while (true) {
    const result = condition();
    if (result) return result;

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }

    await new Promise(r => setTimeout(r, 10));
  }
}

// Usage example:
//
// BEFORE (flaky):
// ---------------
// await new Promise(r => setTimeout(r, 300)); // Hope tools start in 300ms
// agent.abort();
// await new Promise(r => setTimeout(r, 50));  // Hope results arrive in 50ms
// expect(toolResults.length).toBe(2);         // Fails randomly
//
// AFTER (reliable):
// ----------------
// await waitForEvent(
//   () => threadManager.getEvents(threadId),
//   (e) => e.type === 'TOOL_CALL',
//   'TOOL_CALL event'
// );
// agent.abort();
// await waitForEvent(
//   () => threadManager.getEvents(threadId),
//   (e) => e.type === 'TOOL_RESULT',
//   'TOOL_RESULT event'
// );
// expect(toolResults.length).toBe(2); // Always succeeds
