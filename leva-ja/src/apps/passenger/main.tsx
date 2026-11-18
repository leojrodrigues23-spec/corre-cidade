import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from '../../pwa/install';
import '../../ui/styles.css';
import { PassengerRoot } from './PassengerApp';

let offerUpdate: ((apply: () => void) => void) | null = null;
registerServiceWorker('passageiro', (apply) => offerUpdate?.(apply));

function Main() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => {
    offerUpdate = (fn) => setApply(() => fn);
  }, []);
  return <PassengerRoot updateApply={apply} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Main />
  </StrictMode>,
);
