import type { NextRequest } from 'next/server';
import { announcementDeletion } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  context: RouteContext<'/api/announcements/[id]'>,
) {
  const { id } = await context.params;
  return announcementDeletion(request, id);
}
