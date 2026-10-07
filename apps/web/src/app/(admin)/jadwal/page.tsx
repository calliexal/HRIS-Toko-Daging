import type { Metadata } from 'next';
import { WeeklyScheduleScreen } from '@/features/admin/WeeklyScheduleScreen';

export const metadata: Metadata = { title: 'Jadwal shift' };

const Page = () => <WeeklyScheduleScreen />;

export default Page;
