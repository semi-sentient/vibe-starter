import { sendMagicCode } from '@/server/email/resend';
import { afterEach, describe, expect, it, vi } from 'vitest';

// `RESEND_API_KEY` is unset in the test env (`.env.test` omits it), so these
// tests exercise the dev console fallback — no network, no Resend client.

afterEach(() => {
	vi.restoreAllMocks();
});

describe('sendMagicCode (no RESEND_API_KEY — dev fallback)', () => {
	it('logs the code to the console via console.warn', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await sendMagicCode('person@example.com', '123456');

		expect(warn).toHaveBeenCalledTimes(1);
		const message = warn.mock.calls[0]?.join(' ') ?? '';
		expect(message).toContain('123456');
		expect(message).toContain('person@example.com');
	});
});
