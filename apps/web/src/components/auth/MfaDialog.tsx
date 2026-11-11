'use client';

import { ArrowLeft, KeyRound, LogOut, Mail, MessageSquare, RotateCw, ShieldCheck } from 'lucide-react';
import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Field, Input } from '@/components/ui/Field';
import { api, logout, setMfaHandler } from '@/lib/api';
import { ApiError } from '@/lib/apiError';
import { CODE_LENGTH, type CodeChannel, type CodeOptions, RESEND_SECONDS, codeOptions, normalizeCode, sendCode, verifyCode } from '@/lib/mfaCodes';
import { addPasskey, cancelled, passkeysSupported, stepUpWithPasskey } from '@/lib/passkeys';
import { PasskeyIcon } from './PasskeyIcon';

type Step = 'start' | 'channel' | 'code';
type Sent = { channel: CodeChannel; destination: string };

/**
 * "Confirm it's you": the organization requires a second factor for this account. With a passkey
 * on file, use it; otherwise set one up on this device. Or, where the organization allows it, a
 * 6-digit code by email or text. The request that needed it then carries on by itself.
 */
export function MfaDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [options, setOptions] = useState<CodeOptions | null>(null);
  const [step, setStep] = useState<Step>('start');
  const [sent, setSent] = useState<Sent | null>(null);
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState<'passkey' | CodeChannel | 'verify' | 'resend' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const firstChannel = useRef<HTMLButtonElement>(null);
  const codeButton = useRef<HTMLButtonElement>(null);
  const lastStep = useRef<Step>('start');
  const supported = passkeysSupported();
  const channels = options?.codes ? options.channels : [];

  useEffect(() => {
    setMfaHandler(
      () =>
        new Promise<boolean>((resolve) => {
          resolver.current = resolve;
          setError(null);
          setHasPasskey(null);
          setOptions(null);
          setStep('start');
          setSent(null);
          setCode('');
          setOpen(true);
          api<unknown[]>('/api/me/passkeys')
            .then((l) => setHasPasskey(l.length > 0))
            .catch(() => setHasPasskey(false));
          codeOptions()
            .then(setOptions)
            .catch(() => setOptions({ codes: false, channels: [] }));
        }),
    );
    return () => setMfaHandler(null);
  }, []);

  // "Send a new code" opens up after 30 seconds.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  // Keyboard and screen-reader users land where the next step starts.
  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
    if (step === 'channel') firstChannel.current?.focus();
    if (step === 'start' && lastStep.current !== 'start') codeButton.current?.focus();
    lastStep.current = step;
  }, [step]);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const message = (e: unknown) => {
    if (!(e instanceof ApiError)) return t('common.error');
    if (e.code === 'MFA_CODE_WRONG') {
      const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
      return left ? t('mfa.codeErrors.MFA_CODE_WRONG_left', { count: left }) : t('mfa.codeErrors.MFA_CODE_WRONG');
    }
    return t(`mfa.codeErrors.${e.code}`, { defaultValue: t(`errors.${e.code}`, { defaultValue: e.message }) });
  };

  async function withPasskey() {
    setBusy('passkey');
    setError(null);
    try {
      if (hasPasskey) await stepUpWithPasskey();
      else await addPasskey();
      finish(true);
    } catch (e) {
      if (!cancelled(e)) setError(e instanceof ApiError ? t(`errors.${e.code}`, { defaultValue: e.message }) : t('passkeys.failed'));
    } finally {
      setBusy(null);
    }
  }

  async function send(channel: CodeChannel, again = false) {
    setBusy(again ? 'resend' : channel);
    setError(null);
    try {
      const r = await sendCode(channel);
      setSent({ channel, destination: r.destination });
      setCode('');
      setWait(r.resendAfterSeconds ?? RESEND_SECONDS);
      setStep('code');
      if (again) codeInput.current?.focus();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function verify(value: string) {
    if (value.length !== CODE_LENGTH || busy === 'verify') return;
    setBusy('verify');
    setError(null);
    try {
      await verifyCode(value);
      finish(true);
    } catch (e) {
      setError(message(e));
      // A dead code can't be retried: clear it so the next step is asking for a new one.
      if (e instanceof ApiError && e.code !== 'MFA_CODE_WRONG') setCode('');
      codeInput.current?.select();
    } finally {
      setBusy(null);
    }
  }

  function onCode(raw: string) {
    const v = normalizeCode(raw);
    setCode(v);
    if (v.length === CODE_LENGTH) void verify(v);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    onCode(e.clipboardData.getData('text'));
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void verify(code);
  }

  function back() {
    setError(null);
    setStep(step === 'code' && channels.length > 1 ? 'channel' : 'start');
  }

  async function signOut() {
    finish(false);
    await logout();
    window.location.assign('/login');
  }

  const channelIcon = (c: CodeChannel) => (c === 'sms' ? <MessageSquare className="h-5 w-5" aria-hidden="true" /> : <Mail className="h-5 w-5" aria-hidden="true" />);
  const loading = hasPasskey === null || options === null;

  return (
    <Dialog open={open} onClose={() => finish(false)} title={t(channels.length ? 'mfa.titleWithCodes' : 'mfa.title')} description={t(channels.length ? 'mfa.helpWithCodes' : 'mfa.help')} closeLabel={t('common.cancel')}>
      <div className="grid gap-4">
        {loading ? null : step === 'start' ? (
          <>
            {!supported ? (
              <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{t(channels.length ? 'mfa.unsupportedUseCode' : 'mfa.unsupported')}</p>
            ) : (
              <>
                {!hasPasskey ? <p className="text-small text-muted">{t('mfa.setUpHelp')}</p> : null}
                <Button size="lg" block icon={hasPasskey ? <PasskeyIcon /> : <KeyRound className="h-5 w-5" aria-hidden="true" />} loading={busy === 'passkey'} onClick={() => void withPasskey()}>
                  {hasPasskey ? t('mfa.use') : t('mfa.setUp')}
                </Button>
              </>
            )}
            {channels.length ? (
              <Button ref={codeButton} size="lg" variant={supported ? 'secondary' : 'primary'} block icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />} onClick={() => { setError(null); setStep('channel'); }}>
                {t('mfa.sendCode')}
              </Button>
            ) : null}
          </>
        ) : step === 'channel' ? (
          <div role="group" aria-labelledby="mfa-channel-label" className="grid gap-3">
            <p id="mfa-channel-label" className="text-body-strong">{t('mfa.chooseChannel')}</p>
            {channels.map((c, i) => (
              <Button
                key={c.channel}
                ref={i === 0 ? firstChannel : undefined}
                size="lg"
                variant="secondary"
                block
                className="h-auto min-h-[3.25rem] whitespace-normal py-3 text-left"
                icon={channelIcon(c.channel)}
                loading={busy === c.channel}
                disabled={busy !== null && busy !== c.channel}
                onClick={() => void send(c.channel)}
              >
                <span className="grid">
                  <span>{t(c.channel === 'sms' ? 'mfa.bySms' : 'mfa.byEmail')}</span>
                  <span className="text-small font-normal text-muted">{c.destination}</span>
                </span>
              </Button>
            ))}
            <Button variant="ghost" block icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />} onClick={back}>
              {t('mfa.otherWay')}
            </Button>
          </div>
        ) : (
          <form className="grid gap-3" onSubmit={submit} noValidate>
            <p className="text-small text-muted">{t(sent?.channel === 'sms' ? 'mfa.sentSms' : 'mfa.sentEmail', { destination: sent?.destination ?? '', minutes: options?.expiresInMinutes ?? 10 })}</p>
            <Field label={t('mfa.codeLabel')} hint={t('mfa.codeHint')} error={error}>
              {(p) => (
                <Input
                  {...p}
                  ref={codeInput}
                  name="code"
                  value={code}
                  onChange={(e) => onCode(e.target.value)}
                  onPaste={onPaste}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={CODE_LENGTH + 2}
                  enterKeyHint="done"
                  className="w-48 text-center font-mono text-[1.375rem] tracking-[0.35em]"
                />
              )}
            </Field>
            <Button type="submit" size="lg" block icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />} loading={busy === 'verify'} disabled={code.length !== CODE_LENGTH}>
              {t('mfa.confirmCode')}
            </Button>
            <Button variant="secondary" block icon={<RotateCw className="h-4 w-4" aria-hidden="true" />} loading={busy === 'resend'} disabled={wait > 0 || busy !== null} onClick={() => sent && void send(sent.channel, true)}>
              {wait > 0 ? t('mfa.resendIn', { count: wait }) : t('mfa.resend')}
            </Button>
            <Button variant="ghost" block icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />} onClick={back}>
              {t('mfa.otherWay')}
            </Button>
          </form>
        )}
        <Button variant="ghost" block icon={<LogOut className="h-4 w-4" aria-hidden="true" />} onClick={() => void signOut()}>
          {t('mfa.signOut')}
        </Button>
        <div aria-live="polite">{error && step !== 'code' ? <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">{error}</p> : null}</div>
      </div>
    </Dialog>
  );
}
