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

		if (this.socket.connected)
			this.socket.disconnect(true);

		this.socket.removeAllListeners();

		this.emit('close');
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
		logger.debug(
			{
				socketId: this.id,
				event: 'notification',
				direction: 'outbound',
				data: notification
			},
			'notify()'
		);

		this.socket.emit('notification', notification);
	}

	@skipIfClosed
	private sendRequestOnWire(socketMessage: SocketMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.socket) {
				reject('No socket connection');
			} else {
				logger.debug(
					{
						socketId: this.id,
						event: 'request',
						direction: 'outbound',
						data: socketMessage
					},
					'sendRequestOnWire() emit request'
				);

				this.socket.timeout(3000).emit('request', socketMessage, (timeout, serverError, response) => {
					if (timeout) {
						logger.warn(
							{
								socketId: this.id,
								event: 'request',
								direction: 'outbound',
								data: socketMessage
							},
							'sendRequestOnWire() timeout'
						);
						reject(new SocketTimeoutError('Request timed out'));
					} else if (serverError) {
						logger.warn(
							{
								socketId: this.id,
								event: 'request',
								direction: 'outbound',
								data: socketMessage,
								serverError
							},
							'sendRequestOnWire() serverError'
						);
						reject(serverError);
					} else {
						logger.debug(
							{
								socketId: this.id,
								event: 'request',
								direction: 'outbound',
								data: socketMessage,
								response
							},
							'sendRequestOnWire() success'
						);
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
	}

	private handleSocket(): void {
		logger.debug('handleSocket()');

		// TODO: reconnect logic here
		this.socket.once('disconnect', () => {
			logger.debug(
				{
					socketId: this.id,
					event: 'disconnect'
				},
				'socket disconnected'
			);

			this.close();
		});

		this.socket.on('notification', (notification) => {
			logger.debug(
				{
					socketId: this.id,
					event: 'notification',
					direction: 'inbound',
					data: notification
				},
				'handleSocket() notification'
			);

			this.emit('notification', notification);
		});

		this.socket.on('request', (request, result) => {
			logger.debug(
				{
					socketId: this.id,
					event: 'request',
					direction: 'inbound',
					data: request
				},
				'handleSocket() request'
			);

			this.emit(
				'request',
				request,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(response: any) => {
					logger.debug(
						{
							socketId: this.id,
							event: 'request',
							direction: 'inbound',
							data: request,
							response
						},
						'handleSocket() request ack success'
					);
					result(null, response);
				},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(error: any) => {
					logger.warn(
						{
							socketId: this.id,
							event: 'request',
							direction: 'inbound',
							data: request,
							error
						},
						'handleSocket() request ack error'
					);
					result(error, null);
				}
			);
		});
	}
}
