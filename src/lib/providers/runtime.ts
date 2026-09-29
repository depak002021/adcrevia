import { OpenAITextProvider } from "@/lib/ai/openai-text-provider"
import { FluxImageProvider } from "@/lib/providers/images/flux"
import { GoogleImageProvider } from "@/lib/providers/images/google"
import { OpenAIImageProvider } from "@/lib/providers/images/openai"
import type { ImageProvider } from "@/lib/providers/images/types"
import { FluxVideoProvider } from "@/lib/providers/videos/flux"
import { RunwayVideoProvider } from "@/lib/providers/videos/runway"
import { KlingVideoProvider } from "@/lib/providers/videos/kling"
import { SeedanceVideoProvider } from "@/lib/providers/videos/seedance"
import { VeoVideoProvider } from "@/lib/providers/videos/veo"
import type { VideoProvider } from "@/lib/providers/videos/types"
import { resolveActiveProvider, resolveImageProviderByName, resolveOpenAITextSettings, resolveVideoProviderByName, resolveProviderSettings, type ImageProviderChoice, type VideoProviderChoice } from "./configuration"

/**
 * Text features (creative directions, image evaluation) need an OpenAI key, not an
 * ACTIVE OpenAI image provider. They used to require the latter, so an operator who
 * made FLUX the image provider — OpenAI key still saved — had every text feature
 * refuse with "connect OpenAI". Any saved OpenAI key now serves text, as it already
 * did for the brief assistant and the decision layer.
 */
export async function createOpenAITextProvider() {
  const settings = await resolveOpenAITextSettings()
  return new OpenAITextProvider(settings.apiKey, settings.model)
}

export async function createOpenAIImageProvider() {
  const settings = await resolveImageProviderByName("openai")
  return new OpenAIImageProvider(settings.apiKey, settings.model)
}

export async function createActiveImageProvider(): Promise<ImageProvider> {
  const settings = await resolveActiveProvider("IMAGE")
  if (settings.provider === "BFL") {
    return new FluxImageProvider({ apiKey: settings.apiKey, model: settings.model })
  }
  // Google was missing here while being present in createImageProviderByName,
  // so an administrator who enabled Google as the ACTIVE provider silently got
  // OpenAI renders billed against the OpenAI key. Every branch of the resolved
  // provider union is now handled explicitly.
  if (settings.provider === "GOOGLE") {
    return new GoogleImageProvider({ apiKey: settings.apiKey, model: settings.model })
  }
  return new OpenAIImageProvider(settings.apiKey, settings.model)
}

/** Build the image provider + model explicitly chosen by the user. */
export async function createImageProviderByName(choice: ImageProviderChoice, model?: string): Promise<ImageProvider> {
  const settings = await resolveImageProviderByName(choice, model)
  if (settings.provider === "BFL") return new FluxImageProvider({ apiKey: settings.apiKey, model: settings.model })
  if (settings.provider === "GOOGLE") return new GoogleImageProvider({ apiKey: settings.apiKey, model: settings.model })
  return new OpenAIImageProvider(settings.apiKey, settings.model)
}

/**
 * Build the video provider selected by the active provider configuration
 * (Task 4 resolution). BFL resolves to the FLUX 3 multi-keyframe provider;
 * everything else resolves to Runway.
 */
export async function createActiveVideoProvider(): Promise<VideoProvider> {
  const settings = await resolveActiveProvider("VIDEO")
  if (settings.provider === "BFL") {
    return new FluxVideoProvider({ apiKey: settings.apiKey, model: settings.model })
  }
  return videoProviderFrom(settings)
}

/** Every video provider from resolved settings; one place, so no path forgets one. */
function videoProviderFrom(settings: { provider: string; apiKey: string; model: string }): VideoProvider {
  if (settings.provider === "BFL") return new FluxVideoProvider({ apiKey: settings.apiKey, model: settings.model })
  if (settings.provider === "SEEDANCE") return new SeedanceVideoProvider({ apiKey: settings.apiKey, model: settings.model })
  if (settings.provider === "GOOGLE") return new VeoVideoProvider({ apiKey: settings.apiKey, model: settings.model })
  if (settings.provider === "KLING") return new KlingVideoProvider({ apiKey: settings.apiKey, model: settings.model })
  return new RunwayVideoProvider(undefined, settings.model, settings.apiKey)
}

/** Build the video provider + model explicitly chosen by the user. */
export async function createVideoProviderByName(choice: VideoProviderChoice, model?: string): Promise<VideoProvider> {
  return videoProviderFrom(await resolveVideoProviderByName(choice, model))
}

/** Seedance specifically, for draft → final renders that must use the draft's model. */
export async function createSeedanceProvider(model: string): Promise<SeedanceVideoProvider> {
  const settings = await resolveVideoProviderByName("seedance", model)
  return new SeedanceVideoProvider({ apiKey: settings.apiKey, model: settings.model })
}

/**
 * Reconstruct the provider RECORDED on a video record, regardless of whichever
 * provider is currently active. Status refreshes must always talk to the
 * provider that originally accepted the task.
 */
export async function createVideoProviderForRecord(provider: string, model: string): Promise<VideoProvider> {
  if (provider === "seedance") return createSeedanceProvider(model)
  if (provider === "google" || provider === "kling") return videoProviderFrom(await resolveVideoProviderByName(provider, model))
  if (provider === "bfl") {
    const bfl = await resolveBflVideoSettings()
    return new FluxVideoProvider({ apiKey: bfl.apiKey, model: model || bfl.model })
  }
  const settings = await resolveProviderSettings("VIDEO", "RUNWAY")
  return new RunwayVideoProvider(undefined, model || settings.model, settings.apiKey)
}

async function resolveBflVideoSettings(): Promise<{ apiKey: string; model: string }> {
  const settings = await resolveActiveProvider("VIDEO")
  if (settings.provider === "BFL") return { apiKey: settings.apiKey, model: settings.model }
  const apiKey = process.env.BFL_API_KEY
  if (!apiKey) throw new Error("BFL_API_KEY is required")
  return { apiKey, model: process.env.BFL_VIDEO_MODEL ?? "flux-3-video" }
}

export async function createRunwayVideoProvider() {
  const settings = await resolveProviderSettings("VIDEO", "RUNWAY")
  return new RunwayVideoProvider(undefined, settings.model, settings.apiKey)
}
