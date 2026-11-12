import { logoUrl } from "./icons";

/** Logo + «HabiCapital» + «Billetera P2P · Colombia» (cabecera de acceso y barra lateral). */
export function Brand() {
  return (
    <div className="flex items-center gap-3.5">
      <div className="flex size-10 shrink-0 items-center justify-center overflow-clip rounded-control border border-line-strong bg-surface p-px shadow-soft">
        <img src={logoUrl} alt="" width={24} height={24} className="block size-6" />
      </div>
      <div className="flex flex-col">
        <p className="text-[20px] leading-[20px] font-extrabold tracking-[-0.5px] whitespace-nowrap text-ink">
          Habi<span className="text-accent">Capital</span>
        </p>
        {/* Ancho del texto en Figma (110.7 px): «Colombia» baja a la segunda línea. */}
        <p className="max-w-[111px] pt-[3px] text-overline font-semibold tracking-[0.275px] text-ink-muted">
          Billetera P2P · Colombia
        </p>
      </div>
    </div>
  );
}
