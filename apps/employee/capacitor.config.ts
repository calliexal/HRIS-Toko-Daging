import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.dagingpeople.karyawan',
  appName: 'DagingPeople',
  webDir: 'dist',
  android: {
    // Lalu lintas HTTP polos dilarang; API wajib HTTPS.
    allowMixedContent: false,
  },
};

export default config;
