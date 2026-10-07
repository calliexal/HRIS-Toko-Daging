import type { Metadata } from 'next';
import { AttendanceTodayScreen } from '@/features/admin/AttendanceTodayScreen';

export const metadata: Metadata = { title: 'Kehadiran hari ini' };

const Page = () => <AttendanceTodayScreen />;

export default Page;
