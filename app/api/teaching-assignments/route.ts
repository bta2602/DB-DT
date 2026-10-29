import { NextRequest } from 'next/server';
import { directoryMutation } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function PUT(request: NextRequest) {
  return directoryMutation(request, 'teaching-assignments');
}
