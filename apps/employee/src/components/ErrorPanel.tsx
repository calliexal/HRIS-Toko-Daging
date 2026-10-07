import type { ReactNode } from 'react';
import { Icon, type IconName } from '@dagingpeople/ui';

type ErrorPanelProps = {
  title: string;
  icon?: IconName;
  children: ReactNode;
  /** Langkah jalan keluar, berurutan. */
  steps?: string[];
  actions: ReactNode;
};

/** Layar penolakan (danger) yang selalu memberi jalan keluar (Konvensi #6). */
export const ErrorPanel = ({ title, icon = 'x-circle', children, steps, actions }: ErrorPanelProps) => (
  <section className="emp-error" role="alert" aria-labelledby="emp-error-title">
    <span className="emp-error__icon">
      <Icon name={icon} size={40} />
    </span>
    <h2 id="emp-error-title" className="t-h2">
      {title}
    </h2>
    <div className="t-body emp-error__text">{children}</div>
    {steps?.length ? (
      <ol className="emp-error__steps">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    ) : null}
    <div className="emp-error__actions">{actions}</div>
  </section>
);
