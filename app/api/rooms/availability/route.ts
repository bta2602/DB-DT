import { NextRequest } from 'next/server';
import { roomAvailability } from '@/lib/studyhub/auth-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  return roomAvailability(request);
}
