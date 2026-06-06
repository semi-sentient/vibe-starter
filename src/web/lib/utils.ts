import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose Tailwind class names: `clsx` resolves conditionals/arrays into a
 * string, then `tailwind-merge` de-duplicates conflicting utilities so the last
 * one wins (e.g. `cn('p-2', condition && 'p-4')` yields `p-4`). The standard
 * shadcn/ui helper; every vendored component in `components/ui` uses it.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
