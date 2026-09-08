import { ThemeToggle } from '@zeus/ui/application';

/** The same Zeus preference control in public pages, navigation and the lounge. */
export function AppearanceToggle({ compact = false }: { compact?: boolean }) {
  return <ThemeToggle collapsed={compact} className="appearance-toggle" transitionDuration={350} />;
}
