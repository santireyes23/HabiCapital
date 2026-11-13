import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";

import { Brand } from "../../components/Brand";
import { Icon } from "../../components/Icon";
import {
  checkCircleIcon,
  cubeIcon,
  keyIcon,
  plusCircleIcon,
  questionIcon,
  shieldCheckIcon,
  terminalIcon,
} from "../../components/icons";
import { DangerNotice, InfoNotice } from "../../components/ui";
import { type CreatedAccount, useSession } from "../../session/SessionProvider";
import { SessionCheckingScreen, SessionOfflineScreen } from "../SessionScreens";
import { AccountCreatedView } from "./AccountCreatedView";
import { CreateAccountForm } from "./CreateAccountForm";
import { LoginForm } from "./LoginForm";
import { safeRedirectPath } from "./redirect";

type Tab = "crear" | "ingresar";
export const LOGIN_TAB_PARAM = "modo";

/** «07 — Crear cuenta y acceder» (Figma) con los estados de Stitch. Pantalla pública. */
export function AccessPage() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [created, setCreated] = useState<CreatedAccount | null>(null);
  const [creating, setCreating] = useState(false);

  const navigationState: unknown = location.state;
  const from = safeRedirectPath(navigationState);
  const { state } = session;

  if (state.status === "checking") return <SessionCheckingScreen />;
  if (state.status === "offline") return <SessionOfflineScreen />;
  // Con sesión activa no se muestra el formulario, salvo mientras se ve el token recién creado
  // (o la petición que lo crea sigue en curso).
  if (state.status === "active" && created === null && !creating) {
    return <Navigate to={from ?? "/"} replace />;
  }

  const reason = state.status === "anonymous" ? state.reason : "none";
  // «Crear cuenta» es la pestaña por defecto (Figma). Si se pidió una sección concreta o la sesión
  // expiró, lo más probable es que la persona ya tenga cuenta.
  const wantedSection = from !== null && from !== "/";
  const defaultTab: Tab = wantedSection || reason === "expired" ? "ingresar" : "crear";
  const requested = searchParams.get(LOGIN_TAB_PARAM);
  const tab: Tab = requested === "ingresar" || requested === "crear" ? requested : defaultTab;

  function selectTab(next: Tab) {
    setSearchParams({ [LOGIN_TAB_PARAM]: next }, { replace: true, state: navigationState });
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-8">
        <Brand />
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/ayuda"
            className="flex items-center gap-2 rounded-pill px-2 py-1 text-caption font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Icon src={questionIcon} size={16} />
            ¿Necesitas ayuda?
          </Link>
          <p className="flex items-center gap-2.5 rounded-pill border border-line bg-surface px-[15px] py-[7px] text-caption font-semibold text-ink-muted">
            <span aria-hidden className="size-2 rounded-pill bg-accent" />
            Entorno de demostración interactiva
          </p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:py-[64px]">
        <div className="grid w-full max-w-[1152px] grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
          <IntroSection />

          <section
            aria-label="Formulario de acceso y registro"
            className="order-1 flex flex-col gap-6 rounded-[16px] border border-line bg-surface p-6 shadow-[0_25px_50px_-12px_rgb(0_0_0/0.25)] sm:p-9 lg:order-2 lg:col-span-6"
          >
            {created !== null ? (
              <AccountCreatedView
                created={created}
                onContinue={() => {
                  session.confirmTokenSaved();
                  // Una cuenta nueva siempre empieza en Inicio. No se limpia `created` aquí: la
                  // navegación desmonta esta pantalla (y con ella el token en memoria).
                  void navigate("/", { replace: true });
                }}
              />
            ) : (
              <>
                {reason === "expired" && (
                  <DangerNotice role="status" title="Tu sesión terminó">
                    El servidor ya no acepta el token guardado en esta pestaña (pudo haberse
                    regenerado). Ingresa tu token para continuar.
                  </DangerNotice>
                )}
                {reason === "logout" && (
                  <InfoNotice icon={checkCircleIcon}>
                    Cerraste sesión: el token se borró de esta pestaña del navegador.
                  </InfoNotice>
                )}

                <div
                  role="tablist"
                  aria-label="Elige cómo entrar"
                  className="grid w-full grid-cols-2 rounded-[20px] border border-line bg-canvas p-[7px]"
                >
                  <TabButton id="tab-crear" panel="panel-crear" selected={tab === "crear"} onSelect={() => { selectTab("crear"); }}>
                    Crear cuenta
                  </TabButton>
                  <TabButton id="tab-ingresar" panel="panel-ingresar" selected={tab === "ingresar"} onSelect={() => { selectTab("ingresar"); }}>
                    Ya tengo cuenta
                  </TabButton>
                </div>

                {tab === "crear" ? (
                  <div role="tabpanel" id="panel-crear" aria-labelledby="tab-crear">
                    <CreateAccountForm
                      createAccount={session.createAccount}
                      onBusyChange={setCreating}
                      onCreated={setCreated}
                    />
                  </div>
                ) : (
                  <div role="tabpanel" id="panel-ingresar" aria-labelledby="tab-ingresar">
                    <LoginForm
                      login={session.login}
                      onLoggedIn={() => {
                        void navigate(from ?? "/", { replace: true });
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-[1440px] flex-col justify-between gap-3 border-t border-line px-4 pt-[21px] pb-5 text-caption text-ink-muted sm:flex-row sm:items-center sm:px-8">
        <span>HabiCapital · Demostración técnica de billetera digital simulada</span>
        <span className="flex items-center gap-1.5 text-accent">
          <Icon src={terminalIcon} size={16} />
          FastAPI + PostgreSQL Ready
        </span>
      </footer>
    </div>
  );
}

function TabButton({
  id,
  panel,
  selected,
  onSelect,
  children,
}: {
  id: string;
  panel: string;
  selected: boolean;
  onSelect: () => void;
  children: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={panel}
      onClick={onSelect}
      className={`rounded-control px-4 py-[11px] text-body-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        selected
          ? "border border-line-strong bg-surface font-bold text-ink-active shadow-soft"
          : "border border-transparent font-semibold text-ink-muted hover:text-ink-active"
      }`}
    >
      {children}
    </button>
  );
}

/** Columna izquierda de Figma: presentación de la billetera (contenido fijo, sin datos). */
function IntroSection() {
  return (
    <section
      aria-label="Acerca de HabiCapital"
      className="order-2 flex flex-col gap-8 lg:order-1 lg:col-span-6"
    >
      <div className="flex flex-col gap-4">
        <p className="flex w-fit items-center gap-2 rounded-pill border border-line-strong bg-surface-sunken px-[13px] py-[5px] text-caption font-bold tracking-[0.3px] text-accent uppercase">
          <Icon src={cubeIcon} size={16} />
          Simulación de finanzas digitales
        </p>
        <h1 className="text-[40px] leading-[1.1] font-extrabold tracking-[-1px] text-ink sm:text-[52px] sm:leading-[57.2px] sm:tracking-[-1.3px]">
          Tu dinero, en movimiento.
        </h1>
        <p className="max-w-[512px] text-[16px] leading-[26px] text-ink-muted">
          HabiCapital es una billetera digital colombiana para transferencias simuladas
          peer-to-peer. Crea una cuenta en segundos mediante credenciales Bearer sin contraseñas
          tradicionales ni datos bancarios reales.
        </p>
      </div>

      <div className="flex w-full max-w-[512px] flex-col gap-5 overflow-clip rounded-[16px] border border-line bg-surface p-[25px] shadow-[0_20px_25px_-5px_rgb(0_0_0/0.1),0_8px_10px_-6px_rgb(0_0_0/0.1)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-pill border border-line-strong bg-surface-sunken text-caption font-bold text-accent">
              HC
            </div>
            <div>
              <p className="text-body-sm font-bold text-ink">Billetera P2P Activa</p>
              <p className="text-overline text-ink-muted">Transacciones inmediatas COP</p>
            </div>
          </div>
          <span className="rounded-[10px] border border-line bg-canvas px-[11px] py-[5px] font-mono text-overline text-accent">
            Bearer Auth
          </span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-canvas px-4 py-[15px]">
          <div>
            <p className="text-overline font-bold tracking-[0.55px] text-ink-muted uppercase">
              Saldo simulado inicial
            </p>
            <p className="text-[26px] leading-[39px] font-extrabold text-ink">
              $0 <span className="text-body font-semibold text-ink-muted">COP</span>
            </p>
          </div>
          <p className="flex items-center gap-1 text-caption font-semibold text-accent">
            <Icon src={plusCircleIcon} size={16} />
            Recargable al instante
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-line pt-[17px] text-caption text-ink-muted">
          <p className="flex items-center gap-2">
            <span className="text-accent">
              <Icon src={shieldCheckIcon} size={18} />
            </span>
            Sin tarjeta ni PSE
          </p>
          <p className="flex items-center gap-2">
            <span className="text-accent">
              <Icon src={keyIcon} size={18} />
            </span>
            Acceso por Bearer token
          </p>
        </div>
      </div>
    </section>
  );
}
