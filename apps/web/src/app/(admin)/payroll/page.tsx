import type { Metadata } from 'next';
import { PayrollRunScreen } from '@/features/admin/PayrollRunScreen';

export const metadata: Metadata = { title: 'Payroll' };

const Page = () => <PayrollRunScreen />;

export default Page;
