import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'in.shivhardware.panel',
  appName: 'Shiv Hardware Panel',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    loggingBehavior: 'none',
  },
}

export default config
