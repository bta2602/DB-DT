import { NextRequest } from 'next/server';
import { academicMutation } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function PUT(request: NextRequest) {
  return academicMutation(request, 'teacher-subjects');
}
