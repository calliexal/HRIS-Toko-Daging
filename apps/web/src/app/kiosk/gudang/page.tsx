import type { Metadata } from 'next';
import { WarehouseKioskScreen } from '@/features/kiosk/WarehouseKioskScreen';

export const metadata: Metadata = { title: 'Kiosk gudang' };

const Page = () => <WarehouseKioskScreen />;

export default Page;
