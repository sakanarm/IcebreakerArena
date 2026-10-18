import type { Metadata } from 'next';
import { EditorApp } from '@/components/editor/EditorApp';

export const metadata: Metadata = { title: 'สร้างเกม' };

export default async function EditorPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams;
  const gameId = typeof id === 'string' && id ? id : null;
  return <EditorApp key={gameId ?? 'new'} id={gameId} />;
}
