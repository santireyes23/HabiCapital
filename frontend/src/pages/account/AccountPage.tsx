import { useEffect, useRef, type ReactNode } from "react";

import { Icon } from "../../components/Icon";
import {
  arrowRight14Icon,
  badgeCheckIcon,
  copyIcon,
  idCardIcon,
  info20Icon,
  key22Icon,
  lockIcon,
  logoutIcon,
  shareIcon,
  shieldAlertIcon,
} from "../../components/icons";
import { HeaderPill, PageHeader } from "../../components/PageHeader";
import { initials } from "../../lib/account";
import { formatDate } from "../../lib/dates";
import { formatCop } from "../../lib/money";
import { selectContents, useCopy } from "../../lib/useCopy";
import { useActiveAccount, useSession } from "../../session/SessionProvider";
import { TokenRotation } from "./TokenRotation";

export const CLIENT_VERSION = __APP_VERSION__;

/** «06 — Mi cuenta» (Figma 6:1676) con los datos reales de GET /accounts/me. */
export function AccountPage() {
  const account = useActiveAccount();
  const { refreshAccount, logout } = useSession();

  // Datos al día al entrar (saldo incluido). Si falla, se muestran los de la sesión.
  useEffect(() => {
    const controller = new AbortController();
    refreshAccount(controller.signal).catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [refreshAccount]);

  return (
    <>
      <PageHeader
        pill={<HeaderPill>Identidad y acceso</HeaderPill>}
        note="Demostración en vivo"
        title="Mi cuenta"
        description="Consulta la información de tu cuenta y administra tu acceso a HabiCapital."
        aside={
          <p className="flex w-fit items-center gap-2.5 rounded-card border border-line bg-surface px-[17px] py-[11px] text-caption font-bold text-ink">
            <span aria-hidden className="size-2.5 rounded-pill bg-accent" />
            Sesión Bearer activa
          </p>
        }
      />

      <div className="grid w-full grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-8 lg:col-span-7">
          <article
            aria-labelledby="account-info-title"
            className="flex flex-col gap-6 rounded-card border border-line bg-surface p-6 shadow-soft sm:p-[33px]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-[13px]">
              <h2 id="account-info-title" className="flex items-center gap-2.5 text-card-title font-bold text-ink">
                <span className="text-accent">
                  <Icon src={idCardIcon} size={22} />
                </span>
                Información de la cuenta
              </h2>
              <p className="rounded-pill border border-line bg-surface-sunken px-[11px] py-[3px] text-overline font-bold text-ink-muted">
                Creada: {formatDate(account.created_at)}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface-sunken text-[20px] leading-[30px] font-extrabold text-accent">
                {initials(account.owner_name)}
              </div>
              <div className="flex min-w-0 flex-col gap-[1.25px] pt-[4.5px]">
                <p className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">Titular de la cuenta</p>
                <p className="text-[22px] leading-[27.5px] font-extrabold break-words text-ink">{account.owner_name}</p>
              </div>
            </div>

            <AccountUuid uuid={account.id} />

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-sunken p-[21px]">
              <div className="flex flex-col gap-px">
                <p className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">Saldo disponible</p>
                <p className="text-overline font-semibold text-accent">Fondos simulados de prueba</p>
              </div>
              <p className="whitespace-nowrap">
                <span className="text-[24px] leading-[36px] font-extrabold text-ink">{formatCop(account.balance)} </span>
                <span className="text-body font-semibold text-ink-muted">COP</span>
              </p>
            </div>
          </article>

          <article
            aria-labelledby="security-title"
            className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 shadow-soft sm:p-[33px]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-line pb-[13px]">
              <h2 id="security-title" className="flex items-center gap-2.5 text-card-title font-bold text-ink">
                <span className="text-accent">
                  <Icon src={key22Icon} size={22} />
                </span>
                Seguridad y sesión
              </h2>
              <p className="flex items-center gap-1.5 rounded-pill border border-accepted-border bg-accepted-bg px-2.5 py-[3px] text-overline font-bold text-accepted-text uppercase">
                <span aria-hidden className="size-1.5 rounded-pill bg-accent" />
                Activa
              </p>
            </div>

            <p className="text-body-sm leading-[21.13px] text-ink-muted">
              HabiCapital utiliza un <strong className="font-bold text-ink">Bearer token de acceso</strong> para
              autenticar cada solicitud en el servidor. Este token actúa como tu credencial secreta de sesión en el
              navegador.
            </p>

            <div className="flex items-start gap-3 rounded-card border border-danger-soft-border bg-surface-sunken p-[17px]">
              <span className="pt-0.5 text-negative">
                <Icon src={shieldAlertIcon} size={20} />
              </span>
              <div>
                <p className="text-body-sm leading-[21.13px] font-bold text-rejected-text">Regla de seguridad</p>
                <p className="text-caption leading-[19.5px] text-ink-muted">
                  A diferencia de tu UUID de cuenta, que es público, tu Bearer token nunca debe compartirse con nadie.
                  Por seguridad solo se muestra una vez: al crear la cuenta o al regenerarlo.
                </p>
              </div>
            </div>

            <TokenRotation />

            <div className="flex flex-col gap-3 border-t border-line pt-[17px] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-body-sm font-bold text-ink">Sesión en este navegador</p>
                <p className="text-caption text-ink-muted">
                  Credencial guardada solo en esta pestaña del navegador; se borra al cerrarla.
                </p>
              </div>
              <button
                type="button"
                onClick={logout}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-control border border-line bg-surface-sunken px-[21px] py-[11px] text-body-sm font-bold text-ink-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Icon src={logoutIcon} size={18} />
                Cerrar sesión
              </button>
            </div>
          </article>
        </div>

        <DemoEnvironmentCard uuid={account.id} />
      </div>
    </>
  );
}

function AccountUuid({ uuid }: { uuid: string }) {
  const { state, copy } = useCopy();
  const valueRef = useRef<HTMLParagraphElement>(null);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface-sunken p-[21px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption font-bold tracking-[0.6px] text-ink-muted uppercase">UUID de la cuenta</p>
        <p className="text-overline font-semibold text-accent">Identificador público para recibir fondos</p>
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 rounded-control border border-line bg-field px-[17px] py-[13px]">
        <p ref={valueRef} className="min-w-0 font-mono text-body-sm tracking-[0.65px] break-all text-ink select-all">
          {uuid}
        </p>
        <button
          type="button"
          aria-label="Copiar UUID de la cuenta"
          onClick={() => {
            void copy(uuid).then((ok) => {
              if (!ok) selectContents(valueRef.current);
            });
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-tab border border-line bg-surface px-[13px] py-[7px] text-caption font-bold text-accent transition hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon src={copyIcon} size={16} />
          {state === "copied" ? "Copiado" : "Copiar"}
        </button>
      </div>
      <p aria-live="polite" className="pt-1 text-caption leading-[19.5px] text-ink-muted">
        {state === "failed"
          ? "No se pudo copiar automáticamente. El UUID quedó seleccionado: cópialo manualmente."
          : "Comparte este identificador único con otros usuarios de HabiCapital para que puedan enviarte transferencias o solicitudes de cobro."}
      </p>
    </div>
  );
}

function DemoItem({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="pt-0.5">
        <span className="flex size-8 items-center justify-center rounded-control border border-line-strong bg-surface-sunken text-accent">
          <Icon src={icon} size={18} />
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-body-sm leading-[21.13px] font-bold text-ink">{title}</p>
        <p className="text-body-sm leading-[21.13px] text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

function DemoEnvironmentCard({ uuid }: { uuid: string }) {
  const { state, copy } = useCopy();
  return (
    <aside
      aria-labelledby="demo-env-title"
      className="flex flex-col gap-5 rounded-card border border-line bg-surface p-6 shadow-soft sm:p-[29px] lg:col-span-5"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line pb-[13px]">
        <h2 id="demo-env-title" className="flex items-center gap-2 text-title font-bold text-ink">
          <span className="text-accent">
            <Icon src={info20Icon} size={20} />
          </span>
          Entorno de demostración
        </h2>
        <p className="text-overline font-bold text-accent uppercase">Sandbox</p>
      </div>
      <div className="flex flex-col gap-4">
        <DemoItem icon={badgeCheckIcon} title="Demostración técnica en vivo">
          HabiCapital está diseñado como una prueba de concepto funcional para simular operaciones financieras entre
          cuentas sin comprometer dinero fiduciario.
        </DemoItem>
        <DemoItem icon={shareIcon} title="Cómo compartir tu cuenta">
          Para recibir fondos de prueba de otro usuario o tester, comparte únicamente el{" "}
          <strong className="font-bold text-ink">UUID de cuenta</strong> disponible en esta pantalla.
        </DemoItem>
        <DemoItem icon={lockIcon} title="Autenticación por Bearer Token">
          El backend valida tu sesión a través de la cabecera HTTP estándar{" "}
          <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> en cada llamada API.
        </DemoItem>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-[17px]">
        <p className="text-caption text-ink-muted">Versión cliente: {CLIENT_VERSION} · COP</p>
        <button
          type="button"
          onClick={() => void copy(uuid)}
          className="flex items-center gap-1 text-caption font-bold text-accent focus-visible:outline-2 focus-visible:outline-accent"
        >
          {state === "copied" ? "UUID copiado" : state === "failed" ? "No se pudo copiar" : "Copiar mi UUID"}
          <Icon src={arrowRight14Icon} size={14} />
        </button>
      </div>
    </aside>
  );
}
