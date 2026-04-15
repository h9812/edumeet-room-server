import { Logger } from 'edumeet-common';
import { AuthProvider, DecodedUser } from './AuthProvider';

const logger = new Logger('AuthManager');

class AuthManager {
	private providers: AuthProvider[] = [];

	register(provider: AuthProvider): void {
		this.providers.push(provider);
		logger.debug('register() [providers: %d]', this.providers.length);
	}

	async verify(token: string): Promise<DecodedUser | null> {
		for (const provider of this.providers) {
			try {
				const decoded = await provider.verify(token);

				if (decoded) return decoded;
			} catch (error) {
				logger.error('verify() provider error [error: %o]', error);
			}
		}

		return null;
	}
}

export const authManager = new AuthManager();
