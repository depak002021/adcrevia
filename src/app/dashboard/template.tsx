/**
 * Re-mounted on every navigation inside the studio (unlike the layout), so each
 * screen eases in instead of snapping into place.
 */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
