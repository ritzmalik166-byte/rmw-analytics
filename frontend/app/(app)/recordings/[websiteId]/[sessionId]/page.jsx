'use client';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { RecordingView } from '@/components/analytics/RecordingView';

export default function RecordingPage({ params }) {
  const { websiteId, sessionId } = use(params);
  const router = useRouter();
  return <RecordingView websiteId={websiteId} sessionId={sessionId} onDeleted={() => router.replace('/recordings')} />;
}
