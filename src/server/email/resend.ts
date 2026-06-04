import { env } from '@/env';
import { Resend } from 'resend';

const FROM = 'vibe-starter <onboarding@resend.dev>';
const SUBJECT = 'Your sign-in code';

/**
 * Sends a magic-link sign-in code to `email`.
 *
 * Two modes:
 *   - `RESEND_API_KEY` set → send a real email via Resend.
 *   - `RESEND_API_KEY` unset (the dev default) → print the code to the server
 *     console so the flow works locally without a Resend account.
 *
 * Fire-and-forget by contract: a send failure is logged and swallowed (the code
 * is already persisted, so the user can re-request). The caller always treats
 * the request as successful — there is no retry queue (that would prematurely
 * require a job queue; see BACKEND_DESIGN.md).
 *
 * NOTE (logging): uses `console.warn`/`console.error` deliberately — the P9
 * `no-console` lint rule allows only `warn`/`error`, and P8 swaps these for the
 * structured pino logger.
 */
export async function sendMagicCode(email: string, code: string): Promise<void> {
	if (!env.RESEND_API_KEY) {
		// eslint-disable-next-line no-console -- dev fallback; pino arrives in P8.
		console.warn(
			`[auth] magic-link code for ${email}: ${code} (set RESEND_API_KEY to email it)`
		);
		return;
	}

	try {
		const resend = new Resend(env.RESEND_API_KEY);
		const { error } = await resend.emails.send({
			from: FROM,
			subject: SUBJECT,
			text: `Your sign-in code is ${code}. It expires in 10 minutes.`,
			to: email,
		});
		if (error) {
			// eslint-disable-next-line no-console -- structured logging arrives in P8.
			console.error('[auth] failed to send magic-link email', error);
		}
	} catch (err) {
		// eslint-disable-next-line no-console -- structured logging arrives in P8.
		console.error('[auth] failed to send magic-link email', err);
	}
}
