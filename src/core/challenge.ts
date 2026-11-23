import { t } from './i18n';
export class VerificationRequired extends Error {
  constructor(public url: string) { super(t('Complete website verification to load the catalogue.')); }
}
export function isChallenge(html: string) {
  return /just a moment|attention required|cf-browser-verification|cf-turnstile|challenge-platform|anubis_challenge|\.within\.website|Защищено Anubis/i.test(html);
}
