import { NextRequest } from 'next/server';
import { assignmentMutation } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: NextRequest) {
  return assignmentMutation(request);
}
