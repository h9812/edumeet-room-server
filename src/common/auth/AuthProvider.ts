export interface DecodedUser {
	uid: string;
	email?: string;
	provider: string;
	role?: string;
}

export interface AuthProvider {
	verify(token: string): Promise<DecodedUser | null>;
}
