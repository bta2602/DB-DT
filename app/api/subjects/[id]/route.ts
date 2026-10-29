import { NextRequest } from 'next/server';
import { directoryMutation } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return directoryMutation(request, 'subjects', id);
}
