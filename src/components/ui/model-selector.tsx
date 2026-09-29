"use client"

import { useEffect, useMemo, useState } from "react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { CaretDown, Check, Sparkle } from "@phosphor-icons/react/dist/ssr"

import { cn } from "@/lib/cn"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Provider/model picker, shared by the image studio and the video studio.
 *
 * Consolidates two near-identical implementations (`ui/model-selector` and
 * `images/image-model-selector`). Both were hand-rolled listboxes with no
 * outside-click dismiss, no Escape, and no arrow-key navigation. Radix's
 * DropdownMenu supplies all of that plus correct focus return, and its
 * `RadioGroup` primitive expresses "one of these is selected" natively.
 *
 * Every catalogue model is listed so the picker communicates the full roadmap,
 * but only models whose provider is live AND has a stored credential are
 * selectable. The rest carry a reason — "Coming soon" or "Add key" — because a
 * disabled option with no explanation is worse than a hidden one.
 */

export type SelectableModel = {
  provider: string
  providerLabel: string
  emoji: string
  status: "live" | "planned"
  model: string
  modelLabel: string
  hint?: string
  configured: boolean
  active: boolean
}

export type ModelSelection = { provider: string; model: string }

export function ModelSelector({
  endpoint,
  label,
  value,
  onChange,
  disabled,
  className,
  recommended,
}: {
  /** The model to preselect and badge (best quality for the cost), when configured. */
  recommended?: string
  endpoint: string
  label: string
  value: ModelSelection | null
  onChange: (choice: ModelSelection) => void
  disabled?: boolean
  className?: string
}) {
  const [models, setModels] = useState<SelectableModel[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal })
        if (!response.ok) {
          setFailed(true)
          return
        }
        const body = (await response.json()) as { models: SelectableModel[] }
        setModels(body.models)
      } catch (error) {
        if ((error as Error).name !== "AbortError") setFailed(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [endpoint])

  // Preselection runs in its own effect keyed on the fetched list, so it cannot
  // fight a choice the user has already made (the previous version called
  // onChange from inside the fetch, which raced with user input).
  useEffect(() => {
    if (value !== null || models.length === 0) return
    const preferred =
      models.find((model) => model.configured && model.model === recommended) ??
      models.find((model) => model.active) ??
      models.find((m) => m.configured)
    if (preferred) onChange({ provider: preferred.provider, model: preferred.model })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models])

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; emoji: string; status: "live" | "planned"; configured: boolean; items: SelectableModel[] }
    >()
    for (const model of models) {
      if (!map.has(model.provider)) {
        map.set(model.provider, {
          label: model.providerLabel,
          emoji: model.emoji,
          status: model.status,
          configured: model.configured,
          items: [],
        })
      }
      map.get(model.provider)!.items.push(model)
    }
    // Usable providers first; within that, preserve catalogue order.
    return [...map.entries()].sort((a, b) => Number(b[1].configured) - Number(a[1].configured))
  }, [models])

  const selected = useMemo(
    () =>
      models.find(
        (model) => value && model.provider === value.provider && model.model === value.model,
      ),
    [models, value],
  )

  if (loading) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-56 rounded-full" />
      </div>
    )
  }

  if (failed) {
    return (
      <p className={cn("text-[0.82rem] text-danger", className)} role="alert">
        Could not load {label.toLowerCase()} options. Reload to try again.
      </p>
    )
  }

  if (!models.some((model) => model.configured)) {
    return (
      <p className={cn("max-w-xs text-[0.82rem] text-warning", className)}>
        No {label.toLowerCase()} is connected yet. A Super Admin needs to add a provider key in
        the admin console.
      </p>
    )
  }

  // `value` is the single source of truth, so the encoded key stays in sync with
  // whatever the parent holds.
  const selectedKey = value ? `${value.provider}::${value.model}` : ""

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="inline-flex items-center gap-1.5 font-mono text-[0.7rem] tracking-[0.12em] text-faint uppercase">
        <Sparkle size={12} weight="fill" aria-hidden="true" />
        {label}
      </span>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={disabled}
          className={cn(
            "group flex min-h-11 items-center gap-3 rounded-full pr-3 pl-4",
            "bg-white/[0.035] text-left shadow-[inset_0_0_0_1px_var(--line-soft)]",
            "transition-all duration-300 ease-glide",
            "hover:bg-white/[0.07] disabled:pointer-events-none disabled:opacity-55",
          )}
        >
          <span aria-hidden="true" className="text-base leading-none">
            {selected?.emoji ?? "🎛"}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[0.88rem] font-medium text-fg">
              {selected ? selected.modelLabel : "Choose a model"}
            </span>
            <span className="truncate text-[0.72rem] text-muted">
              {selected ? selected.providerLabel : `Select a ${label.toLowerCase()}`}
            </span>
          </span>
          <CaretDown
            size={14}
            weight="light"
            aria-hidden="true"
            className="shrink-0 text-muted transition-transform duration-300 group-data-[state=open]:rotate-180"
          />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={8}
            className={cn(
              "z-[56] max-h-[min(24rem,60dvh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto",
              "scrollbar-slim rounded-inner bg-ink-3/96 p-1.5 backdrop-blur-xl",
              "shadow-[0_28px_70px_-30px_rgb(0_0_0/0.9),inset_0_0_0_1px_var(--line-strong)]",
              "data-[state=open]:animate-surface-in",
            )}
          >
            <DropdownMenu.RadioGroup
              value={selectedKey}
              onValueChange={(next) => {
                const [provider, model] = next.split("::")
                onChange({ provider, model })
              }}
            >
              {groups.map(([key, group], groupIndex) => (
                <DropdownMenu.Group key={key}>
                  {groupIndex > 0 ? (
                    <DropdownMenu.Separator className="my-1.5 h-px bg-white/[0.06]" />
                  ) : null}
                  <DropdownMenu.Label className="flex items-center gap-2 px-2.5 py-1.5 text-[0.75rem] text-muted">
                    <span aria-hidden="true">{group.emoji}</span>
                    <span className="flex-1 truncate">{group.label}</span>
                    {group.status === "planned" ? (
                      <Badge>Coming soon</Badge>
                    ) : !group.configured ? (
                      <Badge tone="warning">Add key</Badge>
                    ) : null}
                  </DropdownMenu.Label>

                  {group.items.map((model) => (
                    <DropdownMenu.RadioItem
                      key={model.model}
                      value={`${model.provider}::${model.model}`}
                      disabled={!model.configured}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-chip px-2.5 py-2.5",
                        "outline-none transition-colors duration-200",
                        "data-[highlighted]:bg-white/[0.07]",
                        "data-[state=checked]:bg-accent/10",
                        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40",
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-2 truncate text-[0.86rem] text-fg">
                          {model.modelLabel}
                          {model.model === recommended && model.configured ? (
                            <span className="rounded-full bg-accent/15 px-1.5 py-px font-mono text-[0.58rem] tracking-[0.08em] text-accent uppercase">Recommended</span>
                          ) : null}
                        </span>
                        {model.hint ? (
                          <span className="truncate text-[0.72rem] text-muted">{model.hint}</span>
                        ) : null}
                      </span>
                      <DropdownMenu.ItemIndicator className="shrink-0">
                        <Check size={14} weight="bold" className="text-accent" aria-hidden="true" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.Group>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode
  tone?: "neutral" | "warning"
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-mono text-[0.62rem] tracking-[0.08em] uppercase",
        tone === "warning" ? "bg-warning/14 text-warning" : "bg-white/[0.07] text-faint",
      )}
    >
      {children}
    </span>
  )
}
