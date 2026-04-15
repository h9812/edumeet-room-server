export interface DecodedUser {
	uid: string;
	email?: string;
	provider: string;
	role?: string;
}

export interface AuthProvider {
	// eslint-disable-next-line no-unused-vars
	verify(idToken: string): Promise<DecodedUser | null>;
}
