import { NextRequest } from 'next/server';
import { gradeMutation } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string; studentId: string }> }) {
  const { id, studentId } = await context.params;
  return gradeMutation(request, id, studentId);
}
