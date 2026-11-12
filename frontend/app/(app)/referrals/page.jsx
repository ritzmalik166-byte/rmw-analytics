'use client';
import { DimensionPage } from '@/components/analytics/DimensionPage';

export default function ReferralsPage() {
  return (
    <DimensionPage
      title="Referrals"
      description="Other websites that sent you visitors by linking to you"
      exportType="sources"
      dims={[{ key: 'referrer', label: 'Websites' }]}
    />
  );
}
