import Link from "next/link"

export function AdcreviaMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="Adcrevia home" className="brand-mark">
      <span aria-hidden="true" className="brand-mark__glyph">
        A
      </span>
      {!compact && <span className="brand-mark__name">Adcrevia</span>}
    </Link>
  )
}
