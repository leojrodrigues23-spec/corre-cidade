import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Cada tela abre do topo, como em app nativo (o HashRouter manteria a rolagem da tela anterior). */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
