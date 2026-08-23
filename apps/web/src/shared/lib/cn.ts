import clsx, { type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
