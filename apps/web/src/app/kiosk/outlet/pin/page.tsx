import type { Metadata } from 'next';
import { PinKioskScreen } from '@/features/kiosk/PinKioskScreen';

export const metadata: Metadata = { title: 'Kiosk · absen dengan PIN' };

const Page = () => <PinKioskScreen />;

export default Page;
