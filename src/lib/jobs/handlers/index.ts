/**
 * Handler registration.
 *
 * Importing this module is what populates the registry, so the worker imports it
 * exactly once at startup. Side-effecting imports are usually worth avoiding,
 * but the alternative — a central array every handler file has to be added to —
 * is the thing that actually gets forgotten.
 *
 * VIDEO_SUBMIT is intentionally absent rather than stubbed: submission still happens
 * in the request that asks for it, nothing enqueues the kind, and `runJob` fails
 * loudly with HANDLER_NOT_REGISTERED if anything ever does — far better than a stub
 * that silently succeeds.
 */

import "./agent"
import "./compositions"
import "./images"
import "./videos"
import "./website"
