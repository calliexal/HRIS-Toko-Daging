import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Masuk' };

const LoginLayout = ({ children }: { children: ReactNode }) => children;

export default LoginLayout;
