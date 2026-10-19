/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // The "react-native" entry of lucide-react-native is .mjs, which jest-expo does not transform.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.expo/', '/dist/'],
  // Global Reanimated/worklets mocks (shared components such as ProgressBar animate).
  setupFiles: ['<rootDir>/jest.setup.js'],
};
