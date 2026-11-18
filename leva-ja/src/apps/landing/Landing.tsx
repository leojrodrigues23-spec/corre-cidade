import { BrandSymbol, Icon } from '../../ui/icons';

/** Landing pública: separa claramente os dois perfis. Sem publicidade, sem rastreadores. */
export function Landing() {
  return (
    <div className="min-h-dvh bg-navy bg-aurora text-white">
      <div className="mx-auto max-w-5xl px-5 pb-safe pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <header className="flex items-center gap-2">
          <BrandSymbol size={34} />
          <span className="text-lg font-extrabold">
            Leva <span className="text-brand">Já</span>
          </span>
          <span className="ml-auto rounded-full bg-amber-400 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-navy-950">Piloto privado · Itupeva/SP</span>
        </header>

        <section className="mt-8 grid items-center gap-8 md:grid-cols-2">
          <div className="animate-rise">
            <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">
              Seu destino <span className="bg-brand-grad bg-clip-text text-transparent">começa aqui!</span>
            </h1>
            <p className="mt-4 max-w-md text-navy-100">
              Mobilidade urbana simples e transparente. Nesta fase de testes o acesso é somente por convite, e as corridas e pagamentos são <strong>simulados</strong>.
            </p>
          </div>
          <picture>
            <source srcSet="/brand/leva-ja-logo.webp" type="image/webp" />
            <img src="/brand/leva-ja-logo.jpg" alt="Logomarca Leva Já — Seu destino começa aqui!" width={960} height={640} className="w-full rounded-3xl shadow-2xl ring-1 ring-white/10" />
          </picture>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2" aria-label="Escolha seu perfil">
          <ProfileCard href="/passageiro/" install="/passageiro/#/instalar" variant="passageiro" title="Sou Passageiro" text="Peça corridas, acompanhe o motorista em tempo real e pague com Pix." cta="Abrir Leva Já" />
          <ProfileCard href="/motorista/" install="/motorista/#/instalar" variant="motorista" title="Sou Motorista" text="Receba solicitações, navegue com Waze ou Google Maps e acompanhe seus ganhos." cta="Abrir Leva Já Motorista" />
        </section>

        <section className="mt-10 grid gap-3 text-sm text-navy-100 md:grid-cols-3">
          {[
            ['shield', 'Sem publicidade', 'Nenhum anúncio, banner de terceiros ou rastreador publicitário.'],
            ['ticket', 'Acesso por convite', 'Motoristas são aprovados antes de receber corridas.'],
            ['money', 'Preço transparente', 'Detalhamento da tarifa antes de confirmar a corrida.'],
          ].map(([icon, t, d]) => (
            <div key={t} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
              <Icon name={icon as 'shield'} className="mb-2 text-brand" />
              <p className="font-bold text-white">{t}</p>
              <p className="mt-1">{d}</p>
            </div>
          ))}
        </section>

        <footer className="mt-12 border-t border-white/10 py-6 text-xs text-navy-300">
          <p>Leva Já — piloto privado. Transporte remunerado somente após verificação das exigências legais municipais e federais.</p>
          <p className="mt-2">
            <a className="underline" href="/privacidade.html">Política de privacidade</a> · <a className="underline" href="/admin/">Administração</a>
          </p>
        </footer>
      </div>
    </div>
  );
}

function ProfileCard({ href, install, variant, title, text, cta }: { href: string; install: string; variant: 'passageiro' | 'motorista'; title: string; text: string; cta: string }) {
  return (
    <div className="flex flex-col rounded-3xl bg-white p-6 text-navy shadow-card animate-rise">
      <div className="mb-3 flex items-center gap-3">
        <div className="rounded-2xl bg-navy p-1.5">
          <BrandSymbol size={44} variant={variant} />
        </div>
        <h2 className="text-2xl font-extrabold">{title}</h2>
      </div>
      <p className="mb-5 flex-1 text-navy-600">{text}</p>
      <a href={href} className="inline-flex h-12 items-center justify-center rounded-2xl bg-brand-grad font-bold text-navy-950 shadow-glow transition hover:brightness-105">
        {cta}
      </a>
      <a href={install} className="mt-2 inline-flex h-10 items-center justify-center gap-2 rounded-2xl text-sm font-semibold text-navy hover:bg-mist">
        <Icon name="install" size={18} /> Como instalar no celular
      </a>
    </div>
  );
}
