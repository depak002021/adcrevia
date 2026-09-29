import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Join class names and let later Tailwind utilities win over earlier ones.
 *
 * `clsx` handles conditionals and arrays; `twMerge` resolves genuine conflicts,
 * so a component's default `px-4` is replaced rather than duplicated when a
 * caller passes `px-6`. That is what makes the `className` prop on our
 * primitives safe to override without specificity games.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
