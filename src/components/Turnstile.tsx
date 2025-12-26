import { useEffect, useRef, useId } from 'react';

interface TurnstileProps {
  onVerify: (token: string) => void;
  onError?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
    turnstileCallbacks?: Array<() => void>;
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
}

// Variables globales pour gérer le chargement du script
let turnstileScriptLoaded = false;
let turnstileScriptLoading = false;

export function Turnstile({ onVerify, onError }: TurnstileProps) {
  const uniqueId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const hasRenderedRef = useRef(false);

  // Récupérer la sitekey de manière sûre
  const siteKey = typeof import.meta.env.PUBLIC_TURNSTILE_SITE_KEY === 'string'
    && import.meta.env.PUBLIC_TURNSTILE_SITE_KEY.length > 0
    ? import.meta.env.PUBLIC_TURNSTILE_SITE_KEY
    : null;

  useEffect(() => {
    // Si pas de sitekey valide, ne rien faire
    if (!siteKey) {
      return;
    }

    // Fonction de rendu du widget
    const renderWidget = () => {
      // Guards multiples contre le double render
      if (!containerRef.current || !window.turnstile || hasRenderedRef.current || widgetIdRef.current) {
        return;
      }

      // Vérifier que le container n'a pas déjà d'enfants (widget déjà rendu)
      if (containerRef.current.children.length > 0) {
        return;
      }

      hasRenderedRef.current = true;

      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onVerify,
          'error-callback': onError,
          theme: 'light',
        });
      } catch (error) {
        hasRenderedRef.current = false;
        console.error('Turnstile render error:', error);
      }
    };

    // Si le script est déjà chargé
    if (turnstileScriptLoaded && window.turnstile) {
      // Utiliser requestAnimationFrame pour s'assurer que le DOM est prêt
      requestAnimationFrame(renderWidget);
      return;
    }

    // Enregistrer le callback pour quand le script sera chargé
    if (!window.turnstileCallbacks) {
      window.turnstileCallbacks = [];
    }
    window.turnstileCallbacks.push(renderWidget);

    // Si le script est déjà en cours de chargement, on attend juste
    if (turnstileScriptLoading) {
      return;
    }

    // Charger le script pour la première fois
    turnstileScriptLoading = true;

    // Définir le callback global AVANT de charger le script
    window.onTurnstileLoad = () => {
      turnstileScriptLoaded = true;
      turnstileScriptLoading = false;
      // Exécuter tous les callbacks enregistrés
      const callbacks = window.turnstileCallbacks || [];
      window.turnstileCallbacks = [];
      callbacks.forEach(cb => requestAnimationFrame(cb));
    };

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
    script.async = true;

    script.onerror = () => {
      turnstileScriptLoading = false;
      console.error('Failed to load Turnstile script');
      onError?.();
    };

    document.head.appendChild(script);

    // Cleanup function
    return () => {
      // Retirer le callback de la liste si pas encore exécuté
      if (window.turnstileCallbacks) {
        window.turnstileCallbacks = window.turnstileCallbacks.filter(cb => cb !== renderWidget);
      }

      // Supprimer le widget si rendu
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignorer les erreurs de cleanup
        }
        widgetIdRef.current = null;
      }
      hasRenderedRef.current = false;
    };
  }, [siteKey, onVerify, onError]);

  // Ne rien afficher si pas de sitekey valide
  if (!siteKey) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      id={`turnstile-container-${uniqueId}`}
      className="cf-turnstile flex justify-center my-4"
    />
  );
}
