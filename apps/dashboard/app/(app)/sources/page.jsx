'use client';
import { CHANNELS } from '@rmw-analytics/shared/channels';
import { DimensionPage } from '@/components/analytics/DimensionPage';

export default function SourcesPage() {
  return (
    <DimensionPage
      title="Traffic sources"
      description="Where sessions come from: channel grouping, source, referrer and UTM tags"
      exportType="sources"
      dims={[
        { key: 'channel', label: 'Channels', format: (v) => CHANNELS[v] || v },
        { key: 'source', label: 'Sources' },
        { key: 'referrer', label: 'Referrers' },
        { key: 'utm_source', label: 'UTM source' },
        { key: 'utm_medium', label: 'UTM medium' },
        { key: 'entry', label: 'Landing pages' },
      ]}
    />
  );
}
