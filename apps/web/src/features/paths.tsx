'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Alamat setiap layar. Next.js memakai path asli; demo statis memakai path hash. */
export type WebPaths = {
  attendance: string;
  schedule: string;
  approvals: string;
  payroll: string;
  kioskOutlet: string;
  kioskPin: string;
  kioskWarehouse: string;
};

export const nextWebPaths: WebPaths = {
  attendance: '/kehadiran',
  schedule: '/jadwal',
  approvals: '/persetujuan',
  payroll: '/payroll',
  kioskOutlet: '/kiosk/outlet',
  kioskPin: '/kiosk/outlet/pin',
  kioskWarehouse: '/kiosk/gudang',
};

const WebPathsContext = createContext<WebPaths>(nextWebPaths);

export const WebPathsProvider = ({ paths, children }: { paths: WebPaths; children: ReactNode }) => (
  <WebPathsContext.Provider value={paths}>{children}</WebPathsContext.Provider>
);

export const useWebPaths = (): WebPaths => useContext(WebPathsContext);
