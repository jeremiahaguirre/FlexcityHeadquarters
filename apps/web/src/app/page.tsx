import { redirect } from 'next/navigation';
import { HomeRedirect } from '@/components/HomeRedirect';
import { DEMO } from '@/lib/demo';
import { currentTenant } from '@/lib/tenant';

/** An organization's address goes to its app; the bare FH address goes to the Dev console. */
export default async function Home() {
  if (!DEMO && !(await currentTenant())) redirect('/platform');
  return <HomeRedirect />;
}
