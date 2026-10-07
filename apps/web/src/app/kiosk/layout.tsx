import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Kiosk', template: '%s · DagingPeople' },
};

/** Kiosk tanpa sidebar admin; bingkai (header, tema terang) dipasang oleh KioskShell di tiap layar. */
const KioskLayout = ({ children }: { children: ReactNode }) => <>{children}</>;

export default KioskLayout;
