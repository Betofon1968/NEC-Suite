import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Locally TMS uses port 5173 and its driver app 5174, so the suite opens on 5175.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/api': 'http://localhost:3002' },
  },
  test: {
    environment: 'node',
  },
});
