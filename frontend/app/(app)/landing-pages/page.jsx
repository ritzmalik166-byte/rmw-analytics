'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MpfLandingPages } from '@/components/analytics/MpfLandingPages';
import { useFilters, withView } from '@/providers/FiltersProvider';
import { isMpfSite } from '@/lib/mpfLandingPages';

// Only My Property Fact has project landing pages; other websites go to Pages.
export default function LandingPagesPage() {
  const { current, websitesLoading, linkQuery } = useFilters();
  const router = useRouter();
  const mpf = isMpfSite(current);
  useEffect(() => { if (!websitesLoading && !mpf) router.replace(withView('/pages', linkQuery)); }, [websitesLoading, mpf, linkQuery, router]);
  return mpf ? <MpfLandingPages /> : null;
}
