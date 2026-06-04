import { client } from '@/web/api/client';
import { useAuth } from '@/web/auth/AuthProvider';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';

/** Where a successful sign-in lands. The public Welcome page stays at `/`. */
const AUTHED_HOME = '/app';

const emailSchema = z.string().email();

// VERBATIM PRD copy — the Login RTL tests assert these exact strings. A later
// phase (P6) restyles this form but MUST preserve them.
const COPY = {
	codeLabel: 'Verification code',
	codePlaceholder: '6-digit code',
	emailLabel: 'Email',
	emailPlaceholder: 'you@example.com',
	invalidCode: 'That code is incorrect or has expired. Please try again.',
	invalidEmail: 'Please enter a valid email address.',
	sendButton: 'Send code',
	title: 'Sign in to vibe-starter',
	verifyButton: 'Sign in',
} as const;

/**
 * Magic-link sign-in page (`/login`).
 *
 * Two steps: request a code for an email, then submit the 6-digit code. A
 * successful verify (via `useAuth().login`) redirects to the authed home;
 * Welcome (`/`) remains public. Intentionally a plain, accessible form — shadcn
 * `Form` + react-hook-form arrive in P6 without changing the copy or flow.
 */
export function Login() {
	const { login } = useAuth();
	const navigate = useNavigate();

	const [step, setStep] = useState<'code' | 'email'>('email');
	const [email, setEmail] = useState('');
	const [code, setCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function handleRequestCode(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		if (!emailSchema.safeParse(email).success) {
			setError(COPY.invalidEmail);
			return;
		}
		setSubmitting(true);
		try {
			await client.api.auth['request-code'].$post({ json: { email } });
			setStep('code');
		} finally {
			setSubmitting(false);
		}
	}

	async function handleVerify(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await login(email, code);
			void navigate(AUTHED_HOME);
		} catch {
			setError(COPY.invalidCode);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<main style={styles.main}>
			<h1 style={styles.heading}>{COPY.title}</h1>

			{step === 'email' ? (
				<form onSubmit={handleRequestCode} style={styles.form} noValidate>
					<label htmlFor="email" style={styles.label}>
						{COPY.emailLabel}
					</label>
					<input
						autoComplete="email"
						id="email"
						name="email"
						onChange={(e) => setEmail(e.target.value)}
						placeholder={COPY.emailPlaceholder}
						style={styles.input}
						type="email"
						value={email}
					/>
					{error ? (
						<p role="alert" style={styles.error}>
							{error}
						</p>
					) : null}
					<button disabled={submitting} style={styles.button} type="submit">
						{COPY.sendButton}
					</button>
				</form>
			) : (
				<form onSubmit={handleVerify} style={styles.form} noValidate>
					<label htmlFor="code" style={styles.label}>
						{COPY.codeLabel}
					</label>
					<input
						autoComplete="one-time-code"
						id="code"
						inputMode="numeric"
						name="code"
						onChange={(e) => setCode(e.target.value)}
						placeholder={COPY.codePlaceholder}
						style={styles.input}
						value={code}
					/>
					{error ? (
						<p role="alert" style={styles.error}>
							{error}
						</p>
					) : null}
					<button disabled={submitting} style={styles.button} type="submit">
						{COPY.verifyButton}
					</button>
				</form>
			)}
		</main>
	);
}

const styles: Record<string, React.CSSProperties> = {
	button: {
		background: '#111827',
		borderRadius: '0.5rem',
		border: 'none',
		color: '#fff',
		cursor: 'pointer',
		padding: '0.5rem 1rem',
	},
	error: {
		color: '#b91c1c',
		fontSize: '0.875rem',
		margin: 0,
	},
	form: {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.75rem',
	},
	heading: {
		fontSize: '1.5rem',
		marginBottom: '1rem',
	},
	input: {
		border: '1px solid #d1d5db',
		borderRadius: '0.375rem',
		fontSize: '1rem',
		padding: '0.5rem',
	},
	label: {
		fontSize: '0.875rem',
		fontWeight: 600,
	},
	main: {
		fontFamily: 'system-ui, sans-serif',
		margin: '0 auto',
		maxWidth: '24rem',
		padding: '3rem 1.5rem',
	},
};
