import type { MetadataRoute } from "next"

import { site } from "@/features/marketing/content"

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: site.url, lastModified: new Date(), changeFrequency: "weekly", priority: 1 }]
}
