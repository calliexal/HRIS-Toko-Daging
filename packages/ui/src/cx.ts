type ClassValue = string | false | null | undefined;

/** Menggabungkan className; nilai falsy dibuang. */
export const cx = (...values: ClassValue[]): string => values.filter(Boolean).join(' ');
