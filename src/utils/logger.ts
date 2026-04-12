import Logger, { TargetType, LogLevel } from '@joplin/utils/Logger';

const PREFIX = 'AIAssistant';

const joplinLogger = new Logger();
joplinLogger.addTarget(TargetType.Console);
joplinLogger.setLevel(LogLevel.Debug);

const logger = {
	debug: (...args: unknown[]): void => joplinLogger.log(LogLevel.Debug, PREFIX, ...args),
	info: (...args: unknown[]): void => joplinLogger.log(LogLevel.Info, PREFIX, ...args),
	warn: (...args: unknown[]): void => joplinLogger.log(LogLevel.Warn, PREFIX, ...args),
	error: (...args: unknown[]): void => joplinLogger.log(LogLevel.Error, PREFIX, ...args),
	setLevel: (level: LogLevel): void => {
		joplinLogger.setLevel(level);
	},
	getLevel: (): LogLevel => joplinLogger.level(),
};

export { LogLevel };
export default logger;
