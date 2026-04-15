process.title = 'edumeet-room-server';

import config from '../config/config.json';
import express from 'express';
import fs from 'fs';
import https from 'https';
import http from 'http';
import ServerManager from './ServerManager';
import { Server as IOServer } from 'socket.io';
import { interactiveServer } from './interactiveServer';
import { Logger, KDTree, KDPoint } from 'edumeet-common';
import MediaService from './MediaService';
import { createSocketHandler } from './common/socketHandler';
import LoadBalancer from './LoadBalancer';
import { Config } from './Config';
import { authManager } from './common/auth/AuthManager';
import { FirebaseAuthProvider } from './common/auth/providers/FirebaseAuthProvider';
import { createAuthRouter } from './common/auth/authRouter';

const actualConfig = config as Config;

const logger = new Logger('Server');

logger.debug('Starting...');

if (actualConfig.firebase?.serviceAccountPath) {
	try {
		authManager.register(new FirebaseAuthProvider(actualConfig.firebase.serviceAccountPath));
		logger.debug('Firebase auth provider registered');
	} catch (error) {
		logger.error('Failed to initialize Firebase auth provider [error: %o]', error);
	}
}

const defaultClientPosition = new KDPoint(
	[ actualConfig.mediaNodes[0].latitude,
		actualConfig.mediaNodes[0].longitude ]
);
const kdTree = new KDTree([]);
const loadBalancer = new LoadBalancer({ kdTree, defaultClientPosition });
const mediaService = MediaService.create(loadBalancer, kdTree, actualConfig);
const serverManager = new ServerManager({ mediaService });

interactiveServer(serverManager);

const app = express();

app.use(createAuthRouter(actualConfig));

let webServer: http.Server | https.Server;

if (actualConfig.tls?.cert && actualConfig.tls?.key) {
	webServer = https.createServer({
		cert: fs.readFileSync(actualConfig.tls.cert),
		key: fs.readFileSync(actualConfig.tls.key),
		minVersion: 'TLSv1.2',
		ciphers: [
			'ECDHE-ECDSA-AES128-GCM-SHA256',
			'ECDHE-RSA-AES128-GCM-SHA256',
			'ECDHE-ECDSA-AES256-GCM-SHA384',
			'ECDHE-RSA-AES256-GCM-SHA384',
			'ECDHE-ECDSA-CHACHA20-POLY1305',
			'ECDHE-RSA-CHACHA20-POLY1305',
			'DHE-RSA-AES128-GCM-SHA256',
			'DHE-RSA-AES256-GCM-SHA384'
		].join(':'),
		honorCipherOrder: true
	}, app);
} else {
	logger.debug('No TLS certificate or key provided, using HTTP');

	webServer = http.createServer(app);
}

webServer.listen({ port: actualConfig.listenPort, host: actualConfig.listenHost }, () =>
	logger.debug('webServer.listen() [port: %s]', actualConfig.listenPort));

const socketServer = new IOServer(webServer, {
	cors: { origin: '*' },
	cookie: false
});

const socketHandler = createSocketHandler(actualConfig);

socketServer.on('connection', socketHandler);

let httpApiServer: http.Server | undefined;

if (actualConfig.httpApiPort && actualConfig.tls?.cert) {
	httpApiServer = http.createServer(app);
	httpApiServer.listen(
		{ port: actualConfig.httpApiPort, host: actualConfig.listenHost },
		() => logger.debug('httpApiServer.listen() [port: %s]', actualConfig.httpApiPort)
	);
}

const close = () => {
	logger.debug('close()');

	serverManager.close();
	webServer.close();
	httpApiServer?.close();

	process.exit(0);
};

process.once('SIGINT', close);
process.once('SIGQUIT', close);
process.once('SIGTERM', close);

logger.debug('Started!');