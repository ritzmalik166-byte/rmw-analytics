'use client';
import { DimensionPage } from '@/components/analytics/DimensionPage';
import { countryName, flag } from '@/lib/utils';

const place = (v) => {
  const [cc, name] = String(v).split('|');
  return `${name}, ${countryName(cc)}`;
};

export default function GeographyPage() {
  return (
    <DimensionPage
      title="Geography"
      description="Approximate visitor location (derived from IP at ingestion; IPs are never stored)"
      exportType="geography"
      dims={[
        { key: 'country', label: 'Countries', format: countryName, icon: (v) => <span aria-hidden>{flag(v)}</span> },
        { key: 'region', label: 'Regions', format: place, icon: (v) => <span aria-hidden>{flag(String(v).split('|')[0])}</span> },
        { key: 'city', label: 'Cities', format: place, icon: (v) => <span aria-hidden>{flag(String(v).split('|')[0])}</span> },
        { key: 'language', label: 'Languages', format: (v) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(v) || v; } catch { return v; } } },
      ]}
    />
  );
}
