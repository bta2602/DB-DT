import type { NextRequest } from 'next/server';
import { materialDeletion } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, context: RouteContext<'/api/materials/[id]'>) {
  const { id } = await context.params;
  return materialDeletion(request, id);
}
