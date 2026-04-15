import { Socket } from 'socket.io';
import { IOServerConnection, Logger } from 'edumeet-common';
import { authManager } from './auth/AuthManager';
import { userRoles } from './authorization';
import { Config } from '../Config';

const logger = new Logger('socketHandler');

export const createSocketHandler = (config: Config) => async (socket: Socket) => {
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

	const authToken = socket.handshake.query['authToken'] as string | undefined;
	const loginRequired = config.firebase?.loginRequired ?? false;
	let authenticatedRoles: number[] | undefined;

	if (authToken) {
		const decoded = await authManager.verify(authToken);

		if (decoded) {
			logger.debug('socket authenticated [uid: %s, peerId: %s]', decoded.uid, peerId);
			authenticatedRoles = [ userRoles.AUTHENTICATED.id ];

			if (decoded.role === 'admin') authenticatedRoles.push(userRoles.ADMIN.id);
			if (decoded.role === 'moderator') authenticatedRoles.push(userRoles.MODERATOR.id);
		} else if (loginRequired) {
			logger.warn('socket auth failed, loginRequired=true, disconnecting [peerId: %s]', peerId);
			socket.disconnect(true);

			return;
		}
	} else if (loginRequired) {
		logger.warn('socket no authToken, loginRequired=true, disconnecting [peerId: %s]', peerId);
		socket.disconnect(true);

		return;
	}

	const socketConnection = new IOServerConnection(socket);

	try {
		const peer = serverManager.handleConnection(
			socketConnection,
			peerId as string,
			(roomId as string).toLowerCase(),
			displayName as string,
			token as string,
		);

		if (authenticatedRoles && peer) {
			for (const roleId of authenticatedRoles) {
				const role = Object.values(userRoles).find((r) => r.id === roleId);

				if (role) peer.addRole(role);
			}
		}
	} catch (error) {
		logger.warn('handleConnection() [error: %o]', error);

		socketConnection.close();
	}
};