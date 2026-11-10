'use client';
import { Monitor, Smartphone, Tablet, HelpCircle } from 'lucide-react';
import { DimensionPage } from '@/components/analytics/DimensionPage';
import { titleCase } from '@/lib/utils';

const ICONS = { desktop: Monitor, mobile: Smartphone, tablet: Tablet };

export default function DevicesPage() {
  return (
    <DimensionPage
      title="Devices"
      description="Device type, operating system and screen resolution"
      exportType="devices"
      dims={[
        { key: 'device', label: 'Device types', format: titleCase, icon: (v) => { const I = ICONS[v] || HelpCircle; return <I className="h-4 w-4 text-slate-500" />; } },
        { key: 'os', label: 'Operating systems' },
        { key: 'screen', label: 'Screen sizes' },
      ]}
    />
  );
}
