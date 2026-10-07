import { useCallback, useState } from 'react';
import { useApi, type ClockDirection, type ClockMethod, type ClockRequest, type ClockResult, type GeoFix } from '@dagingpeople/api';
import { toEventTimestamp } from '../clock/serverClock';
import { useServices } from '../context';

export type AcceptedClock = Exclude<ClockResult, { outcome: 'rejected' }>;
export type RejectedClock = Extract<ClockResult, { outcome: 'rejected' }>;

/** State yang dikirim ke layar Hasil lewat router (tidak lewat query string). */
export type ClockOutcomeState = {
  result: AcceptedClock;
  method: ClockMethod;
  photo: 'sent' | 'queued' | 'simulated';
};

export const isClockOutcomeState = (value: unknown): value is ClockOutcomeState =>
  typeof value === 'object' && value !== null && 'result' in value && 'method' in value && 'photo' in value;

export type ClockSubmitInput = {
  direction: ClockDirection;
  method: ClockMethod;
  geo?: GeoFix;
  qrToken?: string;
  photo: { dataUrl: string; simulated: boolean };
  fieldDuty?: { reason: string };
  /** Untuk hasil lokal saat offline (server belum bisa ditanya). */
  fallback: { locationName: string; shiftLabel: string };
};

export type ClockSubmitOutcome = { kind: 'accepted'; state: ClockOutcomeState } | { kind: 'rejected'; result: RejectedClock };

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Mengirim absen. Online → POST /attendance/clock. Offline atau jaringan gagal → event masuk antrean lokal
 * dengan waktu dari jam server yang dihitung maju, lalu dikirim otomatis saat online (ATT-01 AC3).
 */
export const useClockSubmit = () => {
  const api = useApi();
  const { device, queue, serverClock } = useServices();
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (input: ClockSubmitInput): Promise<ClockSubmitOutcome> => {
      setSubmitting(true);
      try {
        const now = serverClock.now();
        const request: ClockRequest = {
          clientUuid: uuid(),
          direction: input.direction,
          method: input.method,
          geo: input.geo,
          qrToken: input.qrToken,
          photoRef: input.photo.dataUrl,
          fieldDuty: input.fieldDuty,
          deviceEventTime: now ? toEventTimestamp(now) : new Date().toISOString(),
          offline: false,
        };
        const photo: ClockOutcomeState['photo'] = input.photo.simulated ? 'simulated' : 'sent';

        const queueLocally = (): ClockSubmitOutcome => {
          const time = now?.time ?? '--:--';
          queue.enqueue({ request: { ...request, offline: true }, time, date: now?.date ?? '' });
          return {
            kind: 'accepted',
            state: {
              method: input.method,
              photo: input.photo.simulated ? 'simulated' : 'queued',
              result: { outcome: 'queued_offline', direction: input.direction, time, ...input.fallback },
            },
          };
        };

        if (!device.isOnline()) return queueLocally();

        let result: ClockResult;
        try {
          result = await api.employee.clock(request);
        } catch {
          // Gagal jaringan (bukan penolakan server): jangan sampai absen hilang.
          return queueLocally();
        }
        if (result.outcome === 'rejected') return { kind: 'rejected', result };
        return { kind: 'accepted', state: { result, method: input.method, photo: result.outcome === 'queued_offline' && photo === 'sent' ? 'queued' : photo } };
      } finally {
        setSubmitting(false);
      }
    },
    [api, device, queue, serverClock],
  );

  return { submit, submitting };
};
