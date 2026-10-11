import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Gerçek motor testleri ağır; dosyalar paralel çalışsın ama her dosya kendi motorunu kullanır.
    testTimeout: 30000,
  },
});
