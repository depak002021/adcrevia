import "@testing-library/jest-dom/vitest"

/**
 * jsdom does not implement `matchMedia`, and calling it throws rather than
 * returning a default. Anything that respects `prefers-reduced-motion` — which
 * is most of the motion layer — would fail in tests without this.
 *
 * Reports no preference, so components take their normal animated path and the
 * tests exercise the same branch a real browser does.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      // Deprecated but still called by some libraries.
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
