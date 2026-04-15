import express from 'express';
import cors from 'cors';
import { Logger } from 'edumeet-common';
import { authManager } from './AuthManager';
import { FirebaseAuthProvider } from './providers/FirebaseAuthProvider';
import { Config } from '../../Config';

const logger = new Logger('authRouter');

export const createAuthRouter = (config: Config): express.Router => {
	const router = express.Router();

	const corsOptions: cors.CorsOptions = {
		origin: config.baseFEOrigin || '*',
		methods: [ 'POST' ],
	};

	router.use(express.json());

	router.post('/auth/token',
		cors(corsOptions),
		async (req: express.Request, res: express.Response) => {
			const idToken = (req.headers.authorization ?? '').replace('Bearer ', '');

			if (!idToken) {
				res.status(401).json({ error: 'Missing token' });

				return;
			}

			const decoded = await authManager.verify(idToken);

			if (!decoded) {
				res.status(401).json({ error: 'Invalid token' });

				return;
			}

			logger.debug('POST /auth/token [uid: %s]', decoded.uid);

			const providers = authManager['providers'];
			const firebaseProvider = providers.find(
				(p) => p instanceof FirebaseAuthProvider
			) as FirebaseAuthProvider | undefined;

			if (!firebaseProvider) {
				res.status(500).json({ error: 'Firebase provider not configured' });

				return;
			}

			try {
				const customToken = await firebaseProvider.createCustomToken(decoded.uid, {
					email: decoded.email,
					provider: decoded.provider,
				});

				res.json({ customToken });
			} catch (error) {
				logger.error('POST /auth/token createCustomToken error [error: %o]', error);
				res.status(500).json({ error: 'Failed to create custom token' });
			}
		}
	);

	router.options('/auth/token', cors(corsOptions));

	return router;
};
