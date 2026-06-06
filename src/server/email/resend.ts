import { Resend } from 'resend';
import { env } from '@/env';
import { logger } from '@/server/logger';

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
 * require a job queue; see docs/design/BACKEND_DESIGN.md).
 *
 * Logging goes through the structured pino logger (P8). The dev fallback logs the
 * code at `warn` (it is deliberately visible so local auth works without Resend);
 * send failures log at `error`. Email addresses are included as operational
 * context — acceptable for this self-hosted starter's own logs.
 */
export async function sendMagicCode(email: string, code: string): Promise<void> {
	if (!env.RESEND_API_KEY) {
		logger.warn(
			{ code, email },
			'magic-link code (dev fallback — set RESEND_API_KEY to email it)'
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
			logger.error({ email, err: error }, 'failed to send magic-link email');
		}
	} catch (err) {
		logger.error({ email, err }, 'failed to send magic-link email');
	}
}
