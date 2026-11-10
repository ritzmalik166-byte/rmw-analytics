'use client';
import { DimensionPage } from '@/components/analytics/DimensionPage';

export default function BrowsersPage() {
  return <DimensionPage title="Browsers" description="Browsers used by visitors" exportType="devices" dims={[{ key: 'browser', label: 'Browsers' }]} />;
}
