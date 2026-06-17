// Resolve a server-supplied lucide icon name (kebab-case, e.g. "trash-2") to a
// lucide-react-native component. Falls back to Circle for unknown names.
import React from 'react';
import * as Lucide from 'lucide-react-native';

function pascal(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

export function LucideIcon({
  name,
  size = 18,
  color = '#374151',
}: {
  name?: string;
  size?: number;
  color?: string;
}) {
  const map = Lucide as unknown as Record<string, React.ComponentType<{ size?: number; color?: string }>>;
  const Cmp = (name && map[pascal(name)]) || map.Circle;
  return <Cmp size={size} color={color} />;
}
