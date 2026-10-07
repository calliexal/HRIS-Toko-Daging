'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatClock, useApi, type KioskClockResult, type KioskIdentity } from '@dagingpeople/api';
import { CONFIRMATION_MS } from './useKioskData';

export const CODE_LENGTH = 4;
export const PIN_LENGTH = 6;

export type PinStep = 'code' | 'pin';

export type PinMessage = { tone: 'danger' | 'warning'; title: string; text: string };

/**
 * Alur absen PIN (ATT-02 AC2): nomor karyawan 4 digit → nama tampil → PIN 6 digit → absen.
 * Kunci akun berlaku per karyawan; kiosk direset agar orang lain tetap bisa absen.
 */
export const usePinClock = (kioskId: string, capture: () => string, onRecorded: () => void) => {
  const api = useApi();
  const [step, setStep] = useState<PinStep>('code');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [identity, setIdentity] = useState<KioskIdentity | null>(null);
  const [looking, setLooking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<PinMessage | null>(null);
  const [locked, setLocked] = useState(false);
  const [success, setSuccess] = useState<Extract<KioskClockResult, { outcome: 'recorded' }> | null>(null);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;

  const reset = useCallback(() => {
    setStep('code');
    setCode('');
    setPin('');
    setIdentity(null);
    setMessage(null);
    setLocked(false);
    setSuccess(null);
  }, []);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(reset, CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [success, reset]);

  const lookup = useCallback(
    async (value: string) => {
      setLooking(true);
      setMessage(null);
      try {
        const who = await api.kiosk.lookupEmployeeCode(value);
        if (who) {
          setIdentity(who);
          setStep('pin');
        } else {
          setMessage({ tone: 'danger', title: `Nomor ${value} tidak ditemukan`, text: 'Periksa 4 digit terakhir nomor di kartu ID Anda, atau tanya Kepala Toko.' });
          setCode('');
        }
      } catch {
        setMessage({ tone: 'danger', title: 'Koneksi terputus', text: 'Nomor belum bisa diperiksa. Coba lagi sebentar lagi.' });
      } finally {
        setLooking(false);
      }
    },
    [api],
  );

  const submit = useCallback(async () => {
    if (step !== 'pin' || pin.length !== PIN_LENGTH || submitting || locked) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await api.kiosk.clockWithPin(kioskId, code, pin, capture());
      if (result.outcome === 'recorded') {
        setSuccess(result);
        onRecordedRef.current();
        return;
      }
      setPin('');
      if (result.reason === 'locked') {
        setLocked(true);
        setMessage({
          tone: 'danger',
          title: 'Akun dikunci 15 menit',
          text: `PIN salah 3 kali. ${identity?.name.split(' ')[0] ?? 'Anda'} bisa mencoba lagi pukul ${result.lockedUntil ? formatClock(result.lockedUntil) : '—'}. Kepala Toko sudah diberi tahu. Karyawan lain tetap bisa absen.`,
        });
      } else if (result.reason === 'wrong_pin') {
        const left = result.attemptsLeft ?? 0;
        setMessage({ tone: 'warning', title: 'PIN belum cocok', text: `Sisa ${left} kali percobaan sebelum akun dikunci 15 menit. Lupa PIN? Minta Kepala Toko meresetnya.` });
      } else {
        setMessage({ tone: 'danger', title: 'Absen belum tercatat', text: 'Coba lagi, atau pakai kartu ID.' });
      }
    } catch {
      setPin('');
      setMessage({ tone: 'danger', title: 'Koneksi terputus', text: 'Absen belum terkirim. Coba lagi sebentar lagi.' });
    } finally {
      setSubmitting(false);
    }
  }, [api, kioskId, code, pin, step, submitting, locked, capture, identity]);

  const pressDigit = useCallback(
    (digit: string) => {
      if (submitting || looking || locked || success) return;
      if (step === 'code') {
        if (code.length >= CODE_LENGTH) return;
        const next = code + digit;
        setCode(next);
        setMessage(null);
        if (next.length === CODE_LENGTH) void lookup(next);
      } else if (pin.length < PIN_LENGTH) {
        setPin(pin + digit);
      }
    },
    [step, code, pin, submitting, looking, locked, success, lookup],
  );

  const backspace = useCallback(() => {
    if (submitting || looking || success) return;
    if (locked) return;
    if (step === 'pin') {
      if (pin.length > 0) setPin(pin.slice(0, -1));
      else {
        // Hapus saat PIN kosong = kembali mengubah nomor karyawan.
        setStep('code');
        setIdentity(null);
        setCode(code.slice(0, -1));
        setMessage(null);
      }
    } else {
      setCode(code.slice(0, -1));
    }
  }, [step, pin, code, submitting, looking, locked, success]);

  return { step, code, pin, identity, looking, submitting, message, locked, success, pressDigit, backspace, submit, reset };
};
