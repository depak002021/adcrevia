import type { NextConfig } from "next"
import { securityHeaders } from "./src/lib/security/headers"

/**
 * Generated media is served from the storage provider's public base URL, which
 * differs per environment (an R2 custom domain in production, the app's own
 * origin when falling back to local disk in development). Deriving the pattern
 * from the same variable the storage layer uses keeps next/image working
 * without hardcoding a bucket host here.
 */
function mediaRemotePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  // Storage is usually configured in Admin → Storage, i.e. at runtime, after this
  // build-time list is fixed. So the hosts a bucket is actually served from are
  // always allowed: Cloudflare's public r2.dev URLs and a media subdomain of ours.
  const always = [
    { protocol: "https" as const, hostname: "*.r2.dev", pathname: "/**" },
    { protocol: "https" as const, hostname: "**.adcrevia.com", pathname: "/**" },
  ]
  return [...always, ...fromEnvironment()]
}

function fromEnvironment(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const base = process.env.R2_PUBLIC_BASE_URL
  if (!base) return []
  try {
    const url = new URL(base)
    return [
      {
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        pathname: "/**",
      },
    ]
  } catch {
    // A malformed value must not break the build; next/image simply will not
    // accept remote media until it is corrected.
    return []
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Required for the Docker image: emits a self-contained server bundle in
   * .next/standalone so the runtime stage does not need node_modules or the
   * package manager. See Dockerfile.
   */
  output: "standalone",

  images: {
    remotePatterns: mediaRemotePatterns(),
    // Generated campaign stills are wide; these are the widths the studio grid
    // and the preview dialog actually request.
    deviceSizes: [420, 640, 828, 1080, 1280, 1600, 1920],
  },

  experimental: {
    // Phosphor ships a barrel of several thousand icons. Without this, a single
    // icon import pulls the whole module graph into the dev compile.
    optimizePackageImports: ["@phosphor-icons/react"],
  },

  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }]
  },
}

export default nextConfig
