import type { BlockProps } from './types';

interface SpacerData {
  height: number;
}

export function SpacerBlock({ data }: BlockProps<SpacerData>) {
  return <div style={{ height: data.height }} aria-hidden="true" />;
}
