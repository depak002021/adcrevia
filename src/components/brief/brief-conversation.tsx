"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, CheckCircle, Globe, Notebook } from "@phosphor-icons/react/dist/ssr"

import { CreativeDirectionCard, type CreativeDirectionView } from "@/components/generation/creative-direction-card"
import { Progress } from "@/components/ui/progress"
import { Sheet } from "@/components/ui/sheet"
import { SkeletonDirectionCard } from "@/components/ui/skeleton"
import { useToast } from "@/components/ui/toast"
import type { ActivitySnapshot } from "@/features/projects/snapshot"
import { SETTLING_LABEL } from "@/features/brief/labels"
import type { BriefKnowledge, BriefTranscript, TranscriptEntry } from "@/features/brief/transcript"
import { cn } from "@/lib/cn"
import { prefersReducedMotion } from "@/lib/gsap"
import { BriefComposer } from "./brief-composer"

/**
 * The conversational brief.
 *
 * This is the surface that replaces the form. Three things about it are deliberate:
 *
 *  - The user's own message appears immediately, before the server has it. The turn
 *    is queued to a worker, so the round trip is a request plus a poll interval —
 *    long enough for a composer that clears with nothing to show for it to read as a
 *    dropped message.
 *  - Waiting is narrated with the worker's real label ("Reading example.com",
 *    "Drafted 4 directions"), not a generic spinner. Those lines come from the tools
 *    themselves, so they cannot claim something that did not happen.
 *  - What has been understood is shown, not just what was said. A conversation with
 *    an agent is otherwise opaque until the images come back wrong.
 */

const PHASE_LABELS: Record<BriefTranscript["phase"], string> = {
  DISCOVERY: "Getting to know it",
  PRODUCT_CONFIRM: "Which product?",
  DIRECTION: "Shot list ready",
  READY: "Ready to shoot",
}

export function BriefConversation({
  projectId,
  brief,
  activity,
  onSent,
}: {
  projectId: string
  brief: BriefTranscript | null
  activity: ActivitySnapshot | null
  /** Called after a turn is queued, so the caller can open the event stream. */
  onSent: () => void
}) {
  const toast = useToast()

  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const entries = brief?.entries ?? []

  // The optimistic entry is dropped as soon as the server's transcript contains it,
  // rather than on a timer: the stream is the authority, and a timer would either
  // duplicate the message or blink it out before the real one arrived.
  useEffect(() => {
    if (!pending) return
    if (entries.some((entry) => entry.role === "user" && entry.content === pending)) setPending(null)
  }, [entries, pending])

  const thinking = useMemo(() => {
    // After the reply is written the step only recalculates the brief meter: the
    // reply is on screen and the user may answer straight away.
    if (activity?.kind === "AGENT_STEP" && activity.label === SETTLING_LABEL) return null
    if (activity?.kind === "AGENT_STEP") return activity.label
    // The gap between queueing a turn and the first snapshot carrying it: the user
    // has pressed send, so something has to be happening on screen.
    if (pending) return "Thinking"
    // The first reply waits for the product page, so say that is what is happening.
    const website = brief?.knows.website
    const answered = brief?.entries.some((entry) => entry.role === "assistant")
    if (website && !website.analyzed && !website.safeErrorCode && !answered) return "Reading the product page first"
    return null
  }, [activity, pending, brief])

  const send = useCallback(async () => {
    const message = draft.trim()
    if (message.length === 0 || sending) return

    setSending(true)
    setDraft("")
    setPending(message)

    try {
      const response = await fetch(`/api/projects/${projectId}/brief`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "That message did not go through.")
      }
      // Open the stream straight away so the first worker frame is already awaited.
      onSent()
    } catch (error) {
      // Put the text back rather than losing it. Retyping a message the product
      // dropped is the most annoying failure available here.
      setPending(null)
      setDraft(message)
      toast({
        tone: "error",
        title: "Not sent",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSending(false)
    }
  }, [draft, onSent, projectId, sending, toast])

  const ready = brief?.phase === "READY"

  return (
    <>
      <section className="shell" aria-label="Creative brief">
        <div className="core flex flex-col gap-5 p-5 sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 shrink-0 rounded-full transition-colors duration-700",
                  ready ? "bg-accent" : "bg-accent/40",
                )}
              />
              <span className="truncate font-mono text-[0.7rem] tracking-[0.12em] text-faint uppercase">
                {PHASE_LABELS[brief?.phase ?? "DISCOVERY"]}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex w-32 flex-col gap-1.5 sm:w-44">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[0.74rem] text-faint">Brief</span>
                  <span className="font-mono text-[0.72rem] tabular-nums text-muted">
                    {brief?.completeness ?? 0}%
                  </span>
                </div>
                {/* A real number from the completeness classifier, not a field count. */}
                <Progress value={brief?.completeness ?? 0} label="Brief completeness" />
              </div>

              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="flex min-h-11 items-center gap-2 rounded-full px-3.5 text-[0.82rem] text-muted shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-500 ease-glide hover:bg-white/[0.05] hover:text-fg"
              >
                <Notebook size={16} weight="light" aria-hidden="true" />
                <span className="hidden sm:inline">The brief</span>
              </button>
            </div>
          </header>

          <Transcript projectId={projectId} knows={brief?.knows ?? null} entries={entries} pending={pending} thinking={thinking} />

          <BriefComposer
            label="Reply to Adcrevia"
            placeholder={ready ? "Anything to change before we shoot?" : "Tell me more…"}
            value={draft}
            onChange={setDraft}
            onSend={send}
            busy={sending || Boolean(thinking)}
          />
        </div>
      </section>

      <BriefSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        projectId={projectId}
        knows={brief?.knows ?? null}
      />
    </>
  )
}

function Transcript({
  projectId,
  knows,
  entries,
  pending,
  thinking,
}: {
  projectId: string
  knows: BriefKnowledge | null
  entries: TranscriptEntry[]
  pending: string | null
  thinking: string | null
}) {
  const endRef = useRef<HTMLDivElement>(null)
  // Replies already there when the page opened appear at once; new ones are revealed.
  const seen = useRef<Set<string> | null>(null)
  if (seen.current === null) seen.current = new Set(entries.map((entry) => entry.id))

  // Follow the conversation as it grows. Scrolling the sentinel rather than setting
  // scrollTop keeps it correct when the composer grows at the same time.
  const follow = useCallback(() => {
    endRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    })
  }, [])
  useEffect(follow, [entries.length, pending, thinking, follow])

  const empty = entries.length === 0 && !pending && !thinking
  const lastShotList = entries.map((entry) => entry.tool).lastIndexOf("propose_directions")

  return (
    <div
      className="scrollbar-slim flex max-h-[30rem] min-h-[9rem] flex-col gap-3 overflow-y-auto overscroll-contain pr-1"
      aria-live="polite"
      aria-label="Conversation"
    >
      {empty ? (
        <p className="py-6 text-[0.9rem] leading-relaxed text-muted">
          Tell Adcrevia about the product and it will ask for whatever it still needs.
        </p>
      ) : null}

      {entries.map((entry, index) => (
        <div key={entry.id} className="contents">
          <Entry entry={entry} animate={!seen.current!.has(entry.id)} onGrow={follow} />
          {index === 0 && knows?.website ? <WebsiteLine website={knows.website} /> : null}
          {index === lastShotList && knows?.directions.length ? (
            <ShotList projectId={projectId} directions={knows.directions} />
          ) : null}
        </div>
      ))}

      {pending ? <Bubble>{pending}</Bubble> : null}
      {thinking ? <Thinking label={thinking} /> : null}

      <div ref={endRef} aria-hidden="true" />
    </div>
  )
}

function Entry({ entry, animate, onGrow }: { entry: TranscriptEntry; animate: boolean; onGrow: () => void }) {
  if (entry.role === "user") return <Bubble>{entry.content}</Bubble>

  if (entry.role === "activity") {
    return (
      <p className="flex items-center gap-2.5 pl-1 text-[0.8rem] text-faint">
        <CheckCircle size={14} weight="light" aria-hidden="true" className="shrink-0 text-accent/70" />
        {entry.content}
      </p>
    )
  }

  return (
    <p className="max-w-[58ch] text-[0.94rem] leading-relaxed whitespace-pre-line text-fg">
      {animate ? <Reveal text={entry.content} onGrow={onGrow} /> : entry.content}
    </p>
  )
}

/**
 * A new reply appears word by word, as it would being spoken: quicker to start
 * reading than a finished paragraph landing at once. Purely presentational (the
 * reply is complete); skipped for reduced motion.
 */
function Reveal({ text, onGrow }: { text: string; onGrow: () => void }) {
  const words = useMemo(() => text.split(/(\s+)/), [text])
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? words.length : 0))

  useEffect(() => {
    if (shown >= words.length) return
    const timer = window.setTimeout(() => setShown((count) => Math.min(words.length, count + 2)), 28)
    return () => window.clearTimeout(timer)
  }, [shown, words.length])

  useEffect(() => {
    if (shown % 24 === 0 || shown >= words.length) onGrow()
  }, [shown, words.length, onGrow])

  return (
    <>
      {words.slice(0, shown).join("")}
      {shown < words.length ? <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-accent" /> : null}
    </>
  )
}

/** What was read from the link, in plain words, under the first message. */
function WebsiteLine({ website }: { website: NonNullable<BriefKnowledge["website"]> }) {
  let host = website.url
  try {
    host = new URL(website.url).host.replace(/^www\./, "")
  } catch {}
  const text = website.analyzed
    ? `Read ${host}${website.productName ? `: ${website.productName}` : ""}${website.photos ? ` · ${website.photos} product photo${website.photos === 1 ? "" : "s"} saved` : ""}`
    : website.safeErrorCode === "WEBSITE_BLOCKED"
      ? `${host} blocks automated reading. Add a few product photos below and nothing is lost.`
      : website.safeErrorCode
        ? `${host} could not be read. Add product photos below instead.`
        : `Reading ${host}…`
  return (
    <p className={cn("flex items-start gap-2.5 pl-1 text-[0.8rem]", website.analyzed ? "text-faint" : "text-muted")}>
      <Globe size={14} weight="light" aria-hidden="true" className={cn("mt-0.5 shrink-0", website.analyzed ? "text-accent/70" : "text-muted")} />
      <span className={cn("min-w-0", !website.analyzed && !website.safeErrorCode && "shimmer-text")}>{text}</span>
    </p>
  )
}

type ShotView = { position: number; title: string; description: string; mood?: string }

/**
 * The shot list, right where the agent announced it: what will be shot, in order,
 * and the one button that moves on. Each shot is one image and one scene.
 */
function ShotList({ projectId, directions }: { projectId: string; directions: BriefKnowledge["directions"] }) {
  const [shots, setShots] = useState<ShotView[] | null>(null)
  const signature = directions.map((direction) => `${direction.position}:${direction.title}`).join("|")

  useEffect(() => {
    let cancelled = false
    fetch(`/api/projects/${projectId}/directions`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: { directions?: ShotView[] }) => {
        if (!cancelled) setShots(body.directions ?? [])
      })
      .catch(() => {
        if (!cancelled) setShots([])
      })
    return () => {
      cancelled = true
    }
  }, [projectId, signature])

  const list: ShotView[] = shots?.length ? shots : directions.map((direction) => ({ ...direction, description: "" }))

  return (
    <div className="reveal-in rounded-card p-3.5 shadow-[inset_0_0_0_1px_var(--line)] sm:p-4">
      <p className="font-mono text-[0.66rem] tracking-[0.12em] text-faint uppercase">Shot list · {list.length} shots</p>
      <ol className="mt-2.5 flex flex-col gap-2.5">
        {list.map((shot) => (
          <li key={shot.position} className="flex gap-3">
            <span className="mt-0.5 font-mono text-[0.72rem] tabular-nums text-accent">{String(shot.position).padStart(2, "0")}</span>
            <div className="min-w-0">
              <p className="text-[0.88rem] leading-snug text-fg">{shot.title}</p>
              {shot.description ? <p className="mt-0.5 line-clamp-2 text-[0.8rem] leading-snug text-muted">{shot.description}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => document.getElementById("concepts")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" })}
        className="mt-3.5 flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 text-[0.82rem] font-medium text-ink transition-transform duration-300 hover:-translate-y-px"
      >
        Choose a model and generate <ArrowDown size={14} weight="bold" aria-hidden="true" />
      </button>
    </div>
  )
}

function Bubble({ children }: { children: string }) {
  return (
    <p className="ml-auto max-w-[48ch] rounded-card bg-accent/10 px-4 py-2.5 text-[0.92rem] leading-relaxed whitespace-pre-line text-fg shadow-[inset_0_0_0_1px_--alpha(var(--color-accent)/20%)]">
      {children}
    </p>
  )
}

/**
 * The waiting state: what the agent is doing right now, what it has already done in
 * this turn, and for how long. Every line is the worker's own label, so it cannot
 * claim something that did not happen.
 */
function Thinking({ label }: { label: string }) {
  const [done, setDone] = useState<string[]>([])
  const [current, setCurrent] = useState(label)
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (label === current) return
    setDone((items) => (items.includes(current) || current === "Thinking" ? items : [...items, current]).slice(-3))
    setCurrent(label)
  }, [label, current])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.round((now - startedAt) / 1000))

  return (
    <div className="flex flex-col gap-1.5 pl-1">
      {done.map((item) => (
        <p key={item} className="flex items-center gap-2.5 text-[0.8rem] text-faint">
          <CheckCircle size={14} weight="light" aria-hidden="true" className="shrink-0 text-accent/70" />
          {item}
        </p>
      ))}
      <p className="flex items-center gap-2.5 text-[0.9rem]">
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="size-1.5 rounded-full bg-accent/70"
              style={{ animation: "var(--animate-breathe)", animationDelay: `${index * 0.16}s` }}
            />
          ))}
        </span>
        <span className="shimmer-text">{current}</span>
        {seconds >= 3 ? <span className="font-mono text-[0.72rem] tabular-nums text-faint">{seconds}s</span> : null}
      </p>
    </div>
  )
}

/**
 * What the product has understood.
 *
 * A bottom sheet rather than a side panel: this is checked on a phone, mid-thought,
 * and dismissed with a thumb. The directions are fetched when it opens rather than
 * carried on the snapshot, because their full text is kilobytes and the snapshot is
 * re-read every second while work is in flight.
 */
function BriefSheet({
  open,
  onOpenChange,
  projectId,
  knows,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  knows: BriefKnowledge | null
}) {
  const [directions, setDirections] = useState<CreativeDirectionView[] | null>(null)
  const [loading, setLoading] = useState(false)

  const expected = knows?.directions.length ?? 0

  useEffect(() => {
    if (!open || expected === 0 || directions) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/projects/${projectId}/directions`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: { directions?: CreativeDirectionView[] }) => {
        if (!cancelled) setDirections(body.directions ?? [])
      })
      .catch(() => {
        // Not worth a toast: the sheet still shows everything else, and the titles
        // are already on screen from the snapshot.
        if (!cancelled) setDirections([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [directions, expected, open, projectId])

  const facts = knows
    ? [
        { label: "Product", value: knows.productName },
        { label: "In short", value: knows.productSummary },
        { label: "Material and finish", value: knows.physicalDetail },
        { label: "Audience", value: knows.audience },
        { label: "Mood", value: knows.mood },
        { label: "Where it runs", value: knows.usageContext },
      ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value))
    : []

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="The brief so far"
      description="Everything Adcrevia has established about this campaign."
      snapPoints={[0.62, 0.92]}
    >
      <div className="flex flex-col gap-7 pb-6">
        {facts.length === 0 ? (
          <p className="text-[0.9rem] leading-relaxed text-muted">
            Nothing recorded yet. Answer a question or two and it will fill in here.
          </p>
        ) : (
          <dl className="flex flex-col gap-4">
            {facts.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-1">
                <dt className="font-mono text-[0.68rem] tracking-[0.12em] text-faint uppercase">
                  {fact.label}
                </dt>
                <dd className="text-[0.92rem] leading-relaxed text-fg">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {knows?.palette.length ? (
          <section className="flex flex-col gap-2.5">
            <h3 className="font-mono text-[0.68rem] tracking-[0.12em] text-faint uppercase">Palette</h3>
            <ul className="flex flex-wrap gap-2">
              {knows.palette.map((color) => (
                <li key={color} className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 shadow-[inset_0_0_0_1px_var(--line)]">
                  <span
                    aria-hidden="true"
                    className="size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono text-[0.72rem] text-muted">{color}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {knows?.website ? (
          <section className="flex flex-col gap-1.5">
            <h3 className="font-mono text-[0.68rem] tracking-[0.12em] text-faint uppercase">Website</h3>
            <p className="text-[0.9rem] text-fg">{knows.website.title ?? knows.website.url}</p>
            <p className="text-[0.82rem] text-muted">
              {knows.website.analyzed
                ? "Read successfully."
                : knows.website.safeErrorCode === "WEBSITE_BLOCKED"
                  ? "This store blocks automated reading (Amazon does). Upload product photos in the project instead; they are used exactly the same way."
                  : knows.website.safeErrorCode
                  ? "Could not be read, so nothing from it is being used. Upload product photos in the project instead."
                  : "Queued to be read."}
            </p>
            {knows.candidates.length > 1 && !knows.confirmedProductUrl ? (
              <p className="mt-1 text-[0.82rem] text-muted">
                Several products found: {knows.candidates.join(", ")}.
              </p>
            ) : null}
          </section>
        ) : null}

        {expected > 0 ? (
          <section className="flex flex-col gap-3">
            <h3 className="font-mono text-[0.68rem] tracking-[0.12em] text-faint uppercase">
              {expected} direction{expected === 1 ? "" : "s"}
            </h3>
            {loading && !directions ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: Math.min(expected, 2) }, (_, index) => (
                  <SkeletonDirectionCard key={index} index={index} />
                ))}
              </div>
            ) : directions?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {directions.map((direction) => (
                  <CreativeDirectionCard key={direction.position} direction={direction} />
                ))}
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {knows?.directions.map((direction) => (
                  <li key={direction.position} className="text-[0.9rem] text-fg">
                    <span className="font-mono text-[0.75rem] tabular-nums text-accent">
                      {String(direction.position).padStart(2, "0")}
                    </span>{" "}
                    {direction.title}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </Sheet>
  )
}
