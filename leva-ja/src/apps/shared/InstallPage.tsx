import { useState } from 'react';
import { detectPlatform, type Platform, useInstallPrompt } from '../../pwa/install';
import { Banner, Button, Card, cx } from '../../ui/components';
import { BrandSymbol, Icon } from '../../ui/icons';

const NAMES = { passageiro: 'Leva Já', motorista: 'Leva Já Motorista' };

/** Instruções de instalação por perfil e por aparelho. Nunca promete instalação automática. */
export function InstallGuide({ app }: { app: 'passageiro' | 'motorista' }) {
  const { canPrompt, standalone, prompt } = useInstallPrompt();
  const [tab, setTab] = useState<Platform>(detectPlatform());
  const [result, setResult] = useState<string | null>(null);
  const name = NAMES[app];
  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-4">
        <div className="rounded-[22%] bg-navy p-2 shadow-card">
          <BrandSymbol size={52} variant={app === 'motorista' ? 'motorista' : 'passageiro'} />
        </div>
        <div>
          <p className="text-lg font-bold">{name}</p>
          <p className="text-sm text-navy-500 dark:text-navy-300">{app === 'motorista' ? 'App exclusivo para motoristas aprovados' : 'App do passageiro'}</p>
        </div>
      </Card>
      {standalone ? (
        <Banner tone="success" title="Você já está usando o app instalado">
          Este atalho abre direto na área {app === 'motorista' ? 'do motorista' : 'do passageiro'}.
        </Banner>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 ring-1 ring-navy/10 dark:bg-navy-900 dark:ring-white/10" role="tablist">
            {(['android', 'ios', 'desktop'] as Platform[]).map((p) => (
              <button key={p} role="tab" aria-selected={tab === p} onClick={() => setTab(p)} className={cx('rounded-xl py-2 text-sm font-semibold', tab === p ? 'bg-navy text-white dark:bg-white dark:text-navy' : 'text-navy-500 dark:text-navy-300')}>
                {p === 'android' ? 'Android' : p === 'ios' ? 'iPhone' : 'Computador'}
              </button>
            ))}
          </div>
          <Card>
            {tab === 'android' && (
              <>
                {canPrompt ? (
                  <Button block size="lg" icon="install" onClick={async () => setResult(await prompt())}>
                    Instalar {name}
                  </Button>
                ) : (
                  <Banner tone="info" className="mb-3">
                    O navegador ainda não ofereceu a instalação automática. Use o menu:
                  </Banner>
                )}
                {result === 'dismissed' && <p className="mt-2 text-sm text-navy-500">Instalação cancelada. Você pode tentar de novo pelo menu do navegador.</p>}
                <Steps
                  items={[
                    'Abra este link no Google Chrome.',
                    'Toque no menu ⋮ (canto superior direito).',
                    `Escolha "Instalar app" ou "Adicionar à tela inicial".`,
                    `Confirme. O ícone "${name}" aparece na tela inicial.`,
                  ]}
                />
              </>
            )}
            {tab === 'ios' && (
              <>
                <Banner tone="info" className="mb-3">
                  No iPhone a instalação é sempre manual, pelo menu Compartilhar. Não existe botão de instalação automática.
                </Banner>
                <Steps
                  items={[
                    'Abra este link no Safari (no iOS 16.4+ também funciona em outros navegadores pelo menu Compartilhar).',
                    'Toque em Compartilhar (quadrado com seta para cima).',
                    'Role e toque em "Adicionar à Tela de Início".',
                    `Mantenha o nome "${name}" e toque em Adicionar.`,
                  ]}
                />
                <p className="mt-3 text-xs text-navy-500 dark:text-navy-300">
                  {app === 'motorista'
                    ? 'Atenção: no iPhone, apps instalados pela tela de início não enviam localização com a tela bloqueada. Mantenha o app aberto durante as corridas.'
                    : 'Notificações no iPhone só funcionam com o app adicionado à Tela de Início (iOS 16.4+) e após você permitir.'}
                </p>
              </>
            )}
            {tab === 'desktop' && (
              <Steps items={['Abra no Chrome ou Edge.', 'Clique no ícone de instalar na barra de endereço (monitor com seta).', 'Confirme "Instalar".']} />
            )}
          </Card>
          <p className="px-1 text-xs text-navy-500 dark:text-navy-300">
            Os apps Leva Já e Leva Já Motorista podem ser instalados no mesmo aparelho: cada um tem ícone, sessão e atualização próprios.
          </p>
        </>
      )}
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-3 space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-navy-950">{i + 1}</span>
          <span className="pt-0.5">{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallIcon() {
  return <Icon name="install" />;
}
