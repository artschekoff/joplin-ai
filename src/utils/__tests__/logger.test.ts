import logger, { LogLevel } from '../logger';

const logSpy = jest.spyOn(console, 'log').mockImplementation();
const infoSpy = jest.spyOn(console, 'info').mockImplementation();
const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
const errorSpy = jest.spyOn(console, 'error').mockImplementation();

beforeEach(() => {
	logSpy.mockClear();
	infoSpy.mockClear();
	warnSpy.mockClear();
	errorSpy.mockClear();
	logger.setLevel(LogLevel.Debug);
});

afterAll(() => {
	logSpy.mockRestore();
	infoSpy.mockRestore();
	warnSpy.mockRestore();
	errorSpy.mockRestore();
});

describe('logger', () => {
	it('formats messages with timestamp and AIAssistant prefix', () => {
		logger.info('test info');

		expect(infoSpy).toHaveBeenCalledTimes(1);
		const output = infoSpy.mock.calls[0][0] as string;
		expect(output).toMatch(/^\d{2}:\d{2}:\d{2}: AIAssistant:/);
	});

	it('routes debug to console.log', () => {
		logger.debug('debug msg');
		expect(logSpy).toHaveBeenCalledTimes(1);
	});

	it('routes info to console.info', () => {
		logger.info('info msg');
		expect(infoSpy).toHaveBeenCalledTimes(1);
	});

	it('routes warn to console.warn', () => {
		logger.warn('warn msg');
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it('routes error to console.error', () => {
		logger.error('error msg');
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it('includes message content in output', () => {
		logger.warn('retry attempt failed');
		const output = warnSpy.mock.calls[0].join(' ');
		expect(output).toContain('retry attempt failed');
	});

	it('suppresses debug when level is Info', () => {
		logger.setLevel(LogLevel.Info);

		logger.debug('hidden');
		logger.info('visible');

		expect(logSpy).not.toHaveBeenCalled();
		expect(infoSpy).toHaveBeenCalledTimes(1);
	});

	it('suppresses debug and info when level is Warn', () => {
		logger.setLevel(LogLevel.Warn);

		logger.debug('hidden');
		logger.info('hidden');
		logger.warn('visible');
		logger.error('visible');

		expect(logSpy).not.toHaveBeenCalled();
		expect(infoSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it('suppresses everything below Error when level is Error', () => {
		logger.setLevel(LogLevel.Error);

		logger.debug('hidden');
		logger.info('hidden');
		logger.warn('hidden');
		logger.error('visible');

		expect(logSpy).not.toHaveBeenCalled();
		expect(infoSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it('suppresses all output when level is None', () => {
		logger.setLevel(LogLevel.None);

		logger.debug('hidden');
		logger.info('hidden');
		logger.warn('hidden');
		logger.error('hidden');

		expect(logSpy).not.toHaveBeenCalled();
		expect(infoSpy).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('getLevel returns the current level', () => {
		logger.setLevel(LogLevel.Warn);
		expect(logger.getLevel()).toBe(LogLevel.Warn);
	});
});
