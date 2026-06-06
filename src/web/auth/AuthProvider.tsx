import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { client } from '@/web/api/client';

/**
 * The signed-in user as the browser sees it. This is the JSON-serialized
 * `users` row from `GET /api/auth/me` — `createdAt` arrives as an ISO string.
 */
export interface AuthUser {
	/** Account creation time as an ISO 8601 string — the DB `Date` serialized over JSON. */
	createdAt: string;
	/** The sign-in email; unique per account. */
	email: string;
	/** Primary key — matches `users.id` on the backend. */
	id: number;
	/** Authorization level. `'admin'` bypasses the per-row ownership filter on `orders`; `'user'` is scoped to their own rows. Derived server-side from `ADMIN_EMAILS`. */
	role: 'admin' | 'user';
}

interface AuthContextValue {
	/** True while the initial session check (`GET /api/auth/me`) is in flight. */
	isLoading: boolean;
	/** Verifies a magic-link `code` for `email`; resolves on success, throws on a bad code. */
	login: (email: string, code: string) => Promise<void>;
	/** Ends the session server-side and clears local auth state. */
	logout: () => Promise<void>;
	/** The signed-in user, or `null` when unauthenticated. */
	user: AuthUser | null;
}

const AUTH_ME_KEY = ['auth', 'me'] as const;

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provides auth state to the app. The session is determined by calling
 * `GET /api/auth/me`: a `200` yields the user, a `401` yields `null`. `login`
 * and `logout` drive the verify/logout endpoints and update the cached user, so
 * any consumer of {@link useAuth} re-renders with the new state.
 *
 * P6 restyles the consuming Login page but keeps this contract intact.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();

	const sessionQuery = useQuery<AuthUser | null>({
		queryFn: async () => {
			const res = await client.api.auth.me.$get();
			if (!res.ok) return null;
			const body = await res.json();
			return body.user;
		},
		queryKey: AUTH_ME_KEY,
	});

	const loginMutation = useMutation({
		mutationFn: async ({ code, email }: { code: string; email: string }) => {
			const res = await client.api.auth.verify.$post({ json: { code, email } });
			if (!res.ok) {
				throw new Error('That code is incorrect or has expired. Please try again.');
			}
			const body = (await res.json()) as { user: AuthUser };
			return body.user;
		},
		onSuccess: (user) => queryClient.setQueryData(AUTH_ME_KEY, user),
	});

	const logoutMutation = useMutation({
		mutationFn: async () => {
			await client.api.auth.logout.$post();
		},
		onSuccess: () => queryClient.setQueryData(AUTH_ME_KEY, null),
	});

	const value: AuthContextValue = {
		isLoading: sessionQuery.isPending,
		login: async (email, code) => {
			await loginMutation.mutateAsync({ code, email });
		},
		logout: async () => {
			await logoutMutation.mutateAsync();
		},
		user: sessionQuery.data ?? null,
	};

	return <AuthContext value={value}>{children}</AuthContext>;
}

/** Access the auth state. Throws if used outside an {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
	const value = useContext(AuthContext);
	if (!value) throw new Error('useAuth must be used within an <AuthProvider>');
	return value;
}
