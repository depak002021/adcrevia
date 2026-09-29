import { cn } from "@/lib/cn";

/**
 * Rationed on purpose. Three on the whole page: hero, workflow, waitlist.
 */
export function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-white/[0.045] px-3.5 py-1.5 font-mono text-[0.66rem] tracking-[0.2em] text-accent uppercase shadow-[inset_0_0_0_1px_var(--line-soft)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
