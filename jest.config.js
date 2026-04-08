module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src'],
	testMatch: ['**/__tests__/**/*.test.ts'],
	moduleNameMapper: {
		'^api$': '<rootDir>/api/index.ts',
		'^api/(.*)$': '<rootDir>/api/$1',
	},
};
