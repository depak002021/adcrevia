/** "Holi T-shirt UGC ad" + 15 + "9:16" → "holi-t-shirt-ugc-ad-15s-9x16.mp4" */
export function videoFileName(project: string, seconds: number, aspect: string) {
  const base =
    project.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").slice(0, 48).replace(/^-+|-+$/g, "") || "adcrevia-video"
  return `${base}-${seconds}s-${aspect.replace(":", "x")}.mp4`
}
