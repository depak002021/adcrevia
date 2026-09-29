/**
 * Did the site show us a bot wall instead of the page?
 *
 * Amazon answers server requests with a "Continue shopping" interstitial that points
 * to its APIs; Cloudflare, PerimeterX and DataDome show challenge pages. Those
 * pages parse fine and would otherwise be "analysed" into an empty brief. Detected
 * only when the page ALSO yielded no product and very little text, so a real shop
 * page that happens to mention "captcha" is never misread as blocked.
 */

const SIGNALS = [
  /api-services-support@amazon/i,
  /robot check/i,
  /captcha/i,
  /are you a (human|robot)/i,
  /verify (that )?you are (a )?human/i,
  /automated access/i,
  /access denied/i,
  /just a moment\.\.\./i,
  /attention required!? \| cloudflare/i,
  /cf-browser-verification|cf-challenge|challenge-platform/i,
  /px-captcha|perimeterx/i,
  /datadome/i,
]

/** Below this much readable text, a page with no product is not a real product page. */
const THIN_TEXT = 1500

export function looksLikeBotWall(input: { html: string; text: string; productCount: number }): boolean {
  if (input.productCount > 0 || input.text.length >= THIN_TEXT) return false
  return SIGNALS.some((signal) => signal.test(input.html))
}
