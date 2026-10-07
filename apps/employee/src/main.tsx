import '@dagingpeople/tokens/tokens.css';
import '@dagingpeople/ui/styles.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHttpClient, createMockClient, createSessionStore, DEMO_FIXTURES, type HrisClient } from '@dagingpeople/api';
import { EmployeeApp } from './App';
import { createServerClock } from './clock/serverClock';
import { createDevice, createFieldSimulation, withFieldSimulation } from './device';
import { createSessionPersistence } from './device/secureStorage';
import { createOfflineQueue } from './offline/queue';

/** Versi ditampilkan di Profil. Disamakan dengan package.json saat rilis. */
const APP_VERSION = '0.1.0';

/**
 * Sesi login: token disimpan di Keychain/Keystore (native) atau sessionStorage (browser).
 * Klien API: HTTP bila VITE_API_URL diisi (mis. https://api.dagingprima.co.id), selain itu mock untuk demo/usability test.
 * Mock dibuat sebagai MockHrisClient agar setScenario bisa dipakai kartu "Simulasi kondisi lapangan".
 */
const session = createSessionStore({ persistence: createSessionPersistence() });
const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const mock = createMockClient();
const client: HrisClient = apiUrl
  ? createHttpClient({ baseUrl: apiUrl, getToken: () => session.token(), onUnauthenticated: () => session.end('unauthenticated') })
  : mock;
const simulation = createFieldSimulation(mock);
const device = withFieldSimulation(
  createDevice({ allowSimulation: client.isMock, simulatedQrToken: DEMO_FIXTURES.currentGudangQr }),
  simulation,
);

// Jam server disetel dari serverTime begitu getToday() termuat (lihat useAttendanceToday).
const serverClock = createServerClock(() => device.monotonicMs());

const queue = createOfflineQueue({
  // Kirim ulang lewat endpoint yang sama; flag offline=true membuat server memakai deviceEventTime.
  send: (request) => client.employee.clock(request),
  isOnline: () => device.isOnline(),
  onNetworkChange: (listener) => device.onNetworkChange(listener),
  // Absen offline hanya dikirim dengan sesi pemiliknya (HP bisa dipakai bergantian).
  currentOwner: () => session.getSnapshot().session?.user.employeeId ?? null,
});

// Begitu login berhasil, kirim antrean milik pengguna ini.
session.subscribe(() => {
  if (session.getSnapshot().session) void queue.flush();
});

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Elemen #root tidak ditemukan.');

createRoot(rootElement).render(
  <StrictMode>
    <EmployeeApp client={client} session={session} services={{ device, queue, serverClock, simulation: client.isMock ? simulation : undefined, appVersion: APP_VERSION }} />
  </StrictMode>,
);
