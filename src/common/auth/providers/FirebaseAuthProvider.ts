import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from 'edumeet-common';
import { AuthProvider, DecodedUser } from '../AuthProvider';

const logger = new Logger('FirebaseAuthProvider');

export class FirebaseAuthProvider implements AuthProvider {
	constructor(serviceAccountPath: string) {
		const resolvedPath = path.resolve(serviceAccountPath);

		if (!fs.existsSync(resolvedPath)) {
			throw new Error(`Firebase service account file not found: ${resolvedPath}`);
		}

		const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));

		admin.initializeApp({
			credential: admin.credential.cert(serviceAccount),
		});

		logger.debug('constructor() Firebase Admin initialized');
	}

	async verify(token: string): Promise<DecodedUser | null> {
		try {
			const decoded = await admin.auth().verifyIdToken(token);

			return {
				uid: decoded.uid,
				email: decoded.email,
				provider: 'firebase',
				role: decoded.role as string | undefined,
			};
		} catch {
			return null;
		}
	}

	async createCustomToken(uid: string, claims?: Record<string, unknown>): Promise<string> {
		return admin.auth().createCustomToken(uid, claims);
	}
}
