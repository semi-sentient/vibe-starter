import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { client } from '@/web/api/client';
import { useAuth } from '@/web/auth/AuthProvider';
import { Button } from '@/web/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/web/components/ui/card';
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from '@/web/components/ui/form';
import { Input } from '@/web/components/ui/input';

/** Where a successful sign-in lands. The public Welcome page stays at `/`. */
const AUTHED_HOME = '/app';

// VERBATIM PRD copy — the Login RTL tests assert these exact strings. The shadcn
// `Form` restyle (P6) preserves them.
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

// Client schemas mirror the backend `zValidator` shapes in
// `src/server/routes/auth.routes.ts` (`{ email }` and `{ email, code }`); the
// custom message drives the exact validation copy the form shows.
const emailSchema = z.object({
	email: z.string().email({ message: COPY.invalidEmail }),
});
type EmailValues = z.infer<typeof emailSchema>;

const codeSchema = z.object({
	code: z.string(),
});
type CodeValues = z.infer<typeof codeSchema>;

/**
 * Magic-link sign-in page (`/login`).
 *
 * Two steps: request a code for an email, then submit the 6-digit code. A
 * successful verify (via `useAuth().login`) redirects to the authed home;
 * Welcome (`/`) remains public. Built on shadcn `Form` + react-hook-form + zod,
 * with the same copy and flow as before.
 */
export function Login() {
	const { login } = useAuth();
	const navigate = useNavigate();

	const [step, setStep] = useState<'code' | 'email'>('email');
	const [email, setEmail] = useState('');

	async function handleRequestCode(values: EmailValues) {
		await client.api.auth['request-code'].$post({ json: { email: values.email } });
		setEmail(values.email);
		setStep('code');
	}

	async function handleVerify(values: CodeValues) {
		await login(email, values.code);
		void navigate(AUTHED_HOME);
	}

	return (
		<main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
			<Card>
				<CardHeader>
					<h1 className="text-xl leading-none font-semibold">{COPY.title}</h1>
					<CardDescription>
						{step === 'email'
							? 'Enter your email and we’ll send you a sign-in code.'
							: `We sent a code to ${email}. Enter it below to sign in.`}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{step === 'email' ? (
						<EmailStep onSubmit={handleRequestCode} />
					) : (
						<CodeStep onSubmit={handleVerify} />
					)}
				</CardContent>
			</Card>
		</main>
	);
}

/** Step 1: collect + validate the email, then request a code. */
function EmailStep({ onSubmit }: { onSubmit: (values: EmailValues) => Promise<void> }) {
	const form = useForm<EmailValues>({
		defaultValues: { email: '' },
		resolver: zodResolver(emailSchema),
	});

	return (
		<Form {...form}>
			<form
				className="flex flex-col gap-4"
				noValidate
				onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
			>
				<FormField
					control={form.control}
					name="email"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{COPY.emailLabel}</FormLabel>
							<FormControl>
								<Input
									autoComplete="email"
									placeholder={COPY.emailPlaceholder}
									type="email"
									{...field}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<Button disabled={form.formState.isSubmitting} type="submit">
					{COPY.sendButton}
				</Button>
			</form>
		</Form>
	);
}

/** Step 2: collect the code and verify it; a server rejection shows on the field. */
function CodeStep({ onSubmit }: { onSubmit: (values: CodeValues) => Promise<void> }) {
	const form = useForm<CodeValues>({
		defaultValues: { code: '' },
		resolver: zodResolver(codeSchema),
	});

	async function handle(values: CodeValues) {
		try {
			await onSubmit(values);
		} catch {
			form.setError('code', { message: COPY.invalidCode, type: 'server' });
		}
	}

	return (
		<Form {...form}>
			<form
				className="flex flex-col gap-4"
				noValidate
				onSubmit={(e) => void form.handleSubmit(handle)(e)}
			>
				<FormField
					control={form.control}
					name="code"
					render={({ field }) => (
						<FormItem>
							<FormLabel>{COPY.codeLabel}</FormLabel>
							<FormControl>
								<Input
									autoComplete="one-time-code"
									inputMode="numeric"
									placeholder={COPY.codePlaceholder}
									{...field}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<Button disabled={form.formState.isSubmitting} type="submit">
					{COPY.verifyButton}
				</Button>
			</form>
		</Form>
	);
}
