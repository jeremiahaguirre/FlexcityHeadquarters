import type { CityDetail } from '@/lib/platform';

export interface PanelProps {
  id: string;
  city: CityDetail;
  reload: () => Promise<void>;
}
