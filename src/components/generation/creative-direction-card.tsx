import { Aperture, Lightbulb, MapPin } from "@phosphor-icons/react/dist/ssr"

export type CreativeDirectionView = {
  position: number
  title: string
  description: string
  environment: string
  lighting: string
  /** The API returns `cameraDirection`; the database column is `camera`. */
  cameraDirection?: string
  camera?: string
}

export function CreativeDirectionCard({ direction }: { direction: CreativeDirectionView }) {
  const facts = [
    { icon: MapPin, label: "Environment", value: direction.environment },
    { icon: Lightbulb, label: "Lighting", value: direction.lighting },
    { icon: Aperture, label: "Camera", value: direction.cameraDirection ?? direction.camera },
  ]

  return (
    <article className="shell h-full transition-transform duration-500 ease-glide hover:-translate-y-1">
      <div className="core flex h-full flex-col gap-4 p-6">
        <span className="font-mono text-[0.78rem] tabular-nums text-accent">
          {String(direction.position).padStart(2, "0")}
        </span>

        <h3 className="text-[1.1rem] leading-snug font-medium tracking-[-0.02em] text-fg">
          {direction.title}
        </h3>

        <p className="text-[0.88rem] leading-relaxed text-muted">{direction.description}</p>

        <dl className="mt-auto flex flex-col gap-2.5 pt-2">
          {facts.map(({ icon: Icon, label, value }) =>
            value ? (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="flex items-center gap-1.5 font-mono text-[0.68rem] tracking-[0.1em] text-faint uppercase">
                  <Icon size={12} weight="light" aria-hidden="true" />
                  {label}
                </dt>
                <dd className="text-[0.82rem] leading-snug text-muted">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
      </div>
    </article>
  )
}
