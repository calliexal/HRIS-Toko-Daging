import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '../cx';

type FieldFrameProps = {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Sembunyikan label secara visual (tetap terbaca pembaca layar). Pakai hanya bila konteks sudah jelas. */
  hideLabel?: boolean;
  className?: string;
};

const useFieldIds = (id?: string) => {
  const generated = useId();
  const fieldId = id ?? generated;
  return { fieldId, hintId: `${fieldId}-hint`, errorId: `${fieldId}-error` };
};

const describedBy = (hintId: string, errorId: string, hint?: ReactNode, error?: ReactNode) =>
  [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

const Frame = ({
  fieldId,
  hintId,
  errorId,
  label,
  hint,
  error,
  hideLabel,
  className,
  children,
}: FieldFrameProps & { fieldId: string; hintId: string; errorId: string; children: ReactNode }) => (
  <div className={cx('dp-field', error ? 'dp-field--error' : null, className)}>
    <label htmlFor={fieldId} className={cx('dp-field__label', hideLabel && 'dp-visually-hidden')}>
      {label}
    </label>
    {children}
    {hint && !error ? (
      <p id={hintId} className="dp-field__hint">
        {hint}
      </p>
    ) : null}
    {error ? (
      <p id={errorId} className="dp-field__error" role="alert">
        {error}
      </p>
    ) : null}
  </div>
);

export type TextFieldProps = FieldFrameProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>;

export const TextField = ({ label, hint, error, hideLabel, className, id, ...input }: TextFieldProps) => {
  const ids = useFieldIds(id);
  return (
    <Frame {...ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <input
        id={ids.fieldId}
        className="dp-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids.hintId, ids.errorId, hint, error)}
        {...input}
      />
    </Frame>
  );
};

export type SelectFieldProps = FieldFrameProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
    options: ReadonlyArray<{ value: string; label: string }>;
  };

export const SelectField = ({ label, hint, error, hideLabel, className, id, options, ...select }: SelectFieldProps) => {
  const ids = useFieldIds(id);
  return (
    <Frame {...ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <select
        id={ids.fieldId}
        className="dp-input dp-select"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids.hintId, ids.errorId, hint, error)}
        {...select}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Frame>
  );
};

export type TextAreaFieldProps = FieldFrameProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export const TextAreaField = ({ label, hint, error, hideLabel, className, id, rows = 3, ...textarea }: TextAreaFieldProps) => {
  const ids = useFieldIds(id);
  return (
    <Frame {...ids} label={label} hint={hint} error={error} hideLabel={hideLabel} className={className}>
      <textarea
        id={ids.fieldId}
        rows={rows}
        className="dp-input dp-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids.hintId, ids.errorId, hint, error)}
        {...textarea}
      />
    </Frame>
  );
};
