import { GenerationPolicyForm } from "@/components/admin/generation-policy-form"
import { RegistrationForm } from "@/components/admin/registration-form"
import { SettingSwitch } from "@/components/admin/setting-switch"
import { isSeedanceAvailable } from "@/lib/providers/configuration"
import { isRegistrationOpen } from "@/features/auth/registration"
import { getGenerationPolicy } from "@/features/admin/settings/service"
import { describeDecisionBackend } from "@/lib/decisions/runtime"
import { briefThresholds } from "@/features/brief/classify"
import { ffmpegAvailable } from "@/lib/video/ffmpeg"
import { describeStorage } from "@/lib/storage/configuration"

/**
 * Operational readiness.
 *
 * Each row here answers a question that is otherwise unanswerable from outside the
 * container: which classifier is deciding whether a brief is ready, whether the encoder
 * is actually installed, and where media is being written. None of them expose a
 * credential — `describeDecisionBackend` and `describeStorage` exist precisely so this
 * page can report status without decrypting anything.
 */
export default async function AdminSettingsPage() {
  const [{ defaultImageCount }, decisions, storage, encoder, registrationOpen, seedanceAvailable] = await Promise.all([
    getGenerationPolicy(),
    describeDecisionBackend(),
    describeStorage(),
    ffmpegAvailable().catch(() => ({ ok: false, version: null })),
    isRegistrationOpen(),
    isSeedanceAvailable(),
  ])

  return (
    <main className="studio-page narrow-page">
      <header className="studio-header">
        <div>
          <p className="eyebrow">System policy</p>
          <h1>Settings</h1>
          <p>Production controls that are safe to expose in the operations console.</p>
        </div>
      </header>

      <section className="settings-card">
        <div>
          <h2>Public sign-up</h2>
          <p>Closed for the POC: create accounts in Admin → Users. Open it when the product launches.</p>
        </div>
        <RegistrationForm initialOpen={registrationOpen} />
      </section>

      <section className="settings-card">
        <div>
          <h2>Seedance video</h2>
          <p>Shown as &ldquo;Coming soon&rdquo; until BytePlus enables the account; every render is refused before then. Turn it on once the account is enabled.</p>
        </div>
        <SettingSwitch
          endpoint="/api/admin/settings/seedance"
          initialOn={seedanceAvailable}
          onText="Seedance is available in the video picker."
          offText="Seedance shows as Coming soon and cannot be chosen."
          turnOn="Make Seedance available"
          turnOff="Hide Seedance again"
        />
      </section>

      <section className="settings-card">
        <div>
          <h2>Generation policy</h2>
          <p>Adcrevia&rsquo;s high-value workflow invariants.</p>
        </div>
        <GenerationPolicyForm initialCount={defaultImageCount} />
        <div className="provider-readiness">
          <span>
            Image output <b>{defaultImageCount} images per project</b>
          </span>
          <span>
            Image concurrency <b>One per project</b>
          </span>
          <span>
            Provider progress <b>Truthful only</b>
          </span>
        </div>
      </section>

      <section className="settings-card">
        <div>
          <h2>Decision backend</h2>
          <p>
            The classifier behind the brief&rsquo;s readiness gate, the product-match question and
            the directions check. Answers are recorded per decision, so a change of backend is
            visible in the history rather than silently altering behaviour.
          </p>
        </div>
        <div className="provider-readiness">
          <span>
            Answering{" "}
            <b data-ok={decisions.configured ? "" : undefined}>
              {decisions.provider === "typesafe" ? "TypeSafe Jev" : "OpenAI"}
              {decisions.source === "none" ? " · not configured" : ` · ${decisions.source}`}
            </b>
          </span>
          <span>
            Ready threshold{" "}
            <b>
              {briefThresholds.ready.threshold} at {briefThresholds.ready.minConfidence} confidence
            </b>
          </span>
          <span>
            Product match{" "}
            <b>
              {briefThresholds.productMatch.threshold} at {briefThresholds.productMatch.minConfidence}{" "}
              confidence
            </b>
          </span>
        </div>
      </section>

      <section className="settings-card">
        <div>
          <h2>Media and encoding</h2>
          <p>
            Where generated assets are written, and whether the encoder that cuts compositions is
            present in this image.
          </p>
        </div>
        <div className="provider-readiness">
          <span>
            Storage{" "}
            <b data-ok={storage.configured ? "" : undefined}>
              {storage.configured ? `${storage.settings?.bucket} · ${storage.source}` : "Local disk"}
            </b>
          </span>
          <span>
            ffmpeg <b data-ok={encoder.ok ? "" : undefined}>{encoder.ok ? "Installed" : "Missing"}</b>
          </span>
          <span>
            Loudness target <b>-14 LUFS</b>
          </span>
        </div>
      </section>

      <section className="settings-card">
        <div>
          <h2>Secret handling</h2>
          <p>Saved provider credentials use authenticated encryption.</p>
        </div>
        <div className="provider-readiness">
          <span>
            Encryption <b data-ok="">AES-256-GCM</b>
          </span>
          <span>
            Browser delivery <b data-ok="">Never</b>
          </span>
          <span>
            Saved key display <b data-ok="">Fixed mask</b>
          </span>
        </div>
      </section>
    </main>
  )
}
