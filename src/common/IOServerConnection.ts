import {
	BaseConnection,
	Logger,
	SocketMessage,
	SocketTimeoutError,
	skipIfClosed,
} from 'edumeet-common';
import { Socket } from 'socket.io';

interface ClientServerEvents {
	/* eslint-disable no-unused-vars */
	notification: (notification: SocketMessage) => void;
	request: (request: SocketMessage, result: (
		serverError: unknown | null,
		responseData: unknown) => void
	) => void;
	/* eslint-enable no-unused-vars */
}

interface ServerClientEvents {
	/* eslint-disable no-unused-vars */
	notification: (notification: SocketMessage) => void;
	request: (request: SocketMessage, result: (
		timeout: Error | null,
		serverError: unknown | null,
		responseData: unknown) => void
	) => void;
	/* eslint-enable no-unused-vars */
}

export type clientAddress = {
	address: string
	forwardedFor?: string | string[]
}

const logger = new Logger('SocketIOConnection');

export class IOServerConnection extends BaseConnection {
	public closed = false;
	private socket: Socket<ClientServerEvents, ServerClientEvents>;
	private reconnectTimer?: ReturnType<typeof setTimeout>;

	constructor(socket: Socket<ClientServerEvents, ServerClientEvents>) {
		super();

		logger.debug('constructor()');

		this.socket = socket;
		this.handleSocket();
	}

	@skipIfClosed
	public close(): void {
		logger.debug('close() [id: %s]', this.id);

		this.closed = true;

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}

		if (this.socket.connected)
			this.socket.disconnect(true);

		this.socket.removeAllListeners();

		this.emit('close');
	}

	public cancelClose(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
			logger.debug('cancelClose() reconnect window cancelled [id: %s]', this.id);
		}
	}

	public get id(): string {
		return this.socket.id;
	}

	public get address(): clientAddress {
		const address: clientAddress = {
			address: this.socket.handshake.address,
			forwardedFor: this.socket.handshake.headers['x-forwarded-for']
		};
	
		return address;
	}

	@skipIfClosed
	public notify(notification: SocketMessage): void {
		logger.debug('WS SEND notification [connId: %s, method: %s, payload: %o]', this.id, notification.method, notification.data);

		this.socket.emit('notification', notification);
	}

	@skipIfClosed
	private sendRequestOnWire(socketMessage: SocketMessage): Promise<unknown> {
		logger.debug('WS SEND request [connId: %s, method: %s, payload: %o]', this.id, socketMessage.method, socketMessage.data);

		return new Promise((resolve, reject) => {
			if (!this.socket) {
				reject('No socket connection');
			} else {
				this.socket.timeout(3000).emit('request', socketMessage, (timeout, serverError, response) => {
					if (timeout) {
						logger.warn('WS RECV ack timeout [connId: %s, method: %s]', this.id, socketMessage.method);
						reject(new SocketTimeoutError('Request timed out'));
					} else if (serverError) {
						logger.warn({ connId: this.id, method: socketMessage.method, error: serverError }, 'WS RECV ack error');
						reject(serverError);
					} else {
						logger.debug({ connId: this.id, method: socketMessage.method, response }, 'WS RECV ack success');
						resolve(response);
					}
				});
			}
		});
	}

	@skipIfClosed
	public async request(request: SocketMessage): Promise<unknown> {
		logger.debug('sendRequest() [request: %o]', request);

		for (let tries = 0; tries < 3; tries++) {
			try {
				return await this.sendRequestOnWire(request);
			} catch (error) {
				if (error instanceof SocketTimeoutError)
					logger.warn('sendRequest() timeout, retrying [attempt: %s]', tries);
				else
					throw error;
			}
		}

		// if all attempts failed throw
		throw new SocketTimeoutError('sendRequest() - All attempts of sendRequest timed out');
	}

	private handleSocket(): void {
		logger.debug('handleSocket()');

		this.socket.once('disconnect', (reason: string) => {
			logger.debug('socket disconnected [id: %s, reason: %s]', this.id, reason);

			if (reason === 'client namespace disconnect') {
				// Client intentionally disconnected (leave button, kick, etc.) — close immediately.
				this.close();
			} else {
				// Unintentional disconnect (network drop) — allow reconnect window.
				logger.debug('starting reconnect window [id: %s]', this.id);

				this.reconnectTimer = setTimeout(() => {
					this.reconnectTimer = undefined;
					this.close();
				}, 5_000);
			}
		});

		this.socket.on('notification', (notification) => {
			logger.debug('WS RECV notification [connId: %s, method: %s, payload: %o]', this.id, notification.method, notification.data);

			this.emit('notification', notification);
		});

		this.socket.on('request', (request, result) => {
			logger.debug('WS RECV request [connId: %s, method: %s, payload: %o]', this.id, request.method, request.data);

			this.emit(
				'request',
				request,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(response: any) => {
					logger.debug('WS SEND ack success [connId: %s, method: %s, response: %o]', this.id, request.method, response);
					result(null, response);
				},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(error: any) => {
					logger.warn('WS SEND ack error [connId: %s, method: %s, error: %o]', this.id, request.method, error);
					result(error, null);
				}
			);
		});
	}
}
