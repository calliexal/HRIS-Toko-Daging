import type { Metadata } from 'next';
import { ApprovalsScreen } from '@/features/admin/ApprovalsScreen';

export const metadata: Metadata = { title: 'Persetujuan' };

const Page = () => <ApprovalsScreen />;

export default Page;
