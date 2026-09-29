import type { MetadataRoute } from "next"

import { site } from "@/features/marketing/content"

/**
 * Only the landing page is meant for search engines. The studio, the admin console and
 * the API are behind sign-in anyway; listing them here keeps crawlers from spending
 * their budget on redirects to the login page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/admin"] }],
    sitemap: `${site.url}/sitemap.xml`,
  }
}
