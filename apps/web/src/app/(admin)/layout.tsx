import type { ReactNode } from 'react';
import { AdminFrame } from './AdminFrame';

const AdminLayout = ({ children }: { children: ReactNode }) => <AdminFrame>{children}</AdminFrame>;

export default AdminLayout;
