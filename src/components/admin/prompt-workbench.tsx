"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, History, RotateCcw } from "lucide-react"

import type { PromptKeyDto, PromptVersionDto } from "@/features/admin/prompts/service"

/**
 * Editing what the models are told.
 *
 * Every instruction in the product used to be a string literal, so tuning a tone or a
 * rubric meant a deploy and nothing recorded which wording produced a given output.
 *
 * Saving creates a new version rather than editing the current one. That is the whole
 * design: a bad change is a rollback, the history shows who changed what and when, and
 * `AgentRun.promptTemplateId` can still be traced to an exact wording after two more
 * edits. "Save without activating" exists so a change can be reviewed before it reaches
 * a user.
 */
export function PromptWorkbench({ prompts }: { prompts: PromptKeyDto[] }) {
  const [selected, setSelected] = useState(prompts[0]?.key ?? "")
  const [versions, setVersions] = useState<PromptVersionDto[]>([])
  const [body, setBody] = useState("")
  const [label, setLabel] = useState("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [keys, setKeys] = useState(prompts)

  const entry = keys.find((prompt) => prompt.key === selected)

  const load = useCallback(
    async (key: string) => {
      setBusy("load")
      setMessage(null)
      try {
        const response = await fetch(`/api/admin/prompts/${encodeURIComponent(key)}`)
        const payload = (await response.json().catch(() => ({}))) as { versions?: PromptVersionDto[] }
        const loaded = payload.versions ?? []
        setVersions(loaded)
        // Start from whatever is live, or from the wording in the code when nothing is.
        // An empty editor would invite writing a prompt from scratch, which is how a
        // carefully tuned instruction gets lost.
        const active = loaded.find((version) => version.active)
        const fallback = keys.find((prompt) => prompt.key === key)?.fallback ?? ""
        setBody(active?.body ?? fallback)
        setLabel(active ? `${active.label} (revised)` : "First revision")
        setNotes("")
      } finally {
        setBusy(null)
      }
    },
    [keys],
  )

  useEffect(() => {
    if (selected) void load(selected)
    // Only when the selected prompt changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const refreshKeys = async () => {
    const response = await fetch("/api/admin/prompts")
    const payload = (await response.json().catch(() => ({}))) as { prompts?: PromptKeyDto[] }
    if (payload.prompts) setKeys(payload.prompts)
  }

  const save = async (activate: boolean) => {
    setBusy(activate ? "activate" : "save")
    setMessage(null)
    try {
      const response = await fetch(`/api/admin/prompts/${encodeURIComponent(selected)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, body, notes: notes || undefined, activate }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setMessage(payload.error ?? "That did not save.")
        return
      }
      setMessage(activate ? "Saved and live." : "Saved. Not live yet.")
      await Promise.all([load(selected), refreshKeys()])
    } finally {
      setBusy(null)
    }
  }

  const activate = async (versionId: string) => {
    setBusy(versionId)
    try {
      const response = await fetch(`/api/admin/prompts/${encodeURIComponent(selected)}/activate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      })
      if (!response.ok) {
        setMessage("That version could not be activated.")
        return
      }
      setMessage("That version is live.")
      await Promise.all([load(selected), refreshKeys()])
    } finally {
      setBusy(null)
    }
  }

  const revert = async () => {
    setBusy("revert")
    try {
      const response = await fetch(`/api/admin/prompts/${encodeURIComponent(selected)}`, { method: "DELETE" })
      if (!response.ok) {
        setMessage("Could not fall back.")
        return
      }
      setMessage("Back to the wording built into the application.")
      await Promise.all([load(selected), refreshKeys()])
    } finally {
      setBusy(null)
    }
  }

  const unchanged = entry ? body.trim() === entry.fallback.trim() && versions.length === 0 : false

  return (
    <div className="prompt-workbench">
      <nav className="prompt-keys" aria-label="Prompts">
        {keys.map((prompt) => (
          <button
            key={prompt.key}
            type="button"
            aria-current={prompt.key === selected ? "true" : undefined}
            onClick={() => setSelected(prompt.key)}
          >
            <span>{prompt.label}</span>
            <small>
              {prompt.activeVersion ? `v${prompt.activeVersion}` : "built in"}
              {prompt.versionCount > 0 ? ` · ${prompt.versionCount} saved` : ""}
            </small>
          </button>
        ))}
      </nav>

      {entry ? (
        <div className="prompt-editor">
          <div>
            <h2>{entry.label}</h2>
            <p>{entry.description}</p>
            {entry.variables.length > 0 ? (
              <p className="prompt-variables">
                Must reference:{" "}
                {entry.variables.map((variable) => (
                  <code key={variable}>{`{{${variable}}}`}</code>
                ))}
              </p>
            ) : null}
          </div>

          <label>
            Revision name
            <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} required />
          </label>

          <label>
            Instructions
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={14}
              maxLength={12_000}
              spellCheck
            />
            <small>
              {body.length.toLocaleString()} characters
              {unchanged ? " · unchanged from the built-in wording" : ""}
            </small>
          </label>

          <label>
            Why (optional)
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={1_000}
              placeholder="What this change is meant to fix"
            />
          </label>

          <div className="provider-actions">
            <button type="button" onClick={() => save(true)} disabled={busy !== null || body.trim().length < 20}>
              <CheckCircle2 size={15} aria-hidden />
              {busy === "activate" ? "Saving" : "Save and make live"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => save(false)}
              disabled={busy !== null || body.trim().length < 20}
            >
              {busy === "save" ? "Saving" : "Save without activating"}
            </button>
            {entry.activeVersion ? (
              <button type="button" className="ghost" onClick={revert} disabled={busy !== null}>
                <RotateCcw size={15} aria-hidden />
                Use the built-in wording
              </button>
            ) : null}
          </div>

          {message ? (
            <p className="provider-message" role="status">
              {message}
            </p>
          ) : null}

          <section className="prompt-history">
            <h3>
              <History size={15} aria-hidden /> History
            </h3>
            {versions.length === 0 ? (
              <p>No saved revisions. The wording built into the application is in use.</p>
            ) : (
              <ul>
                {versions.map((version) => (
                  <li key={version.id}>
                    <div>
                      <b>
                        v{version.version} · {version.label}
                      </b>
                      <small>
                        {new Date(version.createdAt).toLocaleString()}
                        {version.createdBy ? ` · ${version.createdBy.name ?? version.createdBy.email}` : ""}
                        {version.notes ? ` · ${version.notes}` : ""}
                      </small>
                    </div>
                    {version.active ? (
                      <span className="prompt-live">Live</span>
                    ) : (
                      <button type="button" className="ghost" onClick={() => activate(version.id)} disabled={busy !== null}>
                        {busy === version.id ? "Activating" : "Make live"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
