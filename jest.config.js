// Jest runs the pure auth-flow logic (no React/RN imports) in a plain Node env via ts-jest.
// The module override forces CommonJS so we don't inherit the Expo base tsconfig's ESM/bundler
// settings, which Node can't execute directly.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          types: ['jest'],
        },
      },
    ],
  },
};
