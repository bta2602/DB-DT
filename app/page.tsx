import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSession } from '@/lib/studyhub/auth-store.mjs';

export default async function HomePage() {
  const token = (await cookies()).get('studyhub_session')?.value;
  const user = token ? readSession(token)?.user : null;
  redirect(!user ? '/login' : user.role === 'admin' ? '/overview' : '/today');
}
