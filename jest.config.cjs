module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }]
  },
  moduleFileExtensions: ['ts','js','json'],
  extensionsToTreatAsEsm: ['.ts']
};
