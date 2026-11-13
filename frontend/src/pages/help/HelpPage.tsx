import { useState } from "react";

import { Icon } from "../../components/Icon";
import { chevronDownIcon, infoIcon, questionIcon } from "../../components/icons";
import { HeaderPill, PageHeader } from "../../components/PageHeader";
import { FAQ, type FaqBlock, type FaqItem } from "./faq";

/**
 * Centro de ayuda: preguntas frecuentes por categoría en acordeones. Es pública (sin sesión) y,
 * con sesión, se ve dentro del panel con su menú lateral (routes/HelpRoute.tsx).
 */
export function HelpPage() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        pill={<HeaderPill>Guía de uso</HeaderPill>}
        note="Preguntas frecuentes"
        title="Centro de ayuda"
        description="Encuentra respuestas a las preguntas más frecuentes sobre HabiCapital."
      />

      <div className="flex w-full items-start gap-3 rounded-card border border-line-strong bg-surface-sunken p-[17px]">
        <span className="pt-0.5 text-accent">
          <Icon src={infoIcon} size={18} />
        </span>
        <p className="text-body-sm text-ink-muted">
          <strong className="font-bold text-ink">HabiCapital usa dinero simulado.</strong> Es una billetera de
          demostración en pesos colombianos: puedes crear cuentas, recargar saldo, transferir y pedir dinero
          entre cuentas, pero no se conecta a bancos ni mueve dinero real.
        </p>
      </div>

      <nav aria-label="Categorías de ayuda" className="flex w-full flex-wrap gap-2">
        {FAQ.map((category) => (
          <a
            key={category.id}
            href={`#${category.id}`}
            className="rounded-pill border border-line bg-surface px-4 py-2 text-caption font-semibold text-ink-muted transition hover:border-line-strong hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {category.title}
          </a>
        ))}
      </nav>

      <div className="flex w-full flex-col gap-6">
        {FAQ.map((category) => (
          <section
            key={category.id}
            id={category.id}
            aria-labelledby={`${category.id}-title`}
            className="flex scroll-mt-6 flex-col gap-2 rounded-card border border-line bg-surface p-6 shadow-soft sm:p-[29px]"
          >
            <div className="flex items-start gap-3 pb-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface-sunken text-accent">
                <Icon src={questionIcon} size={20} />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 id={`${category.id}-title`} className="text-card-title font-bold text-ink">
                  {category.title}
                </h2>
                <p className="text-body-sm text-ink-muted">{category.description}</p>
              </div>
            </div>
            <div className="flex flex-col">
              {category.items.map((item) => (
                <Question key={item.id} item={item} expanded={open.has(item.id)} onToggle={toggle} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function Question({ item, expanded, onToggle }: { item: FaqItem; expanded: boolean; onToggle: (id: string) => void }) {
  const buttonId = `ayuda-${item.id}`;
  const panelId = `ayuda-${item.id}-respuesta`;
  return (
    <div className="border-t border-line">
      <h3>
        <button
          id={buttonId}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => {
            onToggle(item.id);
          }}
          className={`flex w-full items-center justify-between gap-4 rounded-control px-1 py-4 text-left text-body font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            expanded ? "text-ink-active" : "text-ink hover:text-ink-active"
          }`}
        >
          <span>{item.question}</span>
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-pill border ${
              expanded ? "border-accent text-accent" : "border-line-strong text-ink-subtle"
            }`}
          >
            <Icon src={chevronDownIcon} size={18} height={9} className={expanded ? "-rotate-90" : "rotate-90"} />
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!expanded}
        className="flex flex-col gap-3 px-1 pb-5"
      >
        {item.answer.map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </div>
    </div>
  );
}

function Block({ block }: { block: FaqBlock }) {
  if (block.kind === "text") return <p className="text-body-sm text-ink-muted">{block.text}</p>;
  if (block.kind === "steps") {
    return (
      <ol className="flex flex-col gap-2">
        {block.items.map((step, index) => (
          <li key={step} className="flex items-start gap-3 text-body-sm text-ink">
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-accent text-overline font-extrabold text-on-accent"
            >
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {block.items.map((entry) => (
        <li key={entry} className="flex items-start gap-2.5 text-body-sm text-ink-muted">
          <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-pill bg-accent" />
          <span>{entry}</span>
        </li>
      ))}
    </ul>
  );
}
