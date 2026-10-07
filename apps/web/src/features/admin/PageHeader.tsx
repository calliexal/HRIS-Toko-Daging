'use client';

import type { ReactNode } from 'react';
import { useApi } from '@dagingpeople/api';
import { DemoBadge } from '@dagingpeople/ui';

export type PageHeaderProps = {
  title: ReactNode;
  /** Baris keterangan di bawah judul (tanggal, periode, status). */
  meta?: ReactNode;
  actions?: ReactNode;
};

export const PageHeader = ({ title, meta, actions }: PageHeaderProps) => {
  const api = useApi();
  return (
    <header className="adm-page-header">
      <div className="adm-page-header__text">
        <div className="adm-page-header__title-row">
          <h1 className="t-h1">{title}</h1>
          <DemoBadge show={api.isMock} />
        </div>
        {meta ? <div className="adm-page-header__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="adm-page-header__actions">{actions}</div> : null}
    </header>
  );
};
