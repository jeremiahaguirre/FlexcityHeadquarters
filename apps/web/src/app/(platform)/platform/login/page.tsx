"use client";

import { KeyRound, LogIn, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/Logo";
import { AuthLanguageSwitch } from "@/components/shell/AuthLanguageSwitch";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ApiError } from "@/lib/apiError";
import { DEMO, DEMO_PASSWORD } from "@/lib/demo";
import { papi } from "@/lib/platform";
import { OFFER_FLAG } from "@/components/auth/PasskeyPrompt";
import { PasskeyIcon } from "@/components/auth/PasskeyIcon";
import { Copyright } from "@/components/Copyright";
import {
  cancelled,
  passkeysSupported,
  platformAddPasskey,
  platformConfirmWithPasskey,
  platformSignInWithPasskey,
} from "@/lib/passkeys";

/** Dev console sign-in. A password is never enough: a passkey is required as the second step, and one is set up on first sign-in. */
export default function PlatformLogin() {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [canPasskey, setCanPasskey] = useState(false);
  /** After the password: the second factor, with the passkey on file or a new one. */
  const [second, setSecond] = useState<{ hasPasskey: boolean } | null>(null);
  useEffect(() => setCanPasskey(passkeysSupported()), []);
  // Came back mid-sign-in (reload, or a screen asked for the passkey step).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("step") !== "passkey")
      return;
    papi<{ mfaRequired: boolean; hasPasskey: boolean }>("/me")
      .then((me) =>
        me.mfaRequired
          ? setSecond({ hasPasskey: me.hasPasskey })
          : router.replace("/platform"),
      )
      .catch(() => undefined);
  }, [router]);
  // The marketing site links straight into the console: /platform/login?demo=1.
  useEffect(() => {
    if (DEMO && new URLSearchParams(window.location.search).get("demo") === "1")
      void signIn("dev@flexcity.dev", DEMO_PASSWORD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(email: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await papi<{ mfaRequired?: boolean; hasPasskey?: boolean }>(
        "/auth/login",
        { method: "POST", body: { email, password } },
      );
      if (r.mfaRequired) {
        setSecond({ hasPasskey: !!r.hasPasskey });
        return;
      }
      try {
        sessionStorage.setItem(OFFER_FLAG, "1");
      } catch {
        /* storage blocked */
      }
      router.replace("/platform");
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 401
          ? t("platform.invalid")
          : e instanceof ApiError && e.status === 423
            ? t("platform.locked")
            : e instanceof ApiError && e.status === 429
              ? t("login.tooMany")
              : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      await platformSignInWithPasskey();
      router.replace("/platform");
    } catch (e) {
      if (!cancelled(e))
        setError(
          e instanceof ApiError && e.code === "PASSKEY_UNKNOWN"
            ? t("passkeys.unknown")
            : t("passkeys.failed"),
        );
    } finally {
      setBusy(false);
    }
  }

  async function secondFactor() {
    setBusy(true);
    setError(null);
    try {
      if (second?.hasPasskey) await platformConfirmWithPasskey();
      else await platformAddPasskey();
      router.replace("/platform");
    } catch (e) {
      if (!cancelled(e))
        setError(
          e instanceof ApiError &&
            e.status === 401 &&
            e.code !== "PASSKEY_FAILED"
            ? t("platform.mfaExpired")
            : t("passkeys.failed"),
        );
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void signIn(String(f.get("email")), String(f.get("password")));
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-page px-6 py-16">
      <div className="absolute right-4 top-4">
        <AuthLanguageSwitch />
      </div>
      <main id="main" className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo variant="stacked" size={80} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-caption font-semibold text-page">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            {t("platform.badge")}
          </span>
        </div>
        {second ? (
          <section aria-labelledby="mfa-title">
            <h1 id="mfa-title" className="text-title">
              {t(
                second.hasPasskey
                  ? "platform.mfaTitle"
                  : "platform.mfaSetUpTitle",
              )}
            </h1>
            <p className="mt-2 text-body text-muted">
              {t(
                second.hasPasskey
                  ? "platform.mfaHelp"
                  : "platform.mfaSetUpHelp",
              )}
            </p>
            <div className="mt-8 grid gap-4">
              {canPasskey ? (
                <Button
                  size="lg"
                  block
                  loading={busy}
                  icon={
                    second.hasPasskey ? (
                      <PasskeyIcon />
                    ) : (
                      <KeyRound className="h-5 w-5" aria-hidden="true" />
                    )
                  }
                  onClick={() => void secondFactor()}
                >
                  {t(
                    second.hasPasskey ? "platform.mfaUse" : "platform.mfaSetUp",
                  )}
                </Button>
              ) : (
                <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">
                  {t("mfa.unsupported")}
                </p>
              )}
              <div aria-live="polite">
                {error ? (
                  <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">
                    {error}
                  </p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                block
                onClick={() => {
                  void papi("/auth/logout", { method: "POST" }).catch(
                    () => undefined,
                  );
                  setSecond(null);
                  setError(null);
                }}
              >
                {t("platform.mfaBack")}
              </Button>
            </div>
          </section>
        ) : (
          <>
            <h1 className="text-title">{t("platform.signInTitle")}</h1>
            <p className="mt-2 text-body text-muted">
              {t("platform.signInHelp")}
            </p>
            {DEMO ? (
              <Button
                className="mt-6"
                variant="secondary"
                block
                disabled={busy}
                onClick={() => void signIn("dev@flexcity.dev", DEMO_PASSWORD)}
              >
                {t("platform.demoSignIn")}
              </Button>
            ) : null}
            <form onSubmit={onSubmit} className="mt-8 grid gap-5" noValidate>
              <Field label={t("login.email")}>
                {(p) => (
                  <Input
                    {...p}
                    name="email"
                    type="email"
                    autoComplete="username"
                    required
                  />
                )}
              </Field>
              <Field label={t("login.password")}>
                {(p) => (
                  <Input
                    {...p}
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                )}
              </Field>
              <div aria-live="polite">
                {error ? (
                  <p className="rounded-xl bg-warn-bg px-4 py-3 text-small text-warn">
                    {error}
                  </p>
                ) : null}
              </div>
              <Button
                type="submit"
                size="lg"
                block
                loading={busy}
                icon={<LogIn className="h-5 w-5" aria-hidden="true" />}
              >
                {t("login.submit")}
              </Button>
              {canPasskey ? (
                <Button
                  variant="secondary"
                  size="lg"
                  block
                  disabled={busy}
                  icon={<PasskeyIcon />}
                  onClick={() => void withPasskey()}
                >
                  {t("passkeys.signIn")}
                </Button>
              ) : null}
            </form>
          </>
        )}
        <Copyright className="mt-10 text-center" />
      </main>
    </div>
  );
}
