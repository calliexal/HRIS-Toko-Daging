import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from 'react';

export type AppLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  children?: ReactNode;
};

const PlainAnchor = ({ href, children, ...rest }: AppLinkProps) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

const LinkContext = createContext<ComponentType<AppLinkProps>>(PlainAnchor);

/**
 * Setiap aplikasi menyuntikkan komponen link-nya sendiri:
 * Next.js memberi `next/link`, aplikasi karyawan memberi link berbasis hash router.
 * Komponen layar cukup memakai <AppLink> dan tidak bergantung pada framework.
 */
export const LinkProvider = ({ component, children }: { component: ComponentType<AppLinkProps>; children: ReactNode }) => (
  <LinkContext.Provider value={component}>{children}</LinkContext.Provider>
);

export const AppLink = (props: AppLinkProps) => {
  const LinkComponent = useContext(LinkContext);
  return <LinkComponent {...props} />;
};
