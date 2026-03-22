import { Socket } from 'socket.io';
import { IOServerConnection, Logger } from 'edumeet-common';

const logger = new Logger('socketHandler');

export const socketHandler = (socket: Socket) => {
	const {
		roomId,
		peerId,
		displayName,
		token,
	} = socket.handshake.query;

	logger.debug(
		'socket connection [socketId: %s, roomId: %s, peerId: %s, query: %o]',
		socket.id,
		roomId,
		peerId,
		socket.handshake.query
	);

	const normalizeArgs = (args: unknown[]): unknown[] =>
		args.map((arg) => {
			if (typeof arg === 'function')
				return '[Function]';

			return arg;
		});

	socket.onAny((event, ...args) => {
		logger.debug(
			'websocket event received [socketId: %s, event: %s, query: %o, data: %o]',
			socket.id,
			event,
			socket.handshake.query,
			normalizeArgs(args)
		);
	});

	if (typeof socket.onAnyOutgoing === 'function') {
		socket.onAnyOutgoing((event, ...args) => {
			logger.debug(
				'websocket event sent [socketId: %s, event: %s, query: %o, data: %o]',
				socket.id,
				event,
				socket.handshake.query,
				normalizeArgs(args)
			);
		});
	}

	if (!roomId || !peerId) {
		logger.warn('socket invalid roomId or peerId');

		return socket.disconnect(true);
	}

	const socketConnection = new IOServerConnection(socket);

	try {
		serverManager.handleConnection(
			socketConnection,
			peerId as string,
			(roomId as string).toLowerCase(),
			displayName as string,
			token as string,
		);
	} catch (error) {
		logger.warn('handleConnection() [error: %o]', error);

		socketConnection.close();
	}
};