import type { Metadata } from 'next';
import { OutletKioskScreen } from '@/features/kiosk/OutletKioskScreen';

export const metadata: Metadata = { title: 'Kiosk outlet' };

const Page = () => <OutletKioskScreen />;

export default Page;
