/**
 * Queue tuning values shared by schedulers and handlers.
 *
 * This module imports nothing, deliberately. The scheduler needs a handler's
 * attempt budget and the handler needs its own polling interval, so putting these
 * beside either one creates a cycle: `videos/service` imports the scheduler, the
 * scheduler imports the video handler, and the video handler imports
 * `videos/service` again.
 *
 * That cycle is not a theoretical concern — it broke two component tests, and it
 * meant merely scheduling a job pulled handler *registration* into the web
 * process, where a second registration would have thrown at startup.
 */

/**
 * Polling budget for a provider render, not an error budget.
 *
 * The video handler polls once per execution and asks the queue to retry, so
 * attempts are the number of polls. At roughly six to ten seconds apart this
 * outlasts the 30-minute render deadline (videos/service.ts), so that deadline,
 * not this budget, decides when a render has taken too long. At 120 a slow Kling
 * clip (7.5 min on average, more at 15 s) came close to the old ~20-minute edge.
 */
export const VIDEO_POLL_MAX_ATTEMPTS = 360

/** Gap between provider status checks. Faster than this is pure waste. */
export const VIDEO_POLL_INTERVAL_MS = 6_000

/**
 * Delay before the first poll. No provider returns a finished render within a
 * few seconds, so an immediate first attempt is a guaranteed wasted round trip.
 */
export const VIDEO_POLL_INITIAL_DELAY_MS = 5_000
