import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMagicCode } from '@/server/email/resend';
import { logger } from '@/server/logger';

// `RESEND_API_KEY` is unset in the test env (`.env.test` omits it), so these
// tests exercise the dev fallback — no network, no Resend client. P8 routes that
// fallback through the structured pino logger, so we assert on `logger.warn`
// (the root logger is `silent` in test, but the method is still invoked).

afterEach(() => {
	vi.restoreAllMocks();
});

describe('sendMagicCode (no RESEND_API_KEY — dev fallback)', () => {
	it('logs the code and email via the pino logger', async () => {
		const warn = vi.spyOn(logger, 'warn');

		await sendMagicCode('person@example.com', '123456');

		expect(warn).toHaveBeenCalledTimes(1);
		const [fields] = warn.mock.calls[0] ?? [];
		expect(fields).toMatchObject({ code: '123456', email: 'person@example.com' });
	});
});
